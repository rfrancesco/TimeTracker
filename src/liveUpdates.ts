import { useSyncExternalStore } from 'react';
import type { Area } from './db';

/**
 * Android app: which timers appear as a live update (status bar + lock screen, with
 * the running time). A global switch (per device) plus a per-area choice stored on
 * the area (`liveUpdates`, missing = on, so it travels with backups). Without a live
 * update the notification is quiet: area icon, "Since …" and Stop, no ticking time.
 */
const KEY = 'liveUpdates';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setLiveUpdatesEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: stays as is for this session */
  }
  listeners.forEach((fn) => fn());
}

export function useLiveUpdatesEnabled() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
  );
}

export const areaWantsLiveUpdates = (a: Pick<Area, 'liveUpdates'> | undefined) => a?.liveUpdates !== false;
export const liveUpdatesEnabled = read;
