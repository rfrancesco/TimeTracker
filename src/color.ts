const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

export const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

/** Mix `hex` into the app background colour; used for the status bar tint. */
export function tintOverBackground(hex: string, amount: number) {
  const bg = prefersDark() ? [18, 18, 18] : [255, 255, 255];
  const c = hexToRgb(hex);
  const mixed = c.map((v, i) => Math.round(v * amount + bg[i] * (1 - amount)));
  return '#' + mixed.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export const BACKGROUND_TINT = 0.32;

// ---- Light-mode variants -------------------------------------------------
// Area colours are stored once (tuned for dark backgrounds). On light backgrounds
// they are shown 0.12 darker in OKLab lightness, same hue: the default palette
// stays colour-vision-safe this way and every swatch clears 4.5:1 on white.

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => toLin(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab(L: number, a: number, b: number) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(toGam);
}

const LIGHT_MODE_DARKEN = 0.12;
const LIGHT_MODE_MIN_L = 0.432; // keeps dark colours (e.g. Sleep) inside the validated lightness band
const lightCache = new Map<string, string>();

export function lightModeVariant(hex: string) {
  const key = hex.toUpperCase();
  const hit = lightCache.get(key);
  if (hit) return hit;
  const [L, a, b] = toOklab(key);
  const target = Math.max(Math.min(L, LIGHT_MODE_MIN_L), L - LIGHT_MODE_DARKEN);
  let out = key;
  if (target < L) {
    // Reduce chroma only as far as needed to stay inside sRGB.
    for (let k = 1; k >= 0.3; k -= 0.01) {
      const c = fromOklab(target, a * k, b * k);
      if (c.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) {
        out = '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
        break;
      }
    }
  }
  lightCache.set(key, out);
  return out;
}

/** The colour to show for a stored area colour in the current theme. */
export const displayColor = (hex: string, dark: boolean) => (dark ? hex : lightModeVariant(hex));
