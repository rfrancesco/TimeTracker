import {
  moon, briefcase, home, musicalNotes, book, barbell, bicycle, walk, restaurant, cafe,
  car, bus, train, airplane, cart, code, laptop, desktop, gameController, tv, film,
  brush, colorPalette, camera, school, library, people, person, heart, medkit, fitness,
  leaf, paw, water, bed, call, chatbubbles, mail, cash, construct, hammer, flask,
  globe, language, mic, headset, pencil, sparkles, sunny, football, basketball, tennisball,
} from 'ionicons/icons';

export const ICONS: Record<string, string> = {
  moon, bed, briefcase, laptop, desktop, code, home, construct, hammer, 'musical-notes': musicalNotes,
  mic, headset, book, library, school, pencil, language, barbell, fitness, bicycle, walk,
  football, basketball, tennisball, restaurant, cafe, cart, car, bus, train, airplane,
  'game-controller': gameController, tv, film, brush, 'color-palette': colorPalette, camera,
  people, person, call, chatbubbles, mail, heart, medkit, leaf, paw, water, cash, flask,
  globe, sparkles, sunny,
};

export const iconFor = (key: string) => ICONS[key] ?? ICONS.sparkles;

/** Colour choices: the validated categorical hues first, then extras. */
export const PALETTE = [
  '#3987E5', '#D95926', '#199E70', '#C98500', '#D55181', '#0CA30C', '#9085E9', '#E66767',
  '#5E35B1', '#00ACC1', '#7CB342', '#FB8C00', '#8E24AA', '#6D4C41', '#757575', '#546E7A',
];
