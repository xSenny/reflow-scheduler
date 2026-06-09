/**
 * Demo entry point — runs all 3 scenarios and prints a readable summary.
 *
 * Run:  npx tsx src/index.ts
 */

import { ReflowService } from "./reflow/reflow.service";
import type { WorkOrder, WorkCenter, ScheduleChange } from "./reflow/types";

const service = new ReflowService();

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmt(iso: string): string {
  // "2024-01-01T08:00:00.000Z" → "Mon 08:00"
  const d = new Date(iso);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} Jan ${hh}:${mm}`;
}

function printHeader(title: string) {
  console.log("\n" + "═".repeat(60));
  console.log(`  ${title}`);
  console.log("═".repeat(60));
}

function printWorkOrders(label: string, orders: WorkOrder[]) {
  console.log(`\n  ${label}`);
  for (const wo of orders) {
    const tag = wo.data.isMaintenance ? " [MAINT]" : "";
    const parents =
      wo.data.dependsOnWorkOrderIds.length > 0
        ? ` (after: ${wo.data.dependsOnWorkOrderIds.join(", ")})`
        : "";
    console.log(
      `    ${wo.data.workOrderNumber.padEnd(6)}${tag}  ` +
        `${fmt(wo.data.startDate)} → ${fmt(wo.data.endDate)}  ` +
        `[${wo.data.durationMinutes}min]${parents}`,
    );
  }
}

function printChanges(changes: ScheduleChange[]) {
  if (changes.length === 0) {
    console.log("\n  ✅ No changes — schedule was already valid.");
    return;
  }
  console.log(`\n  📋 Changes (${changes.length} work order(s) moved):`);
  for (const c of changes) {
    const sign = c.endShiftMinutes >= 0 ? "+" : "";
    console.log(`    ${c.workOrderNumber.padEnd(6)}  ${fmt(c.originalStart)} → ${fmt(c.newStart)}  (${sign}${c.endShiftMinutes}min)`);
    console.log(`           reason: ${c.reasons.join(", ")}`);
  }
}

function printMetrics(metrics: { totalDelayMinutes: number; affectedWorkOrders: number }) {
  console.log(`\n  📊 Metrics:`);
  console.log(`    Affected work orders : ${metrics.affectedWorkOrders}`);
  console.log(`    Total delay          : ${metrics.totalDelayMinutes} minutes`);
}

// ─── Shared work center factory ────────────────────────────────────────────

function makeWC(
  id: string,
  name: string,
  maintenanceWindows: WorkCenter["data"]["maintenanceWindows"] = [],
): WorkCenter {
  return {
    docId: id,
    docType: "workCenter",
    data: {
      name,
      shifts: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startHour: 8, endHour: 17 })),
      maintenanceWindows,
    },
  };
}

function makeWO(
  id: string,
  start: string,
  end: string,
  duration: number,
  wcId: string,
  parents: string[] = [],
  isMaintenance = false,
): WorkOrder {
  return {
    docId: id,
    docType: "workOrder",
    data: {
      workOrderNumber: id,
      manufacturingOrderId: "mo-1",
      workCenterId: wcId,
      startDate: start,
      endDate: end,
      durationMinutes: duration,
      isMaintenance,
      dependsOnWorkOrderIds: parents,
    },
  };
}

// ─── Scenario 1: Delay Cascade ─────────────────────────────────────────────
// A runs longer than expected (240 min instead of 120).
// B and C are downstream — their original dates are now stale.

printHeader("Scenario 1 — Delay Cascade");

const wc1 = makeWC("wc-1", "Extrusion Line 1");

const s1 = [
  makeWO("A", "2024-01-01T08:00:00Z", "2024-01-01T12:00:00Z", 240, "wc-1"),
  makeWO("B", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z", 120, "wc-1", ["A"]),
  makeWO("C", "2024-01-01T12:00:00Z", "2024-01-01T14:00:00Z", 120, "wc-1", ["B"]),
];

printWorkOrders("Before reflow (B and C dates are stale):", s1);
const r1 = service.reflow({ workOrders: s1, workCenters: [wc1] });
printWorkOrders("After reflow:", r1.updatedWorkOrders);
printChanges(r1.changes);
printMetrics(r1.metrics);
console.log(`\n  💬 ${r1.explanation}`);

// ─── Scenario 2: Shift Boundary ────────────────────────────────────────────
// A large order (600 min = 10h) must spill across the shift boundary into
// the next day. Reflow calculates the correct end date.

printHeader("Scenario 2 — Shift Boundary");

const wc2 = makeWC("wc-2", "Extrusion Line 2");

const s2 = [
  makeWO("A", "2024-01-01T08:00:00Z", "2024-01-01T08:00:00Z", 600, "wc-2"),
];

printWorkOrders("Before reflow (end date is clearly wrong):", s2);
const r2 = service.reflow({ workOrders: s2, workCenters: [wc2] });
printWorkOrders("After reflow:", r2.updatedWorkOrders);
printChanges(r2.changes);
console.log(`\n  💬 ${r2.explanation}`);

// ─── Scenario 3: Maintenance Conflict ──────────────────────────────────────
// A chain of orders builds up across days. One order lands exactly during
// a planned maintenance window on Wednesday — reflow pushes it past it.

printHeader("Scenario 3 — Maintenance Conflict");

const wc3 = makeWC("wc-3", "Extrusion Line 3", [
  {
    startDate: "2024-01-03T10:00:00Z",
    endDate: "2024-01-03T12:00:00Z",
    reason: "Planned lubrication service",
  },
]);

const s3 = [
  makeWO("A", "2024-01-01T08:00:00Z", "2024-01-01T10:00:00Z", 120,  "wc-3"),
  makeWO("B", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z", 120,  "wc-3", ["A"]),
  makeWO("C", "2024-01-01T08:00:00Z", "2024-01-01T08:00:00Z", 480,  "wc-3", ["B"]),
  makeWO("D", "2024-01-01T08:00:00Z", "2024-01-01T08:00:00Z", 480,  "wc-3", ["C"]),
  makeWO("E", "2024-01-01T08:00:00Z", "2024-01-01T08:00:00Z", 240,  "wc-3", ["D"]),
];

printWorkOrders("Before reflow:", s3);
const r3 = service.reflow({ workOrders: s3, workCenters: [wc3] });
printWorkOrders("After reflow (E must skip Wed 10:00–12:00 maintenance):", r3.updatedWorkOrders);
printChanges(r3.changes);
printMetrics(r3.metrics);
console.log(`\n  💬 ${r3.explanation}`);

console.log("\n" + "═".repeat(60));
console.log("  ✅ All scenarios completed successfully.");
console.log("═".repeat(60) + "\n");