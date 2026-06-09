import type { WorkOrder, WorkCenter, Interval } from "./types";
import { toMs, overlaps, normalizeMaintenance, addWorkingMinutes } from "./date-utils";

export interface Violation {
  type: "dependency" | "workCenterConflict" | "shift" | "maintenance";
  message: string;
  workOrderIds: string[];
}

// Validates a schedule against all four hard constraints.
// Returns all violations found — empty array means the schedule is valid.
export function checkConstraints(
  workOrders: WorkOrder[],
  workCenters: WorkCenter[],
): Violation[] {
  const violations: Violation[] = [];

  const woById = new Map<string, WorkOrder>();
  for (const wo of workOrders) woById.set(wo.docId, wo);

  const wcById = new Map<string, WorkCenter>();
  for (const wc of workCenters) wcById.set(wc.docId, wc);

  // 1. Dependencies: every parent must finish before its child starts.
  for (const child of workOrders) {
    for (const parentId of child.data.dependsOnWorkOrderIds) {
      if (woById.get(parentId)?.data.endDate! > child.data.startDate) {
        violations.push({
          type: "dependency",
          message: `${child.data.workOrderNumber} starts before parent ${woById.get(parentId)?.data.workOrderNumber} finishes`,
          workOrderIds: [child.docId, parentId],
        });
      }
    }
  }

  // 2. Work center conflicts: no two orders on the same machine may overlap.
  const groupedByWC = workCenters.map((wc) => ({
    wcId: wc.docId,
    workOrders: workOrders
      .filter((wo) => wo.data.workCenterId === wc.docId)
      .sort((a, b) => toMs(a.data.startDate) - toMs(b.data.startDate)),
  }));

  for (const group of groupedByWC) {
    const orders = group.workOrders;
    for (let i = 1; i < orders.length; i++) {
      const prev = orders[i - 1]!;
      const curr = orders[i]!;
      if (
        overlaps(
          { start: toMs(prev.data.startDate), end: toMs(prev.data.endDate) },
          { start: toMs(curr.data.startDate), end: toMs(curr.data.endDate) },
        )
      ) {
        violations.push({
          type: "workCenterConflict",
          message: `${prev.data.workOrderNumber} and ${curr.data.workOrderNumber} overlap on the same work center`,
          workOrderIds: [prev.docId, curr.docId],
        });
      }
    }
  }

  // 3. Shifts: recompute expected end from start + duration and compare with recorded end.
  //    A mismatch means the order has working time outside shift hours.
  for (const wo of workOrders.filter((wo) => !wo.data.isMaintenance)) {
    const wc = wcById.get(wo.data.workCenterId)!;
    const { end } = addWorkingMinutes(
      toMs(wo.data.startDate),
      wo.data.durationMinutes,
      wc.data.shifts,
      [],
    );
    if (Math.abs(end - toMs(wo.data.endDate)) > 60_000) {
      violations.push({
        type: "shift",
        message: `${wo.data.workOrderNumber} has working time outside ${wc.data.name}'s shift hours`,
        workOrderIds: [wo.docId],
      });
    }
  }

  // 4. Maintenance windows: no production order may overlap a blocked interval.
  for (const wo of workOrders.filter((wo) => !wo.data.isMaintenance)) {
    const wc = wcById.get(wo.data.workCenterId)!;
    const blocked = normalizeMaintenance(wc.data.maintenanceWindows);
    for (const block of blocked) {
      if (overlaps({ start: toMs(wo.data.startDate), end: toMs(wo.data.endDate) }, block)) {
        violations.push({
          type: "maintenance",
          message: `${wo.data.workOrderNumber} overlaps a maintenance window on ${wc.data.name}`,
          workOrderIds: [wo.docId],
        });
      }
    }
  }

  return violations;
}