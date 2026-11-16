import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { db } from './db';
import { stopAt, undoStop } from './timer';
import { pushUndo } from './undo';

/**
 * Bridge to the Android wrapper (separate repo). In a browser/PWA none of this
 * exists and everything here is a no-op. The wrapper only mirrors state: the data
 * stays in IndexedDB, and a Stop pressed on the notification is recorded natively
 * and applied here through the normal stopAt + undo path.
 */
interface TimeTrackerPlugin {
  showTimer(o: { start: number; title: string; color?: string }): Promise<{ shown: boolean }>;
  hideTimer(): Promise<void>;
  takePendingStop(): Promise<{ start?: number; end?: number }>;
  shareFile(o: { name: string; text: string; mimeType?: string }): Promise<void>;
  addListener(event: 'stop', fn: () => void): Promise<PluginListenerHandle>;
}

export const native: TimeTrackerPlugin | null =
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TimeTracker') ? registerPlugin<TimeTrackerPlugin>('TimeTracker') : null;

const quietly = (p: Promise<unknown> | undefined) => p?.catch(() => {}); // an older wrapper may lack a method

/** Apply a Stop pressed on the notification, if it still refers to the running timer. */
let applying: Promise<boolean> = Promise.resolve(false);
function applyPendingStop(): Promise<boolean> {
  applying = applying.then(async () => {
    if (!native) return false;
    const p = await native.takePendingStop().catch(() => ({}) as { start?: number; end?: number });
    if (p.start == null || p.end == null) return false;
    const active = await db.active.get('current');
    if (!active || Date.parse(active.start) !== p.start) return false; // already stopped/changed in the app
    const result = await stopAt(p.end);
    if (!result) return false;
    const name = (await db.areas.get(result.previous.areaId))?.name ?? 'timer';
    pushUndo({ label: `stop ${name}`, run: () => undoStop(result) });
    return true;
  });
  return applying;
}

/** Keeps the wrapper's notification in sync with the running timer. Renders nothing. */
export function NativeTimerSync() {
  // null = no timer; undefined = still loading (don't hide anything yet).
  const state = useLiveQuery(async () => {
    const a = await db.active.get('current');
    if (!a) return null;
    const area = await db.areas.get(a.areaId);
    const sub = a.subAreaId ? await db.subAreas.get(a.subAreaId) : undefined;
    return {
      start: Date.parse(a.start),
      title: [area?.name ?? 'Timer', sub?.name].filter(Boolean).join(' · '),
      color: area?.color,
    };
  });
  const key = state === undefined ? undefined : JSON.stringify(state);

  useEffect(() => {
    if (!native || key === undefined) return;
    const sync = async () => {
      // Just stopped: the live query re-runs with the new state and syncs then.
      if (await applyPendingStop()) return;
      const s = key && (JSON.parse(key) as typeof state);
      quietly(s ? native!.showTimer(s) : native!.hideTimer());
    };
    sync();
    // Back in the foreground: apply a Stop from the notification, and bring the
    // notification back if it was swiped away.
    const onVisible = () => document.visibilityState === 'visible' && sync();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [key]);

  useEffect(() => {
    if (!native) return;
    const handle = native.addListener('stop', () => void applyPendingStop());
    return () => void handle.then((h) => h.remove());
  }, []);

  return null;
}
