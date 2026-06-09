# Production Schedule Reflow Scheduler

A TypeScript scheduling engine that reschedules manufacturing work orders when disruptions occur, while respecting all hard constraints: dependencies, work center conflicts, shift boundaries, and maintenance windows.

---

## Quick Start

```bash
npm install
npm run demo          # run all 3 demo scenarios
npm run test          # test the algorithm with your own data set in /src/data
```

Individual check scripts (unit-level):

This checks each unit's algorithms through some AI generated tests

```bash
npx tsx src/reflow/date-utils.check.ts
npx tsx src/reflow/dag.check.ts
npx tsx src/reflow/constraint-checker.check.ts
npx tsx src/reflow/reflow.service.check.ts
```


---

## Algorithm Approach

The reflow algorithm runs in 5 steps:

### Step 1 — Build lookups
Index work orders and work centers by ID for O(1) access throughout the algorithm.

### Step 2 — Topological sort (DAG)
Sort work orders so every parent always precedes its children. Uses **Kahn's algorithm** (BFS-based), which also detects circular dependencies and surfaces them as a `CyclicDependencyError` with the exact cycle listed.

### Step 3 — Seed occupancy map
Before placing any movable orders, reserve all immovable time on each work center:
- `isMaintenance` work orders (fixed, cannot be rescheduled)
- Work center maintenance windows (blocked calendar time)

### Step 4 — Place each work order
Process work orders in topological order. For each movable order:

```
earliestStart = max(
  order's original startDate,       // don't pull orders earlier than planned
  max(all parents' new endDates)     // respect dependencies
)

loop:
  candidate = addWorkingMinutes(earliestStart, duration, shifts, maintenance)
  if candidate overlaps any occupied slot on this work center:
    push earliestStart to end of conflicting slot → retry
  else:
    accept placement, reserve slot
```

`addWorkingMinutes` handles shift boundaries and maintenance transparently: it advances working time forward, pausing at shift end and resuming at the next shift start, skipping over maintenance windows.

### Step 5 — Self-check + result
Run `checkConstraints()` on the produced schedule as a safety net. Any violation means there's a bug in the algorithm — it surfaces loudly rather than silently returning a broken schedule.

---

## Scenarios

| # | Name | Description |
|---|------|-------------|
| 1 | Delay Cascade | A runs long → B and C (downstream) get pushed |
| 2 | Shift Boundary | 600-min order spans across end of shift into next day |
| 3 | Maintenance Conflict | Order chain lands during a blocked window → pushed past it |
| 4 | Multi Work Center | Orders on separate machines — no cross-machine conflicts |
| 5 | Complex Chain | 3-level dependency chain + maintenance + shift boundary combined |

Run all scenarios: `npm run demo`

---

## Running Tests

### Quick checks (per module)
Each module has a `*.check.ts` file that tests its logic in isolation:

```bash
npx tsx src/reflow/date-utils.check.ts        # 5 cases
npx tsx src/reflow/dag.check.ts               # 6 cases (incl. cycle detection)
npx tsx src/reflow/constraint-checker.check.ts # 6 cases
npx tsx src/reflow/reflow.service.check.ts     # 8 cases (3 scenarios)
```

## Design Decisions & Trade-offs

### No Luxon dependency
The spec recommends Luxon, but every timestamp is UTC and every shift is expressed in integer UTC hours — no timezone or DST math is needed. A small dependency-free UTC layer (`date-utils.ts`) keeps the core testable with zero install and makes the shift arithmetic fully explicit. Swapping in Luxon or the TC39 Temporal API later only touches `date-utils.ts`.

### Don't pull orders earlier than original
When computing `earliestStart`, we take `max(originalStart, parentEnd)` — never just `parentEnd`. This means reflow only *pushes* orders later, never silently pulls them earlier. Pulling earlier could violate material availability or customer commitments that aren't modelled here.

### Wall-clock occupancy for work center conflicts
A work order occupies its work center for its full wall-clock span `[start, end]`, even during overnight pauses. This matches physical reality: a job mounted on a machine isn't available for another job during the pause, even if no work is progressing.

### Topological sort before placement
Processing in dependency order means that when we place work order B, work order A (its parent) is already placed and its new end date is known. This single-pass approach avoids iterative re-scheduling.

### Separate `constraint-checker.ts`
The validator is decoupled from the algorithm so it can be used both as an internal safety net and as the assertion backbone for tests. If `checkConstraints()` returns violations after reflow, it means there's a bug — we'd rather throw than silently return a broken schedule.

---

## Known Limitations & Upgrade Notes


overnight shifts (endHour < startHour) are not supported.
Assumption: all shifts have startHour < endHour within the same UTC day.

availableShiftMinutes() in date-utils.ts is stubbed.
Implement to enable per-work-center utilization metrics.

utilization field in metrics is always {}.
Wire up availableShiftMinutes() across the schedule span.

reasons in ScheduleChange are heuristic (dependency vs. conflict).
A more precise approach would track the exact cause during placement.


## AI Collaboration

See [`ai-collaboration.md`](ai-collaboration.md) for the prompts and decisions made with AI assistance during development.