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

export const PALETTE = [
  '#E53935', '#D81B60', '#8E24AA', '#5E35B1', '#5C6BC0', '#1E88E5', '#039BE5', '#00ACC1',
  '#00897B', '#43A047', '#7CB342', '#C0CA33', '#FDD835', '#FFB300', '#FB8C00', '#F4511E',
  '#6D4C41', '#757575', '#546E7A',
];
