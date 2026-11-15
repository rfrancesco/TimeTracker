import { clampChroma, converter, formatHex, interpolate, wcagContrast } from 'culori';
import { isDark } from './theme';

/**
 * Colour handling. All colour maths is delegated to culori; CSS tints use the
 * platform's color-mix(). Nothing here converts colour spaces by hand.
 */

const toOklch = converter('oklch');

/** Same background colours Ionic uses (dark palette / light default). */
export const themeBackground = (dark: boolean) => (dark ? '#121212' : '#ffffff');

export const BACKGROUND_TINT = 0.32;

/**
 * `hex` mixed into the app background, in sRGB like CSS color-mix(in srgb, …):
 * used where a real colour value is needed (the Android status bar).
 */
export function tintOverBackground(hex: string, amount: number, dark = isDark()) {
  return formatHex(interpolate([themeBackground(dark), hex], 'rgb')(amount));
}

/** The neutral surface used under the area selector (CSS: rgba(127,127,127,.12)). */
export const surfaceOver = (bg: string) => formatHex(interpolate([bg, '#7f7f7f'], 'rgb')(0.12));

// ---- Readability --------------------------------------------------------
// Contrast is the WCAG ratio (culori). 3:1 is the WCAG minimum for icons and
// other graphical marks; nothing here knows about specific areas or colours.

// Aim a little above 3:1 so the rendered result still clears it after the
// browser's own colour-mix rounding.
export const MIN_ICON_CONTRAST = 3.3;
const INK_LIGHT = '#ffffff';
const INK_DARK = '#1a1a1a';

/** White or near-black, whichever reads better on `bg` (for marks on a filled colour). */
export function onColor(bg: string) {
  return wcagContrast(INK_LIGHT, bg) >= wcagContrast(INK_DARK, bg) ? INK_LIGHT : INK_DARK;
}

const readableCache = new Map<string, string>();

/**
 * `fg` if it already reads on `bg`; otherwise the same hue made lighter (on dark
 * backgrounds) or darker (on light ones) until it reaches `min`; if no lightness
 * of that hue gets there, white or near-black.
 */
export function readableOn(fg: string, bg: string, min = MIN_ICON_CONTRAST) {
  const key = `${fg}|${bg}|${min}`;
  const cached = readableCache.get(key);
  if (cached) return cached;
  let out = fg;
  if (wcagContrast(fg, bg) < min) {
    const c = toOklch(fg);
    const lighter = onColor(bg) === INK_LIGHT;
    out = onColor(bg);
    if (c) {
      for (let l = c.l; l >= 0 && l <= 1; l += lighter ? 0.02 : -0.02) {
        const candidate = formatHex(clampChroma({ ...c, l }, 'oklch'));
        if (wcagContrast(candidate, bg) >= min) {
          out = candidate;
          break;
        }
      }
    }
  }
  readableCache.set(key, out);
  return out;
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
