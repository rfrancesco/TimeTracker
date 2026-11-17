import { useSyncExternalStore } from 'react';
import { db, type ActiveTimer, type Interval } from './db';

/**
 * Undo/redo for timer actions (start, area change, stop, rewind, discard, a Stop
 * from the notification): ↶ walks back through the last MAX actions, ↷ walks forward
 * again; a new action clears what could be redone. In memory only.
 *
 * It works on snapshots, not per-action inverse code: a timer action only touches
 * the running timer and time after `from` (the running timer's start, or the moment
 * of the action when nothing was running). Before/after snapshots of that region are
 * kept; a step restores one of them, but only if the region still looks exactly
 * like the other one. Otherwise it refuses, changes nothing, and forgets the history
 * in that direction (it no longer applies).
 */
interface Snapshot {
  active: ActiveTimer | null;
  intervals: Interval[]; // those ending after `from`, sorted by id
}

interface Entry {
  label: string;
  from: string;
  before: Snapshot;
  after: Snapshot;
}

const MAX = 20;
let done: Entry[] = []; // ↶ takes the last one
let undone: Entry[] = []; // ↷ takes the last one
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

async function snapshot(from: string): Promise<Snapshot> {
  const [active, intervals] = await Promise.all([
    db.active.get('current'),
    db.intervals.where('end').above(from).toArray(),
  ]);
  return { active: active ?? null, intervals: intervals.sort((a, b) => a.id.localeCompare(b.id)) };
}

const same = (a: Snapshot, b: Snapshot) => JSON.stringify(a) === JSON.stringify(b);

/** Run a timer action and put it on the undo stack. Returns the action's result. */
export async function recordTimerAction<T>(label: string, action: () => Promise<T>): Promise<T> {
  const current = await db.active.get('current');
  const from = current?.start ?? new Date().toISOString();
  const before = await snapshot(from);
  const result = await action();
  const after = await snapshot(from);
  if (!same(before, after)) {
    done = [...done.slice(-(MAX - 1)), { label, from, before, after }];
    undone = [];
    emit();
  }
  return result;
}

/** Restore `target` if the region still matches `expected`; false (and no change) otherwise. */
function restore(e: Entry, expected: Snapshot, target: Snapshot) {
  return db.transaction('rw', [db.active, db.intervals], async () => {
    if (!same(await snapshot(e.from), expected)) return false;
    const keep = new Set(target.intervals.map((i) => i.id));
    await db.intervals.bulkDelete(expected.intervals.filter((i) => !keep.has(i.id)).map((i) => i.id));
    await db.intervals.bulkPut(target.intervals);
    if (target.active) await db.active.put(target.active);
    else await db.active.delete('current');
    return true;
  });
}

/** Undo the latest action. Returns false (and forgets the undo history) if things changed since. */
export async function undo(): Promise<{ ok: boolean; label?: string }> {
  const e = done[done.length - 1];
  if (!e) return { ok: false };
  const ok = await restore(e, e.after, e.before);
  done = ok ? done.slice(0, -1) : [];
  if (ok) undone = [...undone, e];
  emit();
  return { ok, label: e.label };
}

/** Redo the latest undone action. Returns false (and forgets the redo history) if things changed since. */
export async function redo(): Promise<{ ok: boolean; label?: string }> {
  const e = undone[undone.length - 1];
  if (!e) return { ok: false };
  const ok = await restore(e, e.before, e.after);
  undone = ok ? undone.slice(0, -1) : [];
  if (ok) done = [...done, e];
  emit();
  return { ok, label: e.label };
}

/** Whether ↶ / ↷ have something to do. */
export function useUndoRedo(): { canUndo: boolean; canRedo: boolean } {
  const state = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => `${done.length > 0 ? 1 : 0}${undone.length > 0 ? 1 : 0}`,
  );
  return { canUndo: state[0] === '1', canRedo: state[1] === '1' };
}
