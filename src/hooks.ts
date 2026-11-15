import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Area, type SubArea } from './db';

export function useAreas(includeArchived = false): Area[] {
  return (
    useLiveQuery(
      async () => (await db.areas.orderBy('order').toArray()).filter((a) => includeArchived || !a.archived),
      [includeArchived],
    ) ?? []
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
