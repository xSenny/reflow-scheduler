/**
 * JSON data test — loads work-centers.json and work-orders.json, runs reflow,
 * and verifies that every work order in the produced schedule satisfies all
 * hard constraints.
 *
 * Run:  npx tsx src/tests/json-test.ts
 */

import { readFileSync } from "fs";
import { join } from "path";
import { ReflowService } from "../reflow/reflow.service";
import { checkConstraints } from "../reflow/constraint-checker";
import type { WorkOrder, WorkCenter } from "../reflow/types";

// ─── Load data ───────────────────────────────────────────────────────────────

const dataDir = join(process.cwd(), "src", "data");

const workCenters: WorkCenter[] = JSON.parse(
  readFileSync(join(dataDir, "work-centers.json"), "utf-8"),
);

const workOrders: WorkOrder[] = JSON.parse(
  readFileSync(join(dataDir, "work-orders.json"), "utf-8"),
);

console.log(`Loaded ${workCenters.length} work centers`);
console.log(`Loaded ${workOrders.length} work orders`);
console.log(`  └─ ${workOrders.filter(w => w.data.isMaintenance).length} maintenance (immovable)`);
console.log(`  └─ ${workOrders.filter(w => !w.data.isMaintenance).length} production\n`);

// ─── Run reflow ───────────────────────────────────────────────────────────────

const service = new ReflowService();
const startTime = Date.now();

console.log("Running reflow...");
const result = service.reflow({ workOrders, workCenters });
const elapsed = Date.now() - startTime;

console.log(`Done in ${elapsed}ms\n`);

// ─── Validate ─────────────────────────────────────────────────────────────────

const violations = checkConstraints(result.updatedWorkOrders, workCenters);

if (violations.length > 0) {
  console.log(`❌ FAIL — ${violations.length} constraint violation(s):`);
  for (const v of violations) {
    console.log(`   [${v.type}] ${v.message}`);
  }
  process.exit(1);
}

// ─── Report ───────────────────────────────────────────────────────────────────

console.log(`✅ All ${result.updatedWorkOrders.length} work orders passed constraint check\n`);

console.log("📊 Metrics:");
console.log(`   Affected work orders : ${result.metrics.affectedWorkOrders}`);
console.log(`   Total delay          : ${result.metrics.totalDelayMinutes} minutes`);
console.log(`                          (~${(result.metrics.totalDelayMinutes / 60).toFixed(1)} hours)\n`);

console.log(`💬 ${result.explanation}\n`);

// ─── Sample of changes ────────────────────────────────────────────────────────

if (result.changes.length > 0) {
  const sample = result.changes.slice(0, 8);
  console.log(`📋 First ${sample.length} changes (of ${result.changes.length} total):`);

  for (const c of sample) {
    const sign = c.endShiftMinutes >= 0 ? "+" : "";
    const orig = new Date(c.originalStart).toISOString().slice(0, 16).replace("T", " ");
    const updated = new Date(c.newStart).toISOString().slice(0, 16).replace("T", " ");
    console.log(
      `   ${c.workOrderNumber.padEnd(10)} ${orig} → ${updated}  (${sign}${c.endShiftMinutes}min)  ${c.reasons[0]}`,
    );
  }

  if (result.changes.length > 8) {
    console.log(`   ... and ${result.changes.length - 8} more`);
  }
}

// ─── Per-work-center summary ──────────────────────────────────────────────────

console.log("\n🏭 Work center load:");
const wcLoad = new Map<string, number>();
for (const wo of result.updatedWorkOrders.filter(w => !w.data.isMaintenance)) {
  wcLoad.set(wo.data.workCenterId, (wcLoad.get(wo.data.workCenterId) ?? 0) + wo.data.durationMinutes);
}
for (const [wcId, mins] of [...wcLoad.entries()].sort((a, b) => b[1] - a[1])) {
  const wc = workCenters.find(w => w.docId === wcId)!;
  console.log(`   ${wc.data.name.padEnd(22)} ${mins} min  (~${(mins / 60).toFixed(1)}h)`);
}

// ─── Write output files ───────────────────────────────────────────────────────

const outDir = join(process.cwd(), "output");
import { mkdirSync, writeFileSync as wfs } from "fs";
mkdirSync(outDir, { recursive: true });

// 1. Full updated schedule
wfs(
  join(outDir, "updated-work-orders.json"),
  JSON.stringify(result.updatedWorkOrders, null, 2),
);

// 2. All changes
wfs(
  join(outDir, "changes.json"),
  JSON.stringify(result.changes, null, 2),
);

// 3. Human-readable report
const lines: string[] = [];
lines.push("REFLOW REPORT");
lines.push("=".repeat(60));
lines.push(`Run date      : ${new Date().toISOString()}`);
lines.push(`Work orders   : ${result.updatedWorkOrders.length}`);
lines.push(`Changes       : ${result.changes.length}`);
lines.push(`Total delay   : ${result.metrics.totalDelayMinutes} min (~${(result.metrics.totalDelayMinutes/60).toFixed(1)}h)`);
lines.push(`Explanation   : ${result.explanation}`);
lines.push("");
lines.push("ALL CHANGES");
lines.push("-".repeat(60));

for (const c of result.changes) {
  const origEnd = new Date(c.originalEnd).toISOString().slice(0,16).replace("T"," ");
  const newEnd  = new Date(c.newEnd).toISOString().slice(0,16).replace("T"," ");
  const sign    = c.endShiftMinutes >= 0 ? "+" : "";
  lines.push(`${c.workOrderNumber.padEnd(12)} ${origEnd} → ${newEnd}  (${sign}${c.endShiftMinutes}min)  ${c.reasons[0]}`);
}

lines.push("");
lines.push("WORK CENTER LOAD");
lines.push("-".repeat(60));
for (const [wcId, mins] of [...wcLoad.entries()].sort((a,b) => b[1]-a[1])) {
  const wc = workCenters.find(w => w.docId === wcId)!;
  lines.push(`${wc.data.name.padEnd(24)} ${String(mins).padStart(6)} min  (~${(mins/60).toFixed(1)}h)`);
}

wfs(join(outDir, "report.txt"), lines.join("\n") + "\n");

console.log("\n📁 Output files written to /output:");
console.log("   updated-work-orders.json  — full rescheduled work orders");
console.log("   changes.json              — all " + result.changes.length + " changes with reasons");
console.log("   report.txt                — human-readable summary");