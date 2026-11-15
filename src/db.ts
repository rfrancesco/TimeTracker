import Dexie, { type EntityTable } from 'dexie';

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
  }
}

export const db = new TrackerDB();

export const nowIso = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();

// [name, icon, colour, sub-areas, row break after]
// Colours: an 8-hue categorical palette validated for colour-vision deficiency and
// contrast in light and dark mode, assigned so that neighbours in this order (which
// is also the stacking order in reports) stay distinguishable.
const DEFAULT_AREAS: Array<[string, string, string, string[], boolean?]> = [
  ['Sleep', 'moon', '#9085E9', []],
  ['Work', 'briefcase', '#0CA30C', []],
  ['Thesis', 'school', '#E66767', []],
  ['Home', 'home', '#3987E5', ['Cleaning', 'Cooking', 'Errands'], true],
  ['Guitar', 'musical-notes', '#D95926', ['Technique', 'Songs']],
  ['Music', 'headset', '#199E70', []],
  ['Reading', 'book', '#C98500', []],
  ['Cinema', 'film', '#D55181', []],
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

export async function importAll(data: Awaited<ReturnType<typeof exportAll>>) {
  await db.transaction('rw', [db.areas, db.subAreas, db.intervals, db.active], async () => {
    await Promise.all([db.areas.clear(), db.subAreas.clear(), db.intervals.clear(), db.active.clear()]);
    await db.areas.bulkAdd(data.areas);
    await db.subAreas.bulkAdd(data.subAreas);
    await db.intervals.bulkAdd(data.intervals);
    if (data.active?.length) await db.active.bulkAdd(data.active);
  });
}
