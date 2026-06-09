/**
 * Quick check for your dag.ts implementation.
 *
 * Run:  npx tsx src/reflow/dag.check.ts
 *
 * Rename dag.skeleton.ts to dag.ts before running.
 */

import { topologicalSort, CyclicDependencyError, MissingDependencyError } from "../reflow/dag";
import type { WorkOrder } from "../reflow/types";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${label}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? passed++ : failed++;
}

// Helper to build a minimal work order for testing
function wo(id: string, parents: string[]): WorkOrder {
  return {
    docId: id,
    docType: "workOrder",
    data: {
      workOrderNumber: id,
      manufacturingOrderId: "mo-1",
      workCenterId: "wc-1",
      startDate: "2024-01-01T08:00:00Z",
      endDate: "2024-01-01T10:00:00Z",
      durationMinutes: 120,
      isMaintenance: false,
      dependsOnWorkOrderIds: parents,
    },
  };
}

// 1) No dependencies — any order is valid, just check all IDs are present.
const simple = [wo("A", []), wo("B", []), wo("C", [])];
const simpleResult = topologicalSort(simple);
check(
  "no deps — all IDs present",
  simpleResult.length === 3 && ["A","B","C"].every(id => simpleResult.includes(id)),
  `got: ${simpleResult}`
);

// 2) Linear chain A → B → C — A must come before B, B before C.
const chain = [wo("C", ["B"]), wo("B", ["A"]), wo("A", [])];
const chainResult = topologicalSort(chain);
check(
  "linear chain A→B→C — correct order",
  chainResult.indexOf("A") < chainResult.indexOf("B") &&
  chainResult.indexOf("B") < chainResult.indexOf("C"),
  `got: ${chainResult}`
);

// 3) Diamond: A → B, A → C, B → D, C → D — A first, D last, B and C in between.
const diamond = [wo("D", ["B","C"]), wo("B", ["A"]), wo("C", ["A"]), wo("A", [])];
const diamondResult = topologicalSort(diamond);
check(
  "diamond A→B,C→D — A first, D last",
  diamondResult[0] === "A" && diamondResult[diamondResult.length - 1] === "D",
  `got: ${diamondResult}`
);
check(
  "diamond — B and C both before D",
  diamondResult.indexOf("B") < diamondResult.indexOf("D") &&
  diamondResult.indexOf("C") < diamondResult.indexOf("D"),
  `got: ${diamondResult}`
);

// 4) Cycle: A → B → C → A — must throw CyclicDependencyError.
const cycle = [wo("A", ["C"]), wo("B", ["A"]), wo("C", ["B"])];
let caughtCycle = false;
try {
  topologicalSort(cycle);
} catch (e) {
  caughtCycle = e instanceof CyclicDependencyError;
}
check("cycle A→B→C→A — throws CyclicDependencyError", caughtCycle);

// 5) Missing dependency — throws MissingDependencyError.
const missing = [wo("A", ["GHOST"])];
let caughtMissing = false;
try {
  topologicalSort(missing);
} catch (e) {
  caughtMissing = e instanceof MissingDependencyError;
}
check("missing parent — throws MissingDependencyError", caughtMissing);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);