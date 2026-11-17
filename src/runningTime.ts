import { useSyncExternalStore } from 'react';
import type { Area } from './db';

/**
 * Android app: every running timer is a live update (status-bar chip at the far left,
 * top of the lock screen); this decides whether its running time ticks there. A
 * global switch (per device) plus a per-area choice stored on the area (field
 * `liveUpdates` for historical reasons; missing = on, so it travels with backups).
 * Without the time: icon-only chip and "Since …" (e.g. for Sleep).
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

export function setShowTimeEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: stays as is for this session */
  }
  listeners.forEach((fn) => fn());
}

export function useShowTimeEnabled() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
  );
}

export const areaShowsTime = (a: Pick<Area, 'liveUpdates'> | undefined) => a?.liveUpdates !== false;
export const showTimeEnabled = read;
