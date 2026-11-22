/**
 * Light / dark / follow-system. Ionic's dark palette is applied via the
 * `ion-palette-dark` class on <html> (dark.class.css), so the app decides.
 */
import { readPref, writePref } from './prefs';

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'theme';
const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function load(): ThemePref {
  const v = readPref(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

let pref: ThemePref = load();

export const getThemePref = () => pref;
export const isDark = () => pref === 'dark' || (pref === 'system' && !!mq?.matches);

function apply() {
  const dark = isDark();
  document.documentElement.classList.toggle('ion-palette-dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  listeners.forEach((fn) => fn());
}

export function setThemePref(next: ThemePref) {
  pref = next;
  writePref(KEY, next);
  apply();
}

export function subscribeTheme(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

mq?.addEventListener('change', () => pref === 'system' && apply());
apply(); // before first render, so there is no flash of the wrong theme

/** Tint the Android status bar / task switcher colour. */
export function setThemeColor(color: string) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}
