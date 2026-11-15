import { db, nowIso, uuid, type ActiveTimer } from './db';

/** Below this, switching area/sub-area relabels the running timer instead of splitting it. */
export const RELABEL_THRESHOLD_MS = 60_000;

const getActive = () => db.active.get('current');

async function saveInterval(a: ActiveTimer, end: string) {
  if (new Date(end).getTime() <= new Date(a.start).getTime()) return;
  await db.intervals.add({
    id: uuid(),
    areaId: a.areaId,
    subAreaId: a.subAreaId,
    start: a.start,
    end,
    updatedAt: nowIso(),
  });
}

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
    await saveInterval(a, now);
    await db.active.put({ key: 'current', areaId, subAreaId, start: now });
  });
}

export async function stop() {
  const now = nowIso();
  await db.transaction('rw', [db.active, db.intervals], async () => {
    const a = await getActive();
    if (!a) return;
    await saveInterval(a, now);
    await db.active.delete('current');
  });
}

export async function discardActive() {
  await db.active.delete('current');
}

export function formatDuration(ms: number, withSeconds = true) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (!withSeconds) return h ? `${h}h ${pad(m)}m` : `${m}m`;
  return `${h}:${pad(m)}:${pad(s)}`;
}
