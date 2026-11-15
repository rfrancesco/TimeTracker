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
  }
}

export const db = new TrackerDB();

export const nowIso = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();

const DEFAULT_AREAS: Array<[string, string, string, string[]]> = [
  ['Sleep', 'moon', '#5C6BC0', []],
  ['Work', 'briefcase', '#1E88E5', ['Meetings', 'Deep work', 'Email']],
  ['Home', 'home', '#43A047', ['Cleaning', 'Cooking', 'Errands']],
  ['Guitar', 'musical-notes', '#F4511E', ['Technique', 'Songs']],
  ['Reading', 'book', '#8E24AA', []],
  ['Sport', 'barbell', '#E53935', []],
];

/** Seed default areas on first launch. */
db.on('populate', (tx) => {
  const t = nowIso();
  DEFAULT_AREAS.forEach(([name, icon, color, subs], i) => {
    const id = uuid();
    tx.table('areas').add({ id, name, icon, color, order: i, updatedAt: t });
    subs.forEach((s, j) =>
      tx.table('subAreas').add({ id: uuid(), areaId: id, name: s, order: j, updatedAt: t }),
    );
  });
});

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
