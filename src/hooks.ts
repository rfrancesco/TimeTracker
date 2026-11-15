import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Area, type SubArea } from './db';
import { displayColor, prefersDark } from './color';

/** Follows the system light/dark setting. */
export function useDarkMode() {
  const [dark, setDark] = useState(prefersDark);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = () => setDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

/** An area as shown on screen: `color` is adjusted for the theme, `baseColor` is what is stored. */
export type AreaView = Area & { baseColor: string };

export function useAreas(includeArchived = false): AreaView[] {
  const dark = useDarkMode();
  const areas =
    useLiveQuery(
      async () => (await db.areas.orderBy('order').toArray()).filter((a) => includeArchived || !a.archived),
      [includeArchived],
    ) ?? [];
  return useMemo(
    () => areas.map((a) => ({ ...a, baseColor: a.color, color: displayColor(a.color, dark) })),
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
