import {
  moon, briefcase, home, musicalNotes, book, barbell, bicycle, walk, restaurant, cafe,
  car, bus, train, airplane, cart, code, laptop, desktop, gameController, tv, film,
  brush, colorPalette, camera, school, library, people, person, heart, medkit, fitness,
  leaf, paw, water, bed, call, chatbubbles, mail, cash, construct, hammer, flask,
  globe, language, mic, headset, pencil, sparkles, sunny, football, basketball, tennisball, clipboard, business, trashOutline,
} from 'ionicons/icons';

export const ICONS: Record<string, string> = {
  moon, bed, briefcase, laptop, desktop, code, home, construct, hammer, 'musical-notes': musicalNotes,
  mic, headset, book, library, school, pencil, language, barbell, fitness, bicycle, walk,
  football, basketball, tennisball, restaurant, cafe, cart, car, bus, train, airplane,
  'game-controller': gameController, tv, film, brush, 'color-palette': colorPalette, camera,
  people, person, call, chatbubbles, mail, heart, medkit, leaf, paw, water, cash, flask,
  globe, sparkles, sunny, clipboard, business,
};

/** Icons of built-in areas (not offered in the icon picker). */
const SYSTEM_ICONS: Record<string, string> = { trash: trashOutline };

export const iconFor = (key: string) => ICONS[key] ?? SYSTEM_ICONS[key] ?? ICONS.sparkles;

/** Colour choices: the validated categorical hues first, then extras. */
export const PALETTE = [
  '#6048B9', '#559AD4', '#DC701C', '#25A37E', '#BE2E34', '#79A23A', '#A35EC1', '#DC6D81',
  '#3987E5', '#C98500', '#D55181', '#199E70', '#0CA30C', '#00ACC1', '#6D4C41', '#757575',
]
