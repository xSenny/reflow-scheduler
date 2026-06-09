/**
 * Verificare rapidă pentru implementarea ta din date-utils.ts.
 *
 * Rulează:  npx tsx src/reflow/date-utils.check.ts
 *
 * NU e un test formal (Jest/Vitest) — e doar un runner cu assert-uri care
 * printează PASS/FAIL, ca să ai feedback imediat în timp ce implementezi.
 * Când treci toate, poți rescrie astea ca teste reale (bonus).
 *
 * IMPORTANT: redenumește scheletul în `date-utils.ts` ca importul de mai jos să meargă.
 */

import {
  addWorkingMinutes,
  nextWorkingInstant,
  normalizeMaintenance,
  toMs,
  toIso,
} from "../reflow/date-utils";

let passed = 0;
let failed = 0;

function check(label: string, got: string, expected: string) {
  const ok = got === expected;
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${label}`);
  if (!ok) console.log(`        așteptat: ${expected}\n        primit:   ${got}`);
  ok ? passed++ : failed++;
}

// Shift standard: Luni–Vineri 08:00–17:00 UTC. (2024-01-01 e Luni.)
const shifts = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startHour: 8, endHour: 17 }));

//1) Exemplul din spec: 120 min, start Luni 16:00 -> Marți 09:00.
check(
  "exemplul din spec (120min, Luni 16:00 -> Marți 09:00)",
  toIso(addWorkingMinutes(toMs("2024-01-01T16:00:00Z"), 120, shifts, []).end),
  "2024-01-02T09:00:00.000Z"
);

// 2) Start în afara shiftului (Sâmbătă) -> snap la următoarea Luni 08:00.
check(
  "snap Sâmbătă -> Luni 08:00",
  toIso(nextWorkingInstant(toMs("2024-01-06T10:00:00Z"), shifts, [])),
  "2024-01-08T08:00:00.000Z"
);

// 3) Mentenanță la mijloc de shift: 60 min de la Luni 08:00, mentenanță 08:30–09:00 -> 09:30.
const maint = normalizeMaintenance([
  { startDate: "2024-01-01T08:30:00Z", endDate: "2024-01-01T09:00:00Z" },
]);
check(
  "sare peste mentenanță (60min, 08:00, maint 08:30-09:00 -> 09:30)",
  toIso(addWorkingMinutes(toMs("2024-01-01T08:00:00Z"), 60, shifts, maint).end),
  "2024-01-01T09:30:00.000Z"
);

// 4) Shift complet fix: 540 min (9h) de la Luni 08:00 -> exact Luni 17:00.
check(
  "shift complet (540min, Luni 08:00 -> Luni 17:00)",
  toIso(addWorkingMinutes(toMs("2024-01-01T08:00:00Z"), 540, shifts, []).end),
  "2024-01-01T17:00:00.000Z"
);

// 5) Depășire peste noapte: 600 min (10h) de la Luni 08:00 -> Marți 09:00.
check(
  "depășire peste noapte (600min, Luni 08:00 -> Marți 09:00)",
  toIso(addWorkingMinutes(toMs("2024-01-01T08:00:00Z"), 600, shifts, []).end),
  "2024-01-02T09:00:00.000Z"
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);