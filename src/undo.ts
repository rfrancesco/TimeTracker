import { useSyncExternalStore } from 'react';

/**
 * Undo stack for timer actions (start, area change, stop, rewind, discard).
 * In memory only: it lasts while the app stays open. Each entry knows how to
 * revert itself and refuses (returns false) if things changed underneath.
 */
export interface UndoEntry {
  label: string;
  run: () => Promise<boolean>;
}

const MAX = 20;
let stack: UndoEntry[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function pushUndo(entry: UndoEntry) {
  stack = [...stack.slice(-(MAX - 1)), entry];
  emit();
}

/** Undo the most recent action. If it can't be undone, older entries are dropped too. */
export async function undoLast(): Promise<{ ok: boolean; label?: string }> {
  const entry = stack[stack.length - 1];
  if (!entry) return { ok: false };
  stack = stack.slice(0, -1);
  emit();
  const ok = await entry.run();
  if (!ok) {
    stack = []; // the state has moved on; older steps would not apply either
    emit();
  }
  return { ok, label: entry.label };
}

export function useUndoCount() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => stack.length,
  );
}
