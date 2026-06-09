import type {
  ReflowInput,
  ReflowResult,
  ScheduleChange,
  WorkOrder,
  WorkCenter,
  Interval,
} from "./types";
import { topologicalSort } from "./dag";
import { checkConstraints } from "./constraint-checker";
import {
  toMs,
  toIso,
  addWorkingMinutes,
  normalizeMaintenance,
  overlaps,
  minutesBetween,
} from "./date-utils";

export class ReflowService {
  reflow(input: ReflowInput): ReflowResult {
    const { workOrders, workCenters } = input;

    const wcById = new Map<string, WorkCenter>();
    for (const wc of workCenters) wcById.set(wc.docId, wc);

    const woById = new Map<string, WorkOrder>();
    for (const wo of workOrders) woById.set(wo.docId, wo);

    // Process in dependency order so parents are always placed before children.
    const sortedIds = topologicalSort(workOrders);
    const sorted = sortedIds.map((id) => woById.get(id)!);

    // Track occupied intervals per work center.
    // Seeded with maintenance work orders and maintenance windows — both are immovable.
    const occupancy = new Map<string, Interval[]>();
    for (const wc of workCenters) occupancy.set(wc.docId, []);

    for (const wo of workOrders.filter((w) => w.data.isMaintenance)) {
      occupancy.get(wo.data.workCenterId)?.push({
        start: toMs(wo.data.startDate),
        end: toMs(wo.data.endDate),
      });
    }

    for (const wc of workCenters) {
      for (const window of wc.data.maintenanceWindows) {
        occupancy.get(wc.docId)?.push({
          start: toMs(window.startDate),
          end: toMs(window.endDate),
        });
      }
    }

    const updatedWorkOrders: WorkOrder[] = [];
    const updatedWoById = new Map<string, WorkOrder>();

    for (const wo of sorted) {
      if (wo.data.isMaintenance) {
        updatedWorkOrders.push(wo);
        updatedWoById.set(wo.docId, wo);
        continue;
      }

      // Earliest start = max of the order's own original start and all parents' new ends.
      // We never pull an order earlier than originally planned.
      let earliestStart = toMs(wo.data.startDate);
      for (const parentId of wo.data.dependsOnWorkOrderIds) {
        const parentEnd = toMs(updatedWoById.get(parentId)!.data.endDate);
        earliestStart = Math.max(earliestStart, parentEnd);
      }

      const placement = this.findPlacement(
        earliestStart,
        wo.data.durationMinutes + (wo.data.setupTimeMinutes ?? 0),
        wcById.get(wo.data.workCenterId)!,
        occupancy.get(wo.data.workCenterId)!,
      );

      const updated: WorkOrder = {
        ...wo,
        data: {
          ...wo.data,
          startDate: toIso(placement.start),
          endDate: toIso(placement.end),
        },
      };

      updatedWorkOrders.push(updated);
      updatedWoById.set(wo.docId, updated);
      occupancy.get(wo.data.workCenterId)!.push(placement);
    }

    // Self-check — if this throws, there's a bug in the algorithm above.
    const violations = checkConstraints(updatedWorkOrders, workCenters);
    if (violations.length > 0) {
      throw new Error(
        `Reflow produced an invalid schedule:\n${violations.map((v) => v.message).join("\n")}`,
      );
    }

    const changes = this.buildChanges(workOrders, updatedWorkOrders);
    const metrics = this.computeMetrics(workOrders, updatedWorkOrders);
    const explanation = `Rescheduled ${changes.length} of ${workOrders.length} work orders. Total delay: ${metrics.totalDelayMinutes} minutes.`;

    return { updatedWorkOrders, changes, explanation, metrics };
  }

  // Finds the earliest slot on a work center where the order fits without conflict.
  // Pushes past any conflicting occupancy interval and retries.
  private findPlacement(
    earliestStart: number,
    duration: number,
    wc: WorkCenter,
    occupied: Interval[],
  ): Interval {
    const blocked = normalizeMaintenance(wc.data.maintenanceWindows);
    let cursor = earliestStart;

    for (let i = 0; i < 1000; i++) {
      const candidate = addWorkingMinutes(cursor, duration, wc.data.shifts, blocked);
      const conflict = occupied.find((o) => overlaps(o, candidate));
      if (!conflict) return candidate;
      cursor = conflict.end;
    }

    throw new Error(`Could not find a valid placement on ${wc.data.name} after 1000 attempts`);
  }

  // Diffs original vs updated work orders and returns a change record for each that moved.
  private buildChanges(original: WorkOrder[], updated: WorkOrder[]): ScheduleChange[] {
    const changes: ScheduleChange[] = [];
    const updatedMap = new Map<string, WorkOrder>();
    for (const wo of updated) updatedMap.set(wo.docId, wo);

    for (const wo of original) {
      const updatedWo = updatedMap.get(wo.docId)!;
      const startShiftMinutes = minutesBetween(toMs(wo.data.startDate), toMs(updatedWo.data.startDate));
      const endShiftMinutes = minutesBetween(toMs(wo.data.endDate), toMs(updatedWo.data.endDate));

      if (startShiftMinutes === 0 && endShiftMinutes === 0) continue;

      const reasons: string[] = [];

      if (startShiftMinutes === 0 && endShiftMinutes !== 0) {
        reasons.push("end date corrected from stale input");
      } else {
        const pushedByParent = wo.data.dependsOnWorkOrderIds.some((parentId) => {
          const parentUpdated = updatedMap.get(parentId);
          return parentUpdated && toMs(parentUpdated.data.endDate) > toMs(wo.data.startDate);
        });
        reasons.push(pushedByParent ? "pushed by parent dependency" : "work center conflict or shift adjustment");
      }

      changes.push({
        workOrderId: wo.docId,
        workOrderNumber: wo.data.workOrderNumber,
        originalStart: wo.data.startDate,
        originalEnd: wo.data.endDate,
        newStart: updatedWo.data.startDate,
        newEnd: updatedWo.data.endDate,
        startShiftMinutes,
        endShiftMinutes,
        reasons,
      });
    }

    return changes;
  }

  private computeMetrics(original: WorkOrder[], updated: WorkOrder[]): ReflowResult["metrics"] {
    const totalDelayMinutes = updated.reduce((sum, wo) => {
      const orig = original.find((o) => o.docId === wo.docId)!;
      return sum + Math.max(0, minutesBetween(toMs(orig.data.endDate), toMs(wo.data.endDate)));
    }, 0);

    const affectedWorkOrders = updated.filter((wo) => {
      const orig = original.find((o) => o.docId === wo.docId)!;
      return wo.data.startDate !== orig.data.startDate || wo.data.endDate !== orig.data.endDate;
    }).length;

    return {
      totalDelayMinutes,
      affectedWorkOrders,
      utilization: {}, // @upgrade: implement per-WC utilization
    };
  }
}