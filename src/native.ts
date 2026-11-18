import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { db } from './db';
import { stopAt } from './timer';
import { recordTimerAction } from './undo';
import { iconFor } from './icons';
import { onColor } from './color';
import { areaLiveUpdate, areaRunningTime } from './runningTime';
import { useNavigate } from 'react-router-dom';

/** The area's icon as a white-on-transparent PNG (base64), for the notification and chip. */
const glyphs = new Map<string, Promise<string | undefined>>();
function glyphPng(key: string) {
  if (!glyphs.has(key)) {
    glyphs.set(
      key,
      (async () => {
        const img = new Image();
        img.src = iconFor(key);
        await img.decode();
        const size = 96;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, size, size);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      })().catch(() => undefined),
    );
  }
  return glyphs.get(key)!;
}

/**
 * Bridge to the Android wrapper (separate repo). In a browser/PWA none of this
 * exists and everything here is a no-op. The wrapper only mirrors state: the data
 * stays in IndexedDB, and a Stop pressed on the notification is recorded natively
 * and applied here through the normal stopAt + undo path.
 */
interface TimeTrackerPlugin {
  showTimer(o: {
    start: number;
    title: string;
    color?: string;
    onColor?: string;
    icon?: string; // base64 PNG, white glyph on transparent (older wrappers ignore it)
    promote?: boolean; // a live update (true) or a plain notification
    showTime?: boolean; // the running time ticks in the notification (older wrappers ignore it)
  }): Promise<{ shown: boolean }>;
  hideTimer(): Promise<void>;
  takePendingStop(): Promise<{ start?: number; end?: number }>; // old APKs: read + forget in one step
  peekPendingStop(): Promise<{ start?: number; end?: number }>; // newer APKs: read…
  clearPendingStop(o: { start: number }): Promise<void>; // …and forget once applied
  shareFile(o: { name: string; text: string; mimeType?: string }): Promise<void>;
  status(): Promise<NativeStatus>;
  openNotificationSettings(): Promise<void>;
  addListener(event: 'stop' | 'openTimer', fn: () => void): Promise<PluginListenerHandle>;
}

export interface NativeStatus {
  sdk: number;
  permission: string;
  notificationsEnabled: boolean;
  channelImportance?: number;
  liveUpdatesAllowed?: boolean;
  promotable?: boolean;
  posted: boolean;
  promoted?: boolean;
  lastError?: string;
  lastShown?: number;
}

/** Inside the Android wrapper (even if the plugin is missing, e.g. a broken bridge). */
export const inWrapper = Capacitor.isNativePlatform();

export const native: TimeTrackerPlugin | null =
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TimeTracker') ? registerPlugin<TimeTrackerPlugin>('TimeTracker') : null;

/** Last failed bridge call, shown in Settings → Android app. */
export let lastBridgeError: string | null = null;
// An older wrapper may lack a method: never let a bridge call break the app.
const quietly = (p: Promise<unknown> | undefined) =>
  p?.then(
    () => (lastBridgeError = null),
    (e: unknown) => (lastBridgeError = e instanceof Error ? e.message : String(e)),
  );

/**
 * Apply a Stop pressed on the notification, if it still refers to the running timer.
 * Newer APKs keep the stop until we confirm (peek → apply → clear), so a reload in
 * between (e.g. an app update on resume) can't lose it; applying twice is harmless,
 * because once that timer is stopped the stop no longer matches and is just cleared.
 * Runs one at a time; an error in one run never blocks later ones.
 */
let applying: Promise<boolean> = Promise.resolve(false);
function applyPendingStop(): Promise<boolean> {
  const run = async () => {
    if (!native) return false;
    let twoStep = true;
    let p: { start?: number; end?: number } = await native.peekPendingStop().catch(() => {
      twoStep = false;
      return null as never;
    });
    if (!twoStep) p = await native.takePendingStop().catch(() => ({}));
    if (p?.start == null || p.end == null) return false;
    const start = p.start;
    const active = await db.active.get('current');
    let applied = false;
    if (active && Date.parse(active.start) === start) {
      const name = (await db.areas.get(active.areaId))?.name ?? 'timer';
      // Like a stop in the app: ↶ on the Timer page can undo it.
      applied = !!(await recordTimerAction(`stop ${name}`, () => stopAt(p.end)));
    }
    // Applied, or no longer applicable (already stopped/changed in the app): forget it.
    if (twoStep) await quietly(native.clearPendingStop({ start }));
    return applied;
  };
  applying = applying.then(run, run).catch(() => false);
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
      // The colour exactly as chosen (the system draws the notification in its own theme).
      color: area?.color,
      onColor: area ? onColor(area.color) : undefined,
      iconKey: area?.icon,
      // A live update (or a plain notification); the time ticks only for running time "on".
      promote: areaLiveUpdate(area),
      showTime: areaRunningTime(area) === 'on',
    };
  });
  const key = state === undefined ? undefined : JSON.stringify(state);

  useEffect(() => {
    if (!native || key === undefined) return;
    const sync = async () => {
      // Just stopped: the live query re-runs with the new state and syncs then.
      if (await applyPendingStop()) return;
      const s = key && (JSON.parse(key) as NonNullable<typeof state>);
      if (!s) return void quietly(native!.hideTimer());
      const { iconKey, ...rest } = s;
      quietly(native!.showTimer({ ...rest, icon: iconKey ? await glyphPng(iconKey) : undefined }));
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

  // Tapping the notification opens the Timer tab.
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate; // registered once; always uses the current router
  useEffect(() => {
    if (!native) return;
    const handle = native.addListener('openTimer', () => navigateRef.current('/timer'));
    return () => void handle.then((h) => h.remove()).catch(() => {});
  }, []);

  return null;
}
