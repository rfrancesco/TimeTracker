import Dexie, { type EntityTable } from 'dexie';
import { normalize } from './constraints';

/**
 * Data model.
 * All timestamps are stored as ISO-8601 UTC strings (e.g. "2026-11-15T08:30:00.000Z")
 * and every record has a client-generated UUID + updatedAt, so a future REST
 * backend can sync these tables without any migration.
 */
export interface Area {
  id: string;
  name: string;
  icon: string; // key in ICONS (src/icons.ts)
  color: string; // hex
  order: number;
  /** Start a new row in the area selector after this area. */
  breakAfter?: boolean;
  archived?: boolean;
  updatedAt: string;
}

export interface SubArea {
  id: string;
  areaId: string;
  name: string;
  order: number;
  archived?: boolean;
  updatedAt: string;
}

export interface Interval {
  id: string;
  areaId: string;
  subAreaId: string | null;
  start: string; // UTC ISO
  end: string; // UTC ISO
  note?: string;
  updatedAt: string;
}

/** The single running timer (key is always 'current'). */
export interface ActiveTimer {
  key: 'current';
  areaId: string;
  subAreaId: string | null;
  start: string; // UTC ISO
}

class TrackerDB extends Dexie {
  areas!: EntityTable<Area, 'id'>;
  subAreas!: EntityTable<SubArea, 'id'>;
  intervals!: EntityTable<Interval, 'id'>;
  active!: EntityTable<ActiveTimer, 'key'>;

  constructor() {
    super('timetracker');
    this.version(1).stores({
      areas: 'id, order',
      subAreas: 'id, areaId, order',
      intervals: 'id, start, end, areaId',
      active: 'key',
    });
    // v2: row breaks in the area selector. Existing installs get one after "Home".
    this.version(2).upgrade(async (tx) => {
      const areas = tx.table('areas');
      if ((await areas.filter((a) => !!a.breakAfter).count()) === 0) {
        await areas.filter((a) => a.name === 'Home').modify({ breakAfter: true });
      }
    });
    // v3: colour-blind-safe default colours. Only areas still on an old default change.
    this.version(3).upgrade(async (tx) => {
      const moved: Record<string, [string, string]> = {
        Sleep: ['#5C6BC0', '#9085E9'], Work: ['#1E88E5', '#0CA30C'], Thesis: ['#00897B', '#E66767'],
        Home: ['#43A047', '#3987E5'], Guitar: ['#F4511E', '#D95926'], Music: ['#D81B60', '#199E70'],
        Reading: ['#8E24AA', '#C98500'], Cinema: ['#FFB300', '#D55181'],
      };
      await tx.table('areas').toCollection().modify((a: Area) => {
        const m = moved[a.name];
        if (m && a.color.toUpperCase() === m[0]) a.color = m[1];
      });
    });
    // v4: enforce the no-overlap invariant (see constraints.ts) on existing data.
    this.version(4).upgrade(async (tx) => {
      const intervals = tx.table('intervals');
      const activeT = tx.table('active');
      const fixed = normalize(await intervals.toArray(), await activeT.get('current'), Date.now());
      if (!fixed.changed) return;
      await intervals.clear();
      await intervals.bulkAdd(fixed.intervals);
      if (fixed.active) await activeT.put(fixed.active);
    });
    // v5: new default colours. Only areas still on the previous default change.
    this.version(5).upgrade(async (tx) => {
      const moved: Record<string, [string, string]> = {
        Sleep: ['#9085E9', '#6048B9'],
        Work: ['#0CA30C', '#559AD4'],
        Thesis: ['#E66767', '#DC701C'],
        Home: ['#3987E5', '#25A37E'],
        Guitar: ['#D95926', '#BE2E34'],
        Music: ['#199E70', '#79A23A'],
        Reading: ['#C98500', '#A35EC1'],
        Cinema: ['#D55181', '#DC6D81'],
      };
      await tx.table('areas').toCollection().modify((a: Area) => {
        const m = moved[a.name];
        if (m && a.color.toUpperCase() === m[0]) a.color = m[1];
      });
    });
    // v6: user-chosen colours; Thesis moves right after Home (and takes the row
    // break with it); Home gets a "Shower" sub-area. Customisations are respected.
    this.version(6).upgrade(async (tx) => {
      const moved: Record<string, [string, string]> = {
        Sleep: ['#6048B9', '#041A40'], Work: ['#559AD4', '#3A6EA5'], Home: ['#25A37E', '#4A904E'],
        Thesis: ['#DC701C', '#48A7D4'], Guitar: ['#BE2E34', '#AF2934'], Music: ['#79A23A', '#DB795B'],
        Reading: ['#A35EC1', '#7A4093'], Cinema: ['#DC6D81', '#B574C9'],
      };
      const areas = tx.table('areas');
      await areas.toCollection().modify((a: Area) => {
        const m = moved[a.name];
        if (m && a.color.toUpperCase() === m[0]) a.color = m[1];
      });
      const all: Area[] = await areas.toArray();
      const home = all.find((a) => a.name === 'Home');
      const thesis = all.find((a) => a.name === 'Thesis');
      if (home && thesis && thesis.order === home.order - 1) {
        await areas.update(thesis.id, { order: home.order });
        await areas.update(home.id, { order: thesis.order });
        if (home.breakAfter && !thesis.breakAfter) {
          await areas.update(home.id, { breakAfter: false });
          await areas.update(thesis.id, { breakAfter: true });
        }
      }
      if (home) {
        const subs = tx.table('subAreas');
        const mine = await subs.where('areaId').equals(home.id).toArray();
        if (!mine.some((x: SubArea) => x.name.toLowerCase() === 'shower')) {
          const order = Math.max(-1, ...mine.map((x: SubArea) => x.order)) + 1;
          await subs.add({ id: uuid(), areaId: home.id, name: 'Shower', order, updatedAt: nowIso() });
        }
      }
    });
  }
}

export const db = new TrackerDB();

export const nowIso = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();

// [name, icon, colour, sub-areas, row break after]
// Colours (chosen with the user): Sleep #041A40 night sky, Work rgb(58,110,165)
// (Windows 2000), Home relaxing sage, Thesis sky blue (calm, not a warning colour,
// apart from hobby/relaxation colours), Guitar+Music a red family, Reading+Cinema a
// purple family (grouped by hue, separated by lightness). Validated in both themes:
// neighbours in this order (also the report stacking order) pass the colour-vision
// checks, and neighbours are distinguishable with normal vision.
const DEFAULT_AREAS: Array<[string, string, string, string[], boolean?]> = [
  ['Sleep', 'moon', '#041A40', []],
  ['Work', 'briefcase', '#3A6EA5', []],
  ['Home', 'home', '#4A904E', ['Cleaning', 'Cooking', 'Errands', 'Shower']],
  ['Thesis', 'school', '#48A7D4', [], true],
  ['Guitar', 'musical-notes', '#AF2934', ['Technique', 'Songs']],
  ['Music', 'headset', '#DB795B', []],
  ['Reading', 'book', '#7A4093', []],
  ['Cinema', 'film', '#B574C9', []],
];

type Adder = { add: (item: never) => unknown };

/** Insert the default areas; works both inside 'populate' and in a normal transaction. */
function seedDefaults(areas: Adder, subAreas: Adder) {
  const t = nowIso();
  DEFAULT_AREAS.forEach(([name, icon, color, subs, breakAfter], i) => {
    const id = uuid();
    areas.add({ id, name, icon, color, order: i, ...(breakAfter && { breakAfter }), updatedAt: t } as never);
    subs.forEach((s, j) =>
      subAreas.add({ id: uuid(), areaId: id, name: s, order: j, updatedAt: t } as never),
    );
  });
}

/** Seed default areas on first launch. */
db.on('populate', (tx) => seedDefaults(tx.table('areas'), tx.table('subAreas')));

/** Delete all tracked time (and the running timer), keeping areas as configured. */
export async function deleteTrackedTime() {
  await db.transaction('rw', [db.intervals, db.active], async () => {
    await db.intervals.clear();
    await db.active.clear();
  });
}

/** Delete everything and restore the default areas. */
export async function resetEverything() {
  await db.transaction('rw', [db.areas, db.subAreas, db.intervals, db.active], async () => {
    await Promise.all([db.areas.clear(), db.subAreas.clear(), db.intervals.clear(), db.active.clear()]);
    seedDefaults(db.areas, db.subAreas);
  });
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
}

export async function exportAll() {
  return {
    version: 1,
    exportedAt: nowIso(),
    areas: await db.areas.toArray(),
    subAreas: await db.subAreas.toArray(),
    intervals: await db.intervals.toArray(),
    active: await db.active.toArray(),
  };
}

/** Replace everything with a backup. Returns how many records had to be fixed for overlaps. */
export async function importAll(data: Awaited<ReturnType<typeof exportAll>>) {
  const fixed = normalize(data.intervals, data.active?.[0], Date.now());
  await db.transaction('rw', [db.areas, db.subAreas, db.intervals, db.active], async () => {
    await Promise.all([db.areas.clear(), db.subAreas.clear(), db.intervals.clear(), db.active.clear()]);
    await db.areas.bulkAdd(data.areas);
    await db.subAreas.bulkAdd(data.subAreas);
    await db.intervals.bulkAdd(fixed.intervals);
    if (fixed.active) await db.active.put(fixed.active);
  });
  return fixed.changed;
}
