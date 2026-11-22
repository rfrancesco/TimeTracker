import { db, type ActiveTimer } from './db';
import { ConstraintError, commitTimerSpan, updateActive } from './constraints';

/** Below this, switching relabels the running timer instead of splitting it, and stopping discards it. */
export const RELABEL_THRESHOLD_MS = 60_000;

// ---- The timer rules, as pure functions ----
// Every timer action is planned here from the current state: the database actions
// below apply a plan, and the UI uses the same plans for its hints and to show the
// result before the write lands. So the rules (invariant 3) live in one place.

export type PlanError = 'idle' | 'running' | 'future' | 'beforeStart' | 'overlap';

export type Plan =
  | {
      ok: true;
      /** The running timer afterwards (null = nothing running). */
      next: ActiveTimer | null;
      /** The span of the old timer that gets saved, if any. */
      saved: { start: number; end: number } | null;
    }
  | { ok: false; error: PlanError };

const fail = (error: PlanError): Plan => ({ ok: false, error });
const timer = (areaId: string, subAreaId: string | null, startMs: number): ActiveTimer => ({
  key: 'current',
  areaId,
  subAreaId,
  start: new Date(startMs).toISOString(),
});

/** Start `areaId` at `startMs` while nothing runs: not in the future, not before `lastEnd`. */
export function planStart(a: ActiveTimer | null, areaId: string, subAreaId: string | null, startMs: number, lastEnd: number, now: number): Plan {
  if (a) return fail('running');
  if (startMs > now) return fail('future');
  if (startMs < lastEnd) return fail('overlap');
  return { ok: true, next: timer(areaId, subAreaId, startMs), saved: null };
}

/** Move the running timer's start (and set its sub-area). */
export function planRestart(a: ActiveTimer | null, startMs: number, subAreaId: string | null, lastEnd: number, now: number): Plan {
  if (!a) return fail('idle');
  if (startMs > now) return fail('future');
  if (startMs < lastEnd) return fail('overlap');
  return { ok: true, next: { ...timer(a.areaId, subAreaId, startMs), ...(a.note ? { note: a.note } : {}) }, saved: null };
}

/**
 * The running timer ends at `atMs` and `areaId` runs from then on; under a minute
 * after the start it is a relabel instead (the whole timer becomes `areaId`).
 */
export function planSwitch(a: ActiveTimer | null, areaId: string, subAreaId: string | null, atMs: number, now: number): Plan {
  if (!a) return fail('idle');
  const start = Date.parse(a.start);
  if (atMs > now) return fail('future');
  if (atMs < start) return fail('beforeStart');
  if (atMs - start < RELABEL_THRESHOLD_MS) return { ok: true, next: { ...a, areaId, subAreaId }, saved: null };
  return { ok: true, next: timer(areaId, subAreaId, atMs), saved: { start, end: atMs } };
}

/** Stop at `endMs` (capped at now); under a minute the timer is discarded, not saved. Idle: no change. */
export function planStop(a: ActiveTimer | null, endMs: number, now: number): Plan {
  if (!a) return { ok: true, next: null, saved: null };
  const start = Date.parse(a.start);
  const end = Math.min(endMs, now);
  if (end < start) return fail('beforeStart');
  return { ok: true, next: null, saved: end - start >= RELABEL_THRESHOLD_MS ? { start, end } : null };
}

/** Tap an area now: start, or switch (same label = no change). */
export function planTrack(a: ActiveTimer | null, areaId: string, subAreaId: string | null, now: number): Plan {
  if (!a) return planStart(null, areaId, subAreaId, now, -Infinity, now);
  if (a.areaId === areaId && a.subAreaId === subAreaId) return { ok: true, next: a, saved: null };
  return planSwitch(a, areaId, subAreaId, now, now);
}

/** Same running timer (label, start and note)? */
export const sameTimer = (x: ActiveTimer | null | undefined, y: ActiveTimer | null | undefined) =>
  (x ?? null) === (y ?? null) ||
  (!!x &&
    !!y &&
    x.areaId === y.areaId &&
    x.subAreaId === y.subAreaId &&
    Date.parse(x.start) === Date.parse(y.start) &&
    (x.note ?? '') === (y.note ?? ''));

const MESSAGES: Record<PlanError, string> = {
  idle: 'Nothing is running',
  running: 'A timer is already running',
  future: 'That is in the future',
  beforeStart: 'That is before the timer started',
  overlap: 'That overlaps saved time',
};

// ---- The database actions: plan from the stored state and apply, in one transaction ----

/** End of the latest saved interval (ms), or -Infinity. Nothing may start before it. */
async function latestEnd(): Promise<number> {
  const last = await db.intervals.orderBy('end').last();
  return last ? Date.parse(last.end) : -Infinity;
}

/** Returns whether anything changed. */
function run(plan: (a: ActiveTimer | null, lastEnd: number) => Plan): Promise<boolean> {
  return db.transaction('rw', [db.active, db.intervals], async () => {
    const a = (await db.active.get('current')) ?? null;
    const p = plan(a, await latestEnd());
    if (!p.ok) throw new ConstraintError(MESSAGES[p.error]);
    if (sameTimer(a, p.next)) return false;
    if (a && p.saved) await commitTimerSpan(a, p.saved.end);
    if (p.next) await updateActive({ start: Date.parse(p.next.start), areaId: p.next.areaId, subAreaId: p.next.subAreaId, note: p.next.note });
    else await db.active.delete('current');
    return true;
  });
}

/** Tap an area: start, relabel (under a minute) or split. The tap time is taken up front. */
export function track(areaId: string, subAreaId: string | null) {
  const now = Date.now();
  return run((a) => planTrack(a, areaId, subAreaId, now));
}

/** Forgot to start: start tracking at a past moment. */
export function startAt(areaId: string, subAreaId: string | null, startMs: number) {
  return run((a, lastEnd) => planStart(a, areaId, subAreaId, startMs, lastEnd, Date.now()));
}

/** Started late: move the running timer's start, setting its sub-area. */
export function restartAt(startMs: number, subAreaId: string | null) {
  return run((a, lastEnd) => planRestart(a, startMs, subAreaId, lastEnd, Date.now()));
}

/** Forgot to switch: see planSwitch. */
export function switchAt(areaId: string, subAreaId: string | null, atMs: number) {
  return run((a) => planSwitch(a, areaId, subAreaId, atMs, Date.now()));
}

/** Stop at `endMs` (default now). Returns whether a timer was stopped. */
export function stopAt(endMs = Date.now()) {
  return run((a) => planStop(a, endMs, Date.now()));
}

/** Write the running timer's note ('' removes it). */
export async function setNote(note: string) {
  await db.transaction('rw', [db.active], async () => {
    const a = await db.active.get('current');
    if (!a) throw new ConstraintError(MESSAGES.idle);
    const { note: _old, ...rest } = a;
    await db.active.put(note.trim() ? { ...rest, note: note.trim() } : rest);
  });
}

/** Throw the running timer away without saving anything. */
export function discardActive() {
  return db.active.delete('current');
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
