import type { ActiveTimer, Interval } from './db';
import { addLocalDays, startOfLocalDay } from './time';

export type Period = 'day' | 'week' | 'month';

export interface Range {
  start: number;
  end: number;
  /** Local midnights of each day in the range. */
  days: number[];
}

/** The local day / Monday-based week / calendar month containing `anchor`. */
export function periodRange(period: Period, anchor: number): Range {
  const d = startOfLocalDay(anchor);
  let start: Date;
  let end: Date;
  if (period === 'day') {
    start = d;
    end = addLocalDays(d, 1);
  } else if (period === 'week') {
    start = addLocalDays(d, -((d.getDay() + 6) % 7));
    end = addLocalDays(start, 7);
  } else {
    start = new Date(d.getFullYear(), d.getMonth(), 1);
    end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  const days: number[] = [];
  for (let t = start; t < end; t = addLocalDays(t, 1)) days.push(t.getTime());
  return { start: start.getTime(), end: end.getTime(), days };
}

/** Anchor of the period `n` steps before/after the one containing `anchor`. */
export function shiftPeriod(period: Period, anchor: number, n: number) {
  const d = startOfLocalDay(anchor);
  if (period === 'day') return addLocalDays(d, n).getTime();
  if (period === 'week') return addLocalDays(d, 7 * n).getTime();
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}

export function periodLabel(period: Period, r: Range, now: number) {
  const current = r.start <= now && now < r.end;
  if (period === 'day') {
    if (current) return 'Today';
    if (periodRange('day', now - 86_400_000).start === r.start) return 'Yesterday';
    return new Date(r.start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  }
  if (period === 'week') {
    const a = new Date(r.start);
    const b = new Date(r.days[r.days.length - 1]);
    const sameMonth = a.getMonth() === b.getMonth();
    const left = a.toLocaleDateString([], sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
    const right = b.toLocaleDateString([], { day: 'numeric', month: 'short' });
    return `${current ? 'This week · ' : ''}${left} – ${right}`;
  }
  return new Date(r.start).toLocaleDateString([], { month: 'long', year: 'numeric' });
}

export interface Report {
  /** Tracked ms in the range. */
  total: number;
  /** ms of the range that could have been tracked: from first-ever data (or range start) to now (or range end). */
  available: number;
  /** Days of the range that are at least partly available. */
  availableDays: number;
  byArea: Map<string, number>;
  bySub: Map<string, Map<string | null, number>>;
  /** Per day of `range.days`: ms per area. */
  perDay: Map<string, number>[];
  /** The whole period split into what isn't tracked time (see `Rest`). */
  rest: Rest;
  /** The same split for each day of `range.days`. */
  perDayRest: Rest[];
}

/**
 * The untracked part of a span: `length` = tracked + untracked + upcoming + noData.
 * - untracked: past time with no record
 * - upcoming:  time that hasn't happened yet
 * - noData:    past time before the very first record (tracking hadn't started)
 */
export interface Rest {
  length: number;
  untracked: number;
  upcoming: number;
  noData: number;
}

function restOf(a: number, b: number, tracked: number, now: number, firstEver: number | null): Rest {
  const len = (x: number, y: number) => Math.max(0, y - x);
  const length = b - a;
  const upcoming = len(Math.max(a, now), b);
  const noData = len(a, Math.min(b, now, firstEver ?? Infinity));
  const untracked = Math.max(0, length - upcoming - noData - tracked);
  return { length, untracked, upcoming, noData };
}

interface Piece {
  areaId: string;
  subAreaId: string | null;
  start: number;
  end: number;
}

/**
 * Aggregate intervals (plus the running timer, up to `now`) into a range.
 * All arithmetic is on UTC instants; local days only define the bucket edges.
 */
export function buildReport(
  range: Range,
  intervals: Interval[],
  active: ActiveTimer | undefined,
  now: number,
  firstEver: number | null,
): Report {
  const pieces: Piece[] = intervals.map((i) => ({
    areaId: i.areaId,
    subAreaId: i.subAreaId,
    start: new Date(i.start).getTime(),
    end: new Date(i.end).getTime(),
  }));
  if (active) {
    const s = new Date(active.start).getTime();
    if (now > s) pieces.push({ areaId: active.areaId, subAreaId: active.subAreaId, start: s, end: now });
  }

  const byArea = new Map<string, number>();
  const bySub = new Map<string, Map<string | null, number>>();
  const perDay = range.days.map(() => new Map<string, number>());
  const dayEdges = [...range.days, range.end];
  let total = 0;

  for (const p of pieces) {
    const s = Math.max(p.start, range.start);
    const e = Math.min(p.end, range.end);
    if (e <= s) continue;
    const ms = e - s;
    total += ms;
    byArea.set(p.areaId, (byArea.get(p.areaId) ?? 0) + ms);
    const subs = bySub.get(p.areaId) ?? new Map<string | null, number>();
    subs.set(p.subAreaId, (subs.get(p.subAreaId) ?? 0) + ms);
    bySub.set(p.areaId, subs);
    for (let d = 0; d < range.days.length; d++) {
      const ds = Math.max(s, dayEdges[d]);
      const de = Math.min(e, dayEdges[d + 1]);
      if (de > ds) perDay[d].set(p.areaId, (perDay[d].get(p.areaId) ?? 0) + (de - ds));
    }
  }

  const from = Math.max(range.start, firstEver ?? Infinity);
  const to = Math.min(range.end, now);
  const available = Math.max(0, to - from);
  const availableDays = range.days.filter((d, i) => dayEdges[i + 1] > from && d < to).length;

  const rest = restOf(range.start, range.end, total, now, firstEver);
  const perDayRest = range.days.map((d, i) =>
    restOf(d, dayEdges[i + 1], [...perDay[i].values()].reduce((x, y) => x + y, 0), now, firstEver),
  );

  return { total, available, availableDays, byArea, bySub, perDay, rest, perDayRest };
}
