import { db, type ActiveTimer, type Interval } from './db';
import { ConstraintError, commitTimerSpan, updateActive } from './constraints';

/** Below this, switching relabels the running timer instead of splitting it, and stopping discards it. */
export const RELABEL_THRESHOLD_MS = 60_000;

const getActive = () => db.active.get('current');

/**
 * Start tracking `areaId`/`subAreaId`.
 * - nothing running → start
 * - same label running → no-op
 * - running < 1 min → relabel (keep start time)
 * - otherwise → close & save current interval, start a new one at the same instant
 */
/** What a track() call did, so it can be undone. */
export interface TrackResult {
  kind: 'start' | 'relabel' | 'split';
  before: ActiveTimer | null;
  after: ActiveTimer;
  saved: Interval | null; // the interval closed by a split
}

/**
 * Start tracking `areaId`/`subAreaId`.
 * - nothing running → start
 * - same label running → no-op (returns null)
 * - running < 1 min → relabel (keep start time)
 * - otherwise → close & save current interval, start a new one at the same instant
 */
export async function track(areaId: string, subAreaId: string | null): Promise<TrackResult | null> {
  // Capture the tap time up front, not whenever the transaction happens to run.
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  return db.transaction('rw', [db.active, db.intervals], async () => {
    const a = (await getActive()) ?? null;
    if (!a) {
      const after: ActiveTimer = { key: 'current', areaId, subAreaId, start: now };
      await db.active.put(after);
      return { kind: 'start', before: null, after, saved: null };
    }
    if (a.areaId === areaId && a.subAreaId === subAreaId) return null;
    if (nowMs - new Date(a.start).getTime() < RELABEL_THRESHOLD_MS) {
      const after: ActiveTimer = { ...a, areaId, subAreaId };
      await db.active.put(after);
      return { kind: 'relabel', before: a, after, saved: null };
    }
    const saved = await commitTimerSpan(a, nowMs);
    const after: ActiveTimer = { key: 'current', areaId, subAreaId, start: now };
    await db.active.put(after);
    return { kind: 'split', before: a, after, saved };
  });
}

/** What a stop did, so it can be undone. */
export interface StopResult {
  previous: ActiveTimer;
  saved: Interval | null; // null when the timer was under a minute and discarded
}

/**
 * Stop tracking at `endMs` (default: now; never before the start or in the future).
 * Timers shorter than a minute are discarded instead of saved.
 */
export async function stopAt(endMs = Date.now()): Promise<StopResult | null> {
  const end = Math.min(endMs, Date.now());
  return db.transaction('rw', [db.active, db.intervals], async () => {
    const a = await getActive();
    if (!a) return null;
    const saved = end - new Date(a.start).getTime() >= RELABEL_THRESHOLD_MS ? await commitTimerSpan(a, end) : null;
    await db.active.delete('current');
    return { previous: a, saved };
  });
}

export const stop = () => stopAt(Date.now());

// ---- "Earlier": the timer actions for when you forgot to start or to switch ----

/** End of the latest saved interval (ms), or -Infinity. Nothing may start before it. */
export async function latestEnd(): Promise<number> {
  const last = await db.intervals.orderBy('end').last();
  return last ? Date.parse(last.end) : -Infinity;
}

/**
 * Forgot to start: start tracking at a past moment. Only while nothing runs, and
 * never before the latest saved interval ends (no overlap) or in the future.
 */
export async function startAt(areaId: string, subAreaId: string | null, startMs: number): Promise<ActiveTimer> {
  return db.transaction('rw', [db.active, db.intervals], async () => {
    if (await getActive()) throw new ConstraintError('A timer is already running');
    if (startMs > Date.now()) throw new ConstraintError('Start must be in the past');
    if (startMs < (await latestEnd())) throw new ConstraintError('That overlaps saved time');
    const after: ActiveTimer = { key: 'current', areaId, subAreaId, start: new Date(startMs).toISOString() };
    await db.active.put(after);
    return after;
  });
}

/** Started late: move the running timer's start (not before the latest saved interval ends). */
export async function restartAt(startMs: number): Promise<void> {
  const a = await getActive();
  if (!a) throw new ConstraintError('Nothing is running');
  if (startMs < (await latestEnd())) throw new ConstraintError('That overlaps saved time');
  await updateActive({ start: startMs, areaId: a.areaId, subAreaId: a.subAreaId });
}

/**
 * Forgot to switch: the running timer ends at `atMs` (saved) and `areaId` runs from
 * then on. Under a minute after the running timer's start it is a relabel instead
 * (same rule as switching live).
 */
export async function switchAt(areaId: string, subAreaId: string | null, atMs: number): Promise<void> {
  await db.transaction('rw', [db.active, db.intervals], async () => {
    const a = await getActive();
    if (!a) throw new ConstraintError('Nothing is running');
    const start = Date.parse(a.start);
    if (atMs > Date.now()) throw new ConstraintError('That is in the future');
    if (atMs < start) throw new ConstraintError('That is before the timer started');
    if (atMs - start < RELABEL_THRESHOLD_MS) {
      await db.active.put({ ...a, areaId, subAreaId });
      return;
    }
    await commitTimerSpan(a, atMs);
    await db.active.put({ key: 'current', areaId, subAreaId, start: new Date(atMs).toISOString() });
  });
}

// (Undo/redo of timer actions: src/undo.ts, snapshot-based.)

/** Throw the running timer away without saving anything. Returns it. */
export async function discardActive(): Promise<ActiveTimer | null> {
  return db.transaction('rw', [db.active], async () => {
    const a = (await getActive()) ?? null;
    if (a) await db.active.delete('current');
    return a;
  });
}

/** "1:05:09" (running clock, seconds floored) or "1h 05m" (rounded to the nearest minute). */
export function formatDuration(ms: number, withSeconds = true) {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (!withSeconds) {
    const minutes = Math.max(0, Math.round(ms / 60_000));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h}h ${pad(m)}m` : `${m}m`;
  }
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
