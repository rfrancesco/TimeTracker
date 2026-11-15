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

// Area colours are stored once (tuned for dark backgrounds). On light backgrounds
// they are shown darker in OKLCH lightness with the same hue, then mapped back
// into the sRGB gamut. The default palette was validated in both modes this way.
const LIGHT_MODE_DARKEN = 0.12;
const LIGHT_MODE_MIN_L = 0.432; // keeps dark colours (e.g. Sleep) inside the validated lightness band
const lightCache = new Map<string, string>();

export function lightModeVariant(hex: string) {
  const key = hex.toUpperCase();
  const cached = lightCache.get(key);
  if (cached) return cached;
  const c = toOklch(key);
  let out = key;
  if (c) {
    const target = Math.max(Math.min(c.l, LIGHT_MODE_MIN_L), c.l - LIGHT_MODE_DARKEN);
    if (target < c.l) out = formatHex(clampChroma({ ...c, l: target }, 'oklch')).toUpperCase();
  }
  lightCache.set(key, out);
  return out;
}

/** The colour to show for a stored area colour in the current theme. */
export const displayColor = (hex: string, dark: boolean) => (dark ? hex : lightModeVariant(hex));
