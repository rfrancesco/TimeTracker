import { db, nowIso, uuid, type ActiveTimer, type Interval } from './db';
import { formatClock } from './time';

/**
 * THE invariant of the time data. Every write that changes when an interval or
 * the running timer starts/ends must go through this module.
 *
 *  1. Each interval has start < end <= now (no future time is ever recorded).
 *  2. Intervals never overlap (touching end-to-start is fine).
 *  3. If a timer is running, every interval ends at or before its start,
 *     and its start is not in the future.
 *
 * Because of (1) and (3), starting a timer "now" can never create an overlap.
 */

const ms = (iso: string) => new Date(iso).getTime();
/**
 * Stands in for "open-ended". Must still sort correctly as an ISO string in index
 * queries: years past 9999 serialise as "+275760-…", which sorts before "2026-…".
 */
const FAR = Date.parse('9999-12-31T23:59:59.999Z');
const iso = (t: number) => new Date(t).toISOString();

export class ConstraintError extends Error {}

/** The edit would overlap existing time; `conflicts` lists what is in the way. */
export class OverlapError extends ConstraintError {
  constructor(
    public conflicts: Interval[],
    public activeConflict: ActiveTimer | null,
  ) {
    super('Overlaps existing time');
  }
}

interface Ops {
  deletes: string[];
  updates: Array<{ id: string; start?: string; end?: string }>;
  adds: Interval[];
}

/** How to carve [s, e) out of `others` so that a new interval there wins. */
function carve(others: Interval[], s: number, e: number): Ops {
  const ops: Ops = { deletes: [], updates: [], adds: [] };
  const t = nowIso();
  for (const c of others) {
    const cs = ms(c.start);
    const ce = ms(c.end);
    if (ce <= s || cs >= e) continue;
    if (cs >= s && ce <= e) ops.deletes.push(c.id);
    else if (cs < s && ce > e) {
      // c surrounds the new interval: keep both ends of it.
      ops.updates.push({ id: c.id, end: iso(s) });
      ops.adds.push({ ...c, id: uuid(), start: iso(e), updatedAt: t });
    } else if (cs < s) ops.updates.push({ id: c.id, end: iso(s) });
    else ops.updates.push({ id: c.id, start: iso(e) });
  }
  return ops;
}

async function applyOps(ops: Ops) {
  const t = nowIso();
  if (ops.deletes.length) await db.intervals.bulkDelete(ops.deletes);
  for (const u of ops.updates) await db.intervals.update(u.id, { ...u, updatedAt: t });
  if (ops.adds.length) await db.intervals.bulkAdd(ops.adds);
}

/** Intervals overlapping [s, e), optionally ignoring one id. */
async function overlapping(s: number, e: number, ignoreId?: string) {
  return db.intervals
    .where('start')
    .below(iso(e))
    .filter((i) => i.id !== ignoreId && ms(i.end) > s)
    .toArray();
}

function checkRange(s: number, e: number, now: number) {
  if (!(Number.isFinite(s) && Number.isFinite(e))) throw new ConstraintError('Invalid time');
  if (e <= s) throw new ConstraintError('End must be after start');
  if (e > now) throw new ConstraintError('Can’t record time in the future');
}

export interface IntervalInput {
  id?: string;
  areaId: string;
  subAreaId: string | null;
  start: number;
  end: number;
  note?: string;
}

/**
 * Create or update an interval.
 * Without `overwrite`, throws OverlapError if anything is in the way.
 * With `overwrite`, overlapping intervals are trimmed/split/removed and a
 * running timer that starts too early is moved to this interval's end.
 */
export async function saveInterval(input: IntervalInput, { overwrite = false } = {}) {
  const now = Date.now();
  checkRange(input.start, input.end, now);
  await db.transaction('rw', [db.intervals, db.active], async () => {
    const conflicts = await overlapping(input.start, input.end, input.id);
    const active = (await db.active.get('current')) ?? null;
    const activeConflict = active && ms(active.start) < input.end ? active : null;
    if ((conflicts.length || activeConflict) && !overwrite) throw new OverlapError(conflicts, activeConflict);
    await applyOps(carve(conflicts, input.start, input.end));
    if (activeConflict) await db.active.put({ ...activeConflict, start: iso(input.end) });
    const record = {
      areaId: input.areaId,
      subAreaId: input.subAreaId,
      start: iso(input.start),
      end: iso(input.end),
      note: input.note,
      updatedAt: nowIso(),
    };
    if (input.id) await db.intervals.update(input.id, record);
    else await db.intervals.add({ id: uuid(), ...record });
  });
}

/**
 * Change the running timer's start (and optionally its label).
 * Without `overwrite`, throws OverlapError if it would reach back into saved time;
 * with `overwrite`, saved time after the new start is trimmed/removed.
 */
export async function updateActive(
  patch: { start: number; areaId: string; subAreaId: string | null },
  { overwrite = false } = {},
) {
  const now = Date.now();
  if (!Number.isFinite(patch.start)) throw new ConstraintError('Invalid time');
  if (patch.start > now) throw new ConstraintError('Start must be in the past');
  await db.transaction('rw', [db.intervals, db.active], async () => {
    const conflicts = await overlapping(patch.start, FAR);
    if (conflicts.length && !overwrite) throw new OverlapError(conflicts, null);
    await applyOps(carve(conflicts, patch.start, FAR));
    await db.active.put({ key: 'current', areaId: patch.areaId, subAreaId: patch.subAreaId, start: iso(patch.start) });
  });
}

/**
 * Save the running timer's span [active.start, end). Must be called inside a
 * transaction on intervals+active. Under the invariant nothing can be in the way;
 * if something is anyway (e.g. the phone clock was moved back), the saved piece
 * is shortened rather than overlapping existing records.
 */
export async function commitTimerSpan(a: ActiveTimer, end: number): Promise<Interval | null> {
  let start = ms(a.start);
  if (end <= start) return null;
  const conflicts = await overlapping(start, end);
  for (const c of conflicts) start = Math.max(start, ms(c.end));
  if (end - start <= 0) return null;
  if ((await overlapping(start, end)).length) return null; // still blocked: drop rather than overlap
  const record: Interval = {
    id: uuid(),
    areaId: a.areaId,
    subAreaId: a.subAreaId,
    start: iso(start),
    end: iso(end),
    updatedAt: nowIso(),
  };
  await db.intervals.add(record);
  return record;
}

/** Free space around an interval, for clamping drags/resizes in the day view. */
export async function freeBounds(id: string, start: number, end: number) {
  const prev = await db.intervals
    .where('end')
    .belowOrEqual(iso(start))
    .filter((i) => i.id !== id)
    .reverse()
    .first();
  const next = await db.intervals
    .where('start')
    .aboveOrEqual(iso(end))
    .filter((i) => i.id !== id)
    .first();
  const active = await db.active.get('current');
  const limits = [Date.now(), next ? ms(next.start) : Infinity, active ? ms(active.start) : Infinity];
  return { min: prev ? ms(prev.end) : -Infinity, max: Math.min(...limits) };
}

/**
 * Bring arbitrary data (old databases, imported backups) in line with the
 * invariant. Later-edited intervals win over earlier-edited ones; future time
 * is cut off at `now`; a running timer starts after the last saved interval.
 */
export function normalize(intervals: Interval[], active: ActiveTimer | undefined, now: number) {
  let changed = 0;
  const byStart = [...intervals].sort((a, b) => a.start.localeCompare(b.start));

  // Fast path (every backup this app exports): already consistent, O(n log n).
  let clean = true;
  let prevEnd = -Infinity;
  for (const iv of byStart) {
    const s = ms(iv.start);
    const e = ms(iv.end);
    if (!(e > s) || e > now || s < prevEnd) {
      clean = false;
      break;
    }
    prevEnd = e;
  }

  let result: Interval[];
  if (clean) {
    result = byStart;
  } else {
    // Slow path, O(n log n) sweep: along the timeline, each stretch belongs to
    // the most recently edited interval covering it; consecutive stretches with
    // the same owner are joined back up. An interval cut in two keeps its id on
    // the first piece; later pieces get new ids.
    const items: Array<{ iv: Interval; s: number; e: number; rank: number }> = [];
    [...intervals]
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.start.localeCompare(b.start))
      .forEach((raw, rank) => {
        const s = ms(raw.start);
        const e = Math.min(ms(raw.end), now);
        if (e > s) items.push({ iv: raw, s, e, rank });
      });
    const times = [...new Set(items.flatMap((x) => [x.s, x.e]))].sort((a, b) => a - b);
    const starting = new Map<number, number[]>();
    items.forEach((x, i) => starting.set(x.s, [...(starting.get(x.s) ?? []), i]));

    // Max-heap of covering items by rank (lazy removal of ended ones).
    const heap: number[] = [];
    const higher = (a: number, b: number) => items[a].rank > items[b].rank;
    const push = (i: number) => {
      heap.push(i);
      for (let k = heap.length - 1; k > 0; ) {
        const parent = (k - 1) >> 1;
        if (!higher(heap[k], heap[parent])) break;
        [heap[k], heap[parent]] = [heap[parent], heap[k]];
        k = parent;
      }
    };
    const pop = () => {
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let k = 0; ; ) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && higher(heap[l], heap[m])) m = l;
          if (r < heap.length && higher(heap[r], heap[m])) m = r;
          if (m === k) break;
          [heap[k], heap[m]] = [heap[m], heap[k]];
          k = m;
        }
      }
    };

    const pieces = new Map<number, Array<[number, number]>>();
    for (let t = 0; t < times.length - 1; t++) {
      for (const i of starting.get(times[t]) ?? []) push(i);
      while (heap.length && items[heap[0]].e <= times[t]) pop();
      if (!heap.length) continue;
      const owner = heap[0];
      const list = pieces.get(owner) ?? [];
      const lastPiece = list[list.length - 1];
      if (lastPiece && lastPiece[1] === times[t]) lastPiece[1] = times[t + 1];
      else list.push([times[t], times[t + 1]]);
      pieces.set(owner, list);
    }

    result = [];
    const stamp = nowIso();
    items.forEach((x, i) => {
      const list = pieces.get(i) ?? [];
      const unchanged = list.length === 1 && list[0][0] === ms(x.iv.start) && list[0][1] === ms(x.iv.end);
      if (!unchanged) changed++;
      list.forEach(([s, e], k) =>
        result.push(
          unchanged
            ? x.iv
            : { ...x.iv, id: k === 0 ? x.iv.id : uuid(), start: iso(s), end: iso(e), updatedAt: k === 0 ? x.iv.updatedAt : stamp },
        ),
      );
    });
    changed += intervals.length - items.length; // dropped: empty or entirely in the future
    result.sort((a, b) => a.start.localeCompare(b.start));
  }

  let act = active;
  if (act) {
    const latestEnd = result.reduce((m, r) => Math.max(m, ms(r.end)), -Infinity);
    const start = Math.min(Math.max(ms(act.start), latestEnd), now);
    if (start !== ms(act.start)) {
      changed++;
      act = { ...act, start: iso(start) };
    }
  }
  return { intervals: result, active: act, changed };
}

/** Describe a conflict list for a confirmation dialog. */
export function describeConflicts(e: OverlapError, nameOf: (areaId: string) => string) {
  const day = (t: string) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
  const lines = e.conflicts
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 4)
    .map((c) => `${nameOf(c.areaId)}: ${day(c.start)} ${formatClock(c.start)}–${formatClock(c.end)}`);
  if (e.conflicts.length > 4) lines.push(`…and ${e.conflicts.length - 4} more`);
  if (e.activeConflict) lines.push(`Running ${nameOf(e.activeConflict.areaId)} timer (started ${formatClock(e.activeConflict.start)})`);
  return lines;
}
