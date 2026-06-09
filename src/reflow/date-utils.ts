import type { Shift, MaintenanceWindow, Interval } from "./types";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

// All timestamps are UTC epoch milliseconds internally.
// Conversion to/from ISO strings happens only at the edges.

export const toMs = (iso: string): number => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`Invalid date string: ${iso}`);
  return t;
};

export const toIso = (ms: number): string => new Date(ms).toISOString();

export const minutesBetween = (startMs: number, endMs: number): number =>
  Math.round((endMs - startMs) / MINUTE_MS);

export const overlaps = (a: Interval, b: Interval): boolean =>
  a.start < b.end && b.start < a.end;

const startOfUtcDay = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

// Returns concrete shift intervals for a single UTC calendar day, sorted by start.
function shiftsForDay(dayStartMs: number, shifts: Shift[]): Interval[] {
  const dayOfWeek = new Date(dayStartMs).getUTCDay();
  return shifts
    .filter((sh) => sh.dayOfWeek === dayOfWeek)
    .map((sh) => ({
      start: dayStartMs + sh.startHour * 60 * MINUTE_MS,
      end: dayStartMs + sh.endHour * 60 * MINUTE_MS,
    }))
    .filter((iv) => iv.end > iv.start)
    .sort((a, b) => a.start - b.start);
}

// Merges overlapping/adjacent maintenance windows into a sorted, non-overlapping list.
export function normalizeMaintenance(windows: MaintenanceWindow[]): Interval[] {
  const sorted = windows
    .map((w) => ({ start: toMs(w.startDate), end: toMs(w.endDate) }))
    .filter((iv) => iv.start < iv.end)
    .sort((a, b) => a.start - b.start);

  const merged: Interval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...iv });
    } else if (iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

// Finds the earliest instant >= fromMs that falls inside a shift and outside maintenance.
// Throws if no working time is found within the lookahead window.
export function nextWorkingInstant(
  fromMs: number,
  shifts: Shift[],
  blocked: Interval[],
  maxLookaheadDays = 366,
): number {
  if (shifts.length === 0) throw new Error("Work center has no shifts defined.");

  const horizon = startOfUtcDay(fromMs) + (maxLookaheadDays + 1) * DAY_MS;
  let cursor = fromMs;

  while (cursor < horizon) {
    const day = startOfUtcDay(cursor);
    const todaysShifts = shiftsForDay(day, shifts);

    let candidate: number | null = null;
    for (const shift of todaysShifts) {
      if (cursor < shift.end) {
        candidate = Math.max(cursor, shift.start);
        break;
      }
    }

    if (candidate === null) {
      cursor = day + DAY_MS;
      continue;
    }

    // If the candidate lands inside a maintenance window, skip past it and retry.
    const c = candidate;
    const maintEnd = blocked.find((b) => c >= b.start && c < b.end)?.end;
    if (maintEnd !== undefined) {
      cursor = maintEnd;
      continue;
    }

    return candidate;
  }

  throw new Error(
    `No available working time found within ${maxLookaheadDays} days from ${toIso(fromMs)}`,
  );
}

// Returns the end of the contiguous working segment starting at cursor:
// either the shift end or the next maintenance window start, whichever comes first.
const currentSegmentEnd = (
  cursor: number,
  shifts: Shift[],
  blocked: Interval[],
): number => {
  const day = startOfUtcDay(cursor);
  const shift = shiftsForDay(day, shifts).find(
    (sh) => cursor >= sh.start && cursor < sh.end,
  );
  if (!shift) throw new Error(`${toIso(cursor)} is not inside any shift.`);

  let end = shift.end;
  for (const b of blocked) {
    if (b.start > cursor && b.start < end) end = b.start;
  }
  return end;
};

// Advances durationMinutes of working time from startMs, pausing at shift
// boundaries and skipping maintenance windows. Returns the actual start (snapped
// to the next valid instant) and the end of the last working minute.
export function addWorkingMinutes(
  startMs: number,
  durationMinutes: number,
  shifts: Shift[],
  blocked: Interval[],
): { start: number; end: number } {
  if (durationMinutes <= 0) {
    return { start: startMs, end: startMs };
  }

  let cursor = nextWorkingInstant(startMs, shifts, blocked);
  const actualStart = cursor;
  let remaining = durationMinutes;

  while (remaining > 0) {
    const segEnd = currentSegmentEnd(cursor, shifts, blocked);
    const availableMinutes = (segEnd - cursor) / MINUTE_MS;

    if (remaining <= availableMinutes) {
      return { start: actualStart, end: cursor + remaining * MINUTE_MS };
    }

    remaining -= availableMinutes;
    cursor = nextWorkingInstant(segEnd, shifts, blocked);
  }

  throw new Error("addWorkingMinutes: loop ended without a result");
}

// Returns total shift minutes available in [spanStart, spanEnd), ignoring maintenance.
// Used for utilization metrics.
export function availableShiftMinutes(
  _spanStart: number,
  _spanEnd: number,
  _shifts: Shift[],
): number {
  // @upgrade: implement per-work-center utilization tracking
  return 0;
}