/**
 * Scenario checks for reflow.service.ts.
 *
 * Run:  npx tsx src/reflow/reflow.service.check.ts
 *
 * Rename reflow.service.skeleton.ts to reflow.service.ts first.
 *
 * Three scenarios:
 *   1. Delay cascade   — A is late, B and C (downstream) get pushed
 *   2. Shift boundary  — large order spans across end of shift correctly
 *   3. Maintenance     — order gets pushed past a maintenance window
 */

import { ReflowService } from "../reflow/reflow.service";
import { checkConstraints } from "../reflow/constraint-checker";
import type { WorkOrder, WorkCenter } from "../reflow/types";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${label}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? passed++ : failed++;
}

const service = new ReflowService();

// Shared work center: Mon–Fri 08:00–17:00 UTC. 2024-01-01 = Monday.
function makeWC(id: string, maintenanceWindows: WorkCenter["data"]["maintenanceWindows"] = []): WorkCenter {
  return {
    docId: id,
    docType: "workCenter",
    data: {
      name: id,
      shifts: [1, 2, 3, 4, 5].map(d => ({ dayOfWeek: d, startHour: 8, endHour: 17 })),
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

// ---------------------------------------------------------------------------
// Scenario 1: Delay cascade
// A runs 08:00–12:00 (240 min, delayed — originally ended at 10:00).
// B depends on A, originally 10:00–12:00. Now stale — must be pushed after A.
// C depends on B, originally 12:00–14:00. Must be pushed after B.
// ---------------------------------------------------------------------------
console.log("\n── Scenario 1: Delay Cascade ──");
const wc1 = makeWC("wc-1");
const s1_A = makeWO("A", "2024-01-01T08:00:00Z", "2024-01-01T12:00:00Z", 240, "wc-1");
const s1_B = makeWO("B", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z", 120, "wc-1", ["A"]); // stale
const s1_C = makeWO("C", "2024-01-01T12:00:00Z", "2024-01-01T14:00:00Z", 120, "wc-1", ["B"]); // stale

const r1 = service.reflow({ workOrders: [s1_A, s1_B, s1_C], workCenters: [wc1] });

const violations1 = checkConstraints(r1.updatedWorkOrders, [wc1]);
check("scenario 1 — no constraint violations", violations1.length === 0, JSON.stringify(violations1));

const r1_B = r1.updatedWorkOrders.find(wo => wo.docId === "B")!;
const r1_A = r1.updatedWorkOrders.find(wo => wo.docId === "A")!;
check("scenario 1 — B starts after A ends", r1_B.data.startDate >= r1_A.data.endDate,
  `A ends ${r1_A.data.endDate}, B starts ${r1_B.data.startDate}`);

const r1_C = r1.updatedWorkOrders.find(wo => wo.docId === "C")!;
check("scenario 1 — C starts after B ends", r1_C.data.startDate >= r1_B.data.endDate,
  `B ends ${r1_B.data.endDate}, C starts ${r1_C.data.startDate}`);

check("scenario 1 — changes recorded", r1.changes.length > 0);
console.log("  Changes:", r1.changes.map(c => `${c.workOrderNumber}: +${c.endShiftMinutes}min`).join(", "));

// ---------------------------------------------------------------------------
// Scenario 2: Shift boundary
// One large order (600 min = 10h) starts Mon 08:00.
// Shift is 8h/day → must spill into Tuesday, end at Tue 10:00.
// ---------------------------------------------------------------------------
console.log("\n── Scenario 2: Shift Boundary ──");
const wc2 = makeWC("wc-2");
const s2_A = makeWO("A", "2024-01-01T08:00:00Z", "2024-01-01T08:00:00Z", 600, "wc-2");
// endDate in input is clearly wrong — reflow must fix it

const r2 = service.reflow({ workOrders: [s2_A], workCenters: [wc2] });

const violations2 = checkConstraints(r2.updatedWorkOrders, [wc2]);
check("scenario 2 — no constraint violations", violations2.length === 0, JSON.stringify(violations2));

const r2_A = r2.updatedWorkOrders.find(wo => wo.docId === "A")!;
check(
  "scenario 2 — 600min order ends Tue 09:00",
  r2_A.data.endDate === "2024-01-02T09:00:00.000Z",
  `got: ${r2_A.data.endDate}`,
);

// ---------------------------------------------------------------------------
// Scenario 3: Maintenance conflict
// Order starts Mon 08:00, 240 min. Maintenance Wed 10:00–12:00.
// After reflow the order must be placed without overlapping maintenance.
// ---------------------------------------------------------------------------
console.log("\n── Scenario 3: Maintenance Conflict ──");
const wc3 = makeWC("wc-3", [
  { startDate: "2024-01-03T10:00:00Z", endDate: "2024-01-03T12:00:00Z", reason: "Planned service" },
]);

// Place the order right before maintenance — it runs Mon fine, no conflict.
// Now add a second order that would land exactly during maintenance.
const s3_A = makeWO("A", "2024-01-01T08:00:00Z", "2024-01-01T10:00:00Z", 120, "wc-3");
const s3_B = makeWO("B", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z", 120, "wc-3", ["A"]);
// Force a scenario where reflow schedules something on Wed — give it 5 days of back-to-back work
const s3_C = makeWO("C", "2024-01-01T08:00:00Z", "2024-01-01T08:00:00Z", 480, "wc-3", ["B"]);
const s3_D = makeWO("D", "2024-01-01T08:00:00Z", "2024-01-01T08:00:00Z", 480, "wc-3", ["C"]);
const s3_E = makeWO("E", "2024-01-01T08:00:00Z", "2024-01-01T08:00:00Z", 240, "wc-3", ["D"]);
// E will land on Wed morning → must skip the 10:00–12:00 maintenance window

const r3 = service.reflow({ workOrders: [s3_A, s3_B, s3_C, s3_D, s3_E], workCenters: [wc3] });

const violations3 = checkConstraints(r3.updatedWorkOrders, [wc3]);
check("scenario 3 — no constraint violations", violations3.length === 0, JSON.stringify(violations3));
check("scenario 3 — E does not overlap maintenance",
  !r3.updatedWorkOrders.find(wo => wo.docId === "E")!.data.startDate.startsWith("2024-01-03T10") &&
  !r3.updatedWorkOrders.find(wo => wo.docId === "E")!.data.startDate.startsWith("2024-01-03T11"),
  `E starts: ${r3.updatedWorkOrders.find(wo => wo.docId === "E")!.data.startDate}`
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);