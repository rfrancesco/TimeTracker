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
