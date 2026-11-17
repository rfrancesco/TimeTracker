import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useIonToast, type ToastOptions } from '@ionic/react';
import { db, type Area, type SubArea } from './db';
import { displayColor, onColor } from './color';
import { isDark, subscribeTheme } from './theme';

/** The effective theme (the user's choice, or the system's when set to follow it). */
export function useDarkMode() {
  return useSyncExternalStore(subscribeTheme, isDark);
}

/**
 * An area as shown on screen: `color` is adjusted for the theme, `baseColor` is
 * what is stored, `onColor` is the readable ink for icons/text drawn on `color`.
 */
export type AreaView = Area & { baseColor: string; onColor: string };

export function useAreas(includeArchived = false): AreaView[] {
  const dark = useDarkMode();
  const areas =
    useLiveQuery(
      async () => (await db.areas.orderBy('order').toArray()).filter((a) => includeArchived || !a.archived),
      [includeArchived],
    ) ?? [];
  return useMemo(
    () =>
      areas.map((a) => {
        const color = displayColor(a.color, dark);
        return { ...a, baseColor: a.color, color, onColor: onColor(color) };
      }),
    [areas, dark],
  );
}

export function useSubAreas(): SubArea[] {
  return useLiveQuery(() => db.subAreas.orderBy('order').toArray()) ?? [];
}

export function useActive() {
  return useLiveQuery(() => db.active.get('current'));
}

/** Current time, re-rendering every `ms` and immediately when the app comes back to the foreground. */
export function useNow(ms = 1000, enabled = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms, enabled]);
  return now;
}

/** Tint the Android status bar / task switcher colour. */
export function setThemeColor(color: string) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}

/** id of the app's tab bar, so overlays can sit above it instead of covering it. */
export const TAB_BAR_ID = 'app-tab-bar';

/**
 * Snackbar-style message anchored just above the tab bar (never blocks the tabs).
 * A new message replaces one that is still showing, like Android snackbars: Ionic's
 * toast hook would otherwise silently drop it (e.g. "Backup restored" right after
 * "App reset to defaults").
 */
export function useToast() {
  const [present, dismiss] = useIonToast();
  return async (message: string, options: ToastOptions = {}) => {
    await dismiss().catch(() => {});
    await present({ message, duration: 2500, position: 'bottom', positionAnchor: TAB_BAR_ID, ...options });
  };
}
