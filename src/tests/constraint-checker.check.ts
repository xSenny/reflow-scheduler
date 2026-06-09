/**
 * Quick check for your constraint-checker.ts implementation.
 *
 * Run:  npx tsx src/reflow/constraint-checker.check.ts
 *
 * Rename constraint-checker.skeleton.ts to constraint-checker.ts first.
 */

import { checkConstraints } from "../reflow/constraint-checker";
import type { WorkOrder, WorkCenter } from "../reflow/types";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${label}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? passed++ : failed++;
}

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

// Mon–Fri 08:00–17:00 UTC. 2024-01-01 = Monday.
const wc: WorkCenter = {
  docId: "wc-1",
  docType: "workCenter",
  data: {
    name: "Line 1",
    shifts: [1, 2, 3, 4, 5].map(d => ({ dayOfWeek: d, startHour: 8, endHour: 17 })),
    maintenanceWindows: [
      { startDate: "2024-01-03T10:00:00Z", endDate: "2024-01-03T12:00:00Z", reason: "Planned service" },
    ],
  },
};

function makeWO(
  id: string,
  start: string,
  end: string,
  duration: number,
  parents: string[] = [],
  isMaintenance = false,
): WorkOrder {
  return {
    docId: id,
    docType: "workOrder",
    data: {
      workOrderNumber: id,
      manufacturingOrderId: "mo-1",
      workCenterId: "wc-1",
      startDate: start,
      endDate: end,
      durationMinutes: duration,
      isMaintenance,
      dependsOnWorkOrderIds: parents,
    },
  };
}

// ---------------------------------------------------------------------------
// Test 1: valid schedule — no violations
// ---------------------------------------------------------------------------
const validA = makeWO("A", "2024-01-01T08:00:00Z", "2024-01-01T10:00:00Z", 120);
const validB = makeWO("B", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z", 120, ["A"]);

const noViolations = checkConstraints([validA, validB], [wc]);
check("valid schedule — no violations", noViolations.length === 0, JSON.stringify(noViolations));

// ---------------------------------------------------------------------------
// Test 2: dependency violation — B starts before A finishes
// ---------------------------------------------------------------------------
const depA = makeWO("A", "2024-01-01T08:00:00Z", "2024-01-01T10:00:00Z", 120);
const depB = makeWO("B", "2024-01-01T09:00:00Z", "2024-01-01T11:00:00Z", 120, ["A"]); // starts too early

const depViolations = checkConstraints([depA, depB], [wc]);
check(
  "dependency violation detected",
  depViolations.some(v => v.type === "dependency"),
  JSON.stringify(depViolations),
);

// ---------------------------------------------------------------------------
// Test 3: work center conflict — two orders overlap on same machine
// ---------------------------------------------------------------------------
const conflictA = makeWO("A", "2024-01-01T08:00:00Z", "2024-01-01T11:00:00Z", 180);
const conflictB = makeWO("B", "2024-01-01T10:00:00Z", "2024-01-01T13:00:00Z", 180); // overlaps A

const conflictViolations = checkConstraints([conflictA, conflictB], [wc]);
check(
  "work center conflict detected",
  conflictViolations.some(v => v.type === "workCenterConflict"),
  JSON.stringify(conflictViolations),
);

// ---------------------------------------------------------------------------
// Test 4: shift violation — order placed outside shift hours
// ---------------------------------------------------------------------------
// endDate says 19:00 but shift ends at 17:00 — inconsistent with durationMinutes
const shiftWO = makeWO("A", "2024-01-01T08:00:00Z", "2024-01-01T19:00:00Z", 120);

const shiftViolations = checkConstraints([shiftWO], [wc]);
check(
  "shift violation detected",
  shiftViolations.some(v => v.type === "shift"),
  JSON.stringify(shiftViolations),
);

// ---------------------------------------------------------------------------
// Test 5: maintenance violation — order overlaps maintenance window
// (Wed 2024-01-03 10:00–12:00 is blocked)
// ---------------------------------------------------------------------------
const maintWO = makeWO("A", "2024-01-03T09:00:00Z", "2024-01-03T13:00:00Z", 240);

const maintViolations = checkConstraints([maintWO], [wc]);
check(
  "maintenance violation detected",
  maintViolations.some(v => v.type === "maintenance"),
  JSON.stringify(maintViolations),
);

// ---------------------------------------------------------------------------
// Test 6: isMaintenance orders are exempt from shift + maintenance checks
// ---------------------------------------------------------------------------
const maintOrder = makeWO("MAINT", "2024-01-03T10:00:00Z", "2024-01-03T12:00:00Z", 120, [], true);

const maintOrderViolations = checkConstraints([maintOrder], [wc]);
check(
  "isMaintenance order — no shift/maintenance violations",
  !maintOrderViolations.some(v => v.type === "shift" || v.type === "maintenance"),
  JSON.stringify(maintOrderViolations),
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);