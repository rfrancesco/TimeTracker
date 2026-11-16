import { db, type ActiveTimer, type Interval } from './db';
import { commitTimerSpan } from './constraints';

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

// ---- Undo -------------------------------------------------------------------
// Each undo first checks that nothing changed underneath (the running timer is
// exactly what the action left, and resuming would not overlap saved time); if
// anything differs it refuses (returns false) instead of breaking the invariant.

const sameTimer = (a: ActiveTimer | null | undefined, b: ActiveTimer | null | undefined) =>
  !!a && !!b && a.areaId === b.areaId && a.subAreaId === b.subAreaId && a.start === b.start;

/** True if no saved interval ends after `startIso` (so a timer may resume from there). */
async function freeFrom(startIso: string) {
  return (await db.intervals.where('end').above(startIso).count()) === 0;
}

/** Undo a stop/rewind: remove the saved interval and resume the same timer. */
export async function undoStop(r: StopResult): Promise<boolean> {
  return db.transaction('rw', [db.active, db.intervals], async () => {
    if (await getActive()) return false; // another timer was started in the meantime
    if (r.saved) {
      const still = await db.intervals.get(r.saved.id);
      if (!still || still.start !== r.saved.start || still.end !== r.saved.end) return false; // edited since
      await db.intervals.delete(r.saved.id);
    }
    if (!(await freeFrom(r.previous.start))) return false;
    await db.active.put(r.previous);
    return true;
  });
}

/** Undo a start / area change. */
export async function undoTrack(r: TrackResult): Promise<boolean> {
  return db.transaction('rw', [db.active, db.intervals], async () => {
    if (!sameTimer(await getActive(), r.after)) return false;
    if (r.kind === 'start') {
      await db.active.delete('current');
      return true;
    }
    if (r.kind === 'split' && r.saved) {
      const still = await db.intervals.get(r.saved.id);
      if (!still || still.start !== r.saved.start || still.end !== r.saved.end) return false;
      await db.intervals.delete(r.saved.id);
    }
    if (r.before && !(await freeFrom(r.before.start))) return false;
    await db.active.put(r.before!);
    return true;
  });
}

/** Throw the running timer away without saving anything. Returns it, for undo. */
export async function discardActive(): Promise<ActiveTimer | null> {
  return db.transaction('rw', [db.active], async () => {
    const a = (await getActive()) ?? null;
    if (a) await db.active.delete('current');
    return a;
  });
}

/** Undo a discard: bring the timer back if nothing has started since. */
export async function undoDiscard(previous: ActiveTimer): Promise<boolean> {
  return db.transaction('rw', [db.active, db.intervals], async () => {
    if (await getActive()) return false;
    if (!(await freeFrom(previous.start))) return false;
    await db.active.put(previous);
    return true;
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
