import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
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
