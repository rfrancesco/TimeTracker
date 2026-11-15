import { clampChroma, converter, formatHex, interpolate } from 'culori';

/**
 * Colour handling. All colour maths is delegated to culori; CSS tints use the
 * platform's color-mix(). Nothing here converts colour spaces by hand.
 */

const toOklch = converter('oklch');

export const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

/** Same background colours Ionic uses (dark palette / light default). */
const background = (dark: boolean) => (dark ? '#121212' : '#ffffff');

export const BACKGROUND_TINT = 0.32;

/**
 * `hex` mixed into the app background, in sRGB like CSS color-mix(in srgb, …):
 * used where a real colour value is needed (the Android status bar).
 */
export function tintOverBackground(hex: string, amount: number, dark = prefersDark()) {
  return formatHex(interpolate([background(dark), hex], 'rgb')(amount));
}

// Area colours are stored exactly as chosen and shown unchanged in both themes,
// except where they would be unreadable: a very dark colour is lifted on the dark
// background (same hue, a little more chroma), a very light one is darkened on the
// light background. The default set was validated in both themes with this rule.
const DARK_MODE_MIN_L = 0.36;
const DARK_MODE_MIN_C = 0.1;
const LIGHT_MODE_MAX_L = 0.69;
const shownCache = new Map<string, string>();

function shownFor(hex: string, dark: boolean) {
  const key = `${dark ? 'd' : 'l'}${hex.toUpperCase()}`;
  const cached = shownCache.get(key);
  if (cached) return cached;
  const c = toOklch(hex);
  let out = hex.toUpperCase();
  if (c) {
    if (dark && c.l < DARK_MODE_MIN_L) {
      out = formatHex(clampChroma({ ...c, l: DARK_MODE_MIN_L, c: Math.max(c.c, DARK_MODE_MIN_C) }, 'oklch'));
    } else if (!dark && c.l > LIGHT_MODE_MAX_L) {
      out = formatHex(clampChroma({ ...c, l: LIGHT_MODE_MAX_L }, 'oklch'));
    }
  }
  shownCache.set(key, out.toUpperCase());
  return out.toUpperCase();
}

/** The colour to show for a stored area colour in the current theme. */
export const displayColor = (hex: string, dark: boolean) => shownFor(hex, dark);
