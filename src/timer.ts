import { db } from './db';
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
export async function track(areaId: string, subAreaId: string | null) {
  // Capture the tap time up front, not whenever the transaction happens to run.
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  await db.transaction('rw', [db.active, db.intervals], async () => {
    const a = await getActive();
    if (!a) {
      await db.active.put({ key: 'current', areaId, subAreaId, start: now });
      return;
    }
    if (a.areaId === areaId && a.subAreaId === subAreaId) return;
    if (nowMs - new Date(a.start).getTime() < RELABEL_THRESHOLD_MS) {
      await db.active.put({ ...a, areaId, subAreaId });
      return;
    }
    await commitTimerSpan(a, nowMs);
    await db.active.put({ key: 'current', areaId, subAreaId, start: now });
  });
}

/** Stop tracking. Timers shorter than a minute are discarded instead of saved. */
export async function stop() {
  const nowMs = Date.now();
  await db.transaction('rw', [db.active, db.intervals], async () => {
    const a = await getActive();
    if (!a) return;
    if (nowMs - new Date(a.start).getTime() >= RELABEL_THRESHOLD_MS) {
      await commitTimerSpan(a, nowMs);
    }
    await db.active.delete('current');
  });
}

export async function discardActive() {
  await db.active.delete('current');
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
