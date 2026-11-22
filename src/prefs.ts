/**
 * Per-device conveniences in localStorage (theme, zoom, report toggles, last build).
 * Storage can be unavailable (private mode, blocked): reads then return null and
 * writes are skipped, so callers just fall back to their defaults.
 */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not persisted: still applies for this session */
  }
}
