# AI Collaboration — Prompts & Decisions

Here are some of the prompts I consider to be the most important, some of them weren't actually sent as one prompt but resulted from 2, 3 or more to make the list more compact

---

## Prompt 1 — Understanding the Problem

**Prompt:**
> Based on this technical spec, help me understand what I'm building. What are the key moving parts and what's the core mechanic that's hardest to get right?

**What I learned:**
The core insight was distinguishing **working time** from **wall-clock time**. A work order tracks minutes of *actual work*, not elapsed time. This means a 120-minute order that starts at 4PM doesn't end at 6PM — it ends at 9AM the next day (60 min Mon + 60 min Tue).

The four constraints were also clarified as a priority stack: dependencies → WC conflicts → shifts → maintenance.

---

## Prompt 2 — Shift-Aware Date Math

**Prompt:**
> I need to implement `addWorkingMinutes(start, duration, shifts, blocked)`. Walk me through the algorithm step by step. I want to understand it before I write any code.

**Key decisions from this conversation:**

- avoid timezones and use epoch milliseconds to compare the time
- The loop structure: at each step, find the *end of the current working segment* (either shift end or next maintenance start, whichever is first), consume as many minutes as available, then jump to the next working instant

---

## Prompt 3 — DAG and Topological Sort

**Prompt:**
> I need to sort work orders so parents always come before children. What algorithm should I use, and how does cycle detection fit in?

**Decision:** Kahn's algorithm (BFS-based) for the sort — simpler to implement and explain than DFS-based approaches. 
- if the result doesn't include all nodes, some were stuck in a cycle. DFS used separately in `findCycle()` to surface the actual cycle path for the error message.

---

## Prompt 4 — Work Center Conflict Resolution

**Prompt:**
> When placing a work order, how do I handle conflicts with already-placed orders on the same machine? What's the simplest correct approach?

**Decision:** The retry loop in `findPlacement()`:
1. Compute placement candidate with `addWorkingMinutes`
2. Check against occupancy intervals
3. If conflict found, push `earliestStart` to `conflict.end` and retry
4. Cap at 1000 iterations to prevent infinite loops on edge cases
---