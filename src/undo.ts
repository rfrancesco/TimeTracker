import { useSyncExternalStore } from 'react';
import { db, type ActiveTimer, type Interval } from './db';

/**
 * One-step undo for timer actions (start, area change, stop, rewind, discard, a Stop
 * from the notification). Only the latest action is kept: ↶ undoes it, and the
 * same button (now ↷) redoes it, back and forth.
 *
 * It works on snapshots, not per-action inverse code: a timer action only touches
 * the running timer and time after `from` (the running timer's start, or the moment
 * of the action when nothing was running). Before/after snapshots of that region are
 * kept; switching restores one of them, but only if the region still looks exactly
 * like the other one. Otherwise it refuses and changes nothing.
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
  undone: boolean;
}

let entry: Entry | null = null;
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

/** Run a timer action and make it the one that ↶ undoes. Returns the action's result. */
export async function recordTimerAction<T>(label: string, action: () => Promise<T>): Promise<T> {
  const current = await db.active.get('current');
  const from = current?.start ?? new Date().toISOString();
  const before = await snapshot(from);
  const result = await action();
  const after = await snapshot(from);
  if (!same(before, after)) {
    entry = { label, from, before, after, undone: false };
    emit();
  }
  return result;
}

/**
 * Undo the latest action, or redo it if it was just undone. Returns false (and
 * forgets the action) if things changed in the meantime.
 */
export async function toggleUndo(): Promise<{ ok: boolean; label?: string }> {
  const e = entry;
  if (!e) return { ok: false };
  const [expected, target] = e.undone ? [e.before, e.after] : [e.after, e.before];
  const ok = await db.transaction('rw', [db.active, db.intervals], async () => {
    if (!same(await snapshot(e.from), expected)) return false;
    const keep = new Set(target.intervals.map((i) => i.id));
    await db.intervals.bulkDelete(expected.intervals.filter((i) => !keep.has(i.id)).map((i) => i.id));
    await db.intervals.bulkPut(target.intervals);
    if (target.active) await db.active.put(target.active);
    else await db.active.delete('current');
    return true;
  });
  entry = ok ? { ...e, undone: !e.undone } : null;
  emit();
  return { ok, label: e.label };
}

/** 'undo' / 'redo' for the button, or null when there is nothing to do. */
export function useUndoState(): 'undo' | 'redo' | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => (entry ? (entry.undone ? 'redo' : 'undo') : null),
  );
}
