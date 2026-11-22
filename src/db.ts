import Dexie, { type EntityTable } from 'dexie';
import { normalize } from './constraints';
import { BACKUP_APP, BACKUP_FORMAT, type Backup } from './backup';

/**
 * Data model.
 * All timestamps are stored as ISO-8601 UTC strings (e.g. "2026-11-15T08:30:00.000Z")
 * and every record has a client-generated UUID + updatedAt, so a future REST
 * backend can sync these tables without any migration.
 */
export type RunningTime = 'off' | 'app' | 'on';

export interface Area {
  id: string;
  name: string;
  icon: string; // key in ICONS (src/icons.ts)
  color: string; // hex
  order: number;
  /** Start a new row in the area selector after this area. */
  breakAfter?: boolean;
  archived?: boolean;
  /** Where the running time ticks: off ("since …"), app only, or also in the notification. Missing = on. */
  runningTime?: RunningTime;
  /** Android app: show this area's timer as a live update (status bar, lock screen). Missing = yes. */
  liveUpdate?: boolean;
  /** Legacy (until v10): false meant "live update without the time". Converted by upgradeAreaSettings. */
  liveUpdates?: boolean;
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
  /** Written while it runs (Timer → Note); saved with the interval. */
  note?: string;
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
    // v7: Home gets "Laundry"; one-off chores move out of Home into a new
    // "Errand" area (after Thesis, taking the row break). Anything tracked as
    // Home · Errands, including a running timer, moves to Errand.
    this.version(7).upgrade(async (tx) => {
      const areas = tx.table('areas');
      const subs = tx.table('subAreas');
      const t = nowIso();
      const all: Area[] = await areas.toArray();
      const home = all.find((a) => a.name === 'Home');
      let errand = all.find((a) => a.name === 'Errand');
      if (!errand) {
        const thesis = all.find((a) => a.name === 'Thesis');
        const after = thesis ?? home;
        const order = after ? after.order + 1 : all.length;
        for (const a of all) if (a.order >= order) await areas.update(a.id, { order: a.order + 1 });
        errand = { id: uuid(), name: 'Errand', icon: 'clipboard', color: '#9F7100', order, updatedAt: t };
        if (after?.breakAfter) {
          errand.breakAfter = true;
          await areas.update(after.id, { breakAfter: false });
        }
        await areas.add(errand);
      }
      if (!home) return;
      const mine: SubArea[] = await subs.where('areaId').equals(home.id).toArray();
      if (!mine.some((x) => x.name.toLowerCase() === 'laundry')) {
        // Slot it in before "Shower" if present (matches the default order), else at the end.
        const shower = mine.find((x) => x.name.toLowerCase() === 'shower');
        const order = shower ? shower.order : Math.max(-1, ...mine.map((x) => x.order)) + 1;
        for (const x of mine) if (x.order >= order) await subs.update(x.id, { order: x.order + 1 });
        await subs.add({ id: uuid(), areaId: home.id, name: 'Laundry', order, updatedAt: t });
      }
      const old = mine.find((x) => x.name.toLowerCase() === 'errands');
      if (old) {
        await tx.table('intervals').where('areaId').equals(home.id)
          .modify((iv: Interval) => {
            if (iv.subAreaId === old.id) Object.assign(iv, { areaId: errand!.id, subAreaId: null, updatedAt: t });
          });
        const act = await tx.table('active').get('current');
        if (act?.subAreaId === old.id) await tx.table('active').put({ ...act, areaId: errand.id, subAreaId: null });
        await subs.delete(old.id);
      }
    });
    // v8: new "Friends" area at the end of the second row.
    this.version(8).upgrade(async (tx) => {
      const areas = tx.table('areas');
      const all: Area[] = await areas.toArray();
      if (all.some((a) => a.name === 'Friends')) return;
      const order = Math.max(-1, ...all.map((a) => a.order)) + 1;
      await areas.add({ id: uuid(), name: 'Friends', icon: 'people', color: '#A99F00', order, updatedAt: nowIso() });
    });
    // v9: two catch-alls. "Self-care" (meditation, stretching… a calm teal) after Home;
    // "Hobby" (intentional time outside the main hobbies, e.g. a concert) before
    // Friends. Placed relative to the user's own order; nothing else moves.
    this.version(9).upgrade(async (tx) => {
      const areas = tx.table('areas');
      const add = async (name: string, icon: string, color: string, anchor: string, where: 'after' | 'before') => {
        const all: Area[] = await areas.toArray();
        if (all.some((a) => a.name.toLowerCase() === name.toLowerCase())) return;
        const ref = all.find((a) => a.name === anchor);
        const order = ref ? (where === 'after' ? ref.order + 1 : ref.order) : Math.max(-1, ...all.map((a) => a.order)) + 1;
        for (const a of all) if (a.order >= order) await areas.update(a.id, { order: a.order + 1 });
        await areas.add({ id: uuid(), name, icon, color, order, updatedAt: nowIso() });
      };
      await add('Self-care', 'leaf', '#007A61', 'Home', 'after');
      await add('Hobby', 'sparkles', '#BF537A', 'Friends', 'before');
      // New palette for the areas whose colour was free to choose; only colours
      // still equal to the old default change (a colour the user picked stays).
      const recolor: Record<string, [string, string]> = {
        Home: ['#4A904E', '#71A100'],
        Errand: ['#9F7100', '#A97721'],
        Reading: ['#7A4093', '#76518C'],
        Cinema: ['#B574C9', '#A171E8'],
        Friends: ['#A99F00', '#7B5F06'],
      };
      for (const a of (await areas.toArray()) as Area[]) {
        const r = recolor[a.name];
        if (r && a.color.toUpperCase() === r[0]) await areas.update(a.id, { color: r[1], updatedAt: nowIso() });
      }
    });
    // v10: running time and live updates become two separate per-area settings. The
    // old flag (liveUpdates: false = a live update without the time) becomes running
    // time "app only" with the live update kept on: exactly the same behaviour.
    this.version(10).upgrade(async (tx) => {
      await tx.table('areas').toCollection().modify((a: Area) => {
        upgradeAreaSettings(a);
      });
    });
  }
}

/** Convert the pre-v10 `liveUpdates` flag (also in older backups). Mutates and returns `a`. */
export function upgradeAreaSettings<T extends Area>(a: T): T {
  if (a.liveUpdates === false && a.runningTime === undefined) a.runningTime = 'app';
  delete a.liveUpdates;
  return a;
}

export const db = new TrackerDB();

export const nowIso = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();

// [name, icon, colour, sub-areas, row break after]
// Fixed by the user: Sleep #041A40 night sky, Work rgb(58,110,165) (Windows 2000),
// Thesis sky blue, Guitar deep red, Music coral. The others were chosen together by
// a search over OKLCH (v9) with Reading+Cinema in one purple family (both cultural)
// and Self-care calm: in both themes, as displayed, neighbours in this order (also
// the report stacking order) clear the colour-vision target (ΔE 10.9 ≥ 8) and the
// normal-vision floor (16.9 ≥ 15), and every pair stays ≥ 10.7 apart.
// Defaults also: live updates off everywhere, Sleep and Work with running time Off.
const DEFAULT_AREAS: Array<[string, string, string, string[], boolean?]> = [
  ['Sleep', 'moon', '#041A40', []],
  ['Work', 'briefcase', '#3A6EA5', []],
  ['Home', 'home', '#71A100', ['Cleaning', 'Cooking', 'Laundry', 'Shower']],
  ['Self-care', 'paw', '#007A61', []],
  ['Thesis', 'school', '#48A7D4', []],
  ['Errand', 'clipboard', '#A97721', [], true],
  ['Guitar', 'musical-notes', '#AF2934', ['Technique', 'Songs']],
  ['Music', 'headset', '#DB795B', []],
  ['Reading', 'book', '#76518C', []],
  ['Cinema', 'film', '#A171E8', []],
  ['Hobby', 'color-palette', '#BF537A', []],
  ['Friends', 'people', '#7B5F06', []],
];

type Adder = { add: (item: never) => unknown };

const QUIET_BY_DEFAULT = new Set(['Sleep', 'Work']);

/** Insert the default areas; works both inside 'populate' and in a normal transaction. */
function seedDefaults(areas: Adder, subAreas: Adder) {
  const t = nowIso();
  DEFAULT_AREAS.forEach(([name, icon, color, subs, breakAfter], i) => {
    const id = uuid();
    areas.add({
      id, name, icon, color, order: i,
      ...(breakAfter && { breakAfter }),
      // Defaults: no live updates (they can hide other status-bar icons); Sleep and Work
      // without a ticking time.
      liveUpdate: false,
      ...(QUIET_BY_DEFAULT.has(name) && { runningTime: 'off' }),
      updatedAt: t,
    } as never);
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

/**
 * Intervals overlapping [startIso, endIso). Because intervals never overlap (see
 * constraints.ts), these are the ones starting inside the range plus at most one
 * that started earlier and runs into it: two indexed lookups, no full scan.
 */
export async function intervalsOverlapping(startIso: string, endIso: string) {
  const [before, inside] = await Promise.all([
    db.intervals.where('start').below(startIso).last(),
    db.intervals.where('start').between(startIso, endIso, true, false).toArray(),
  ]);
  return before && before.end > startIso ? [before, ...inside] : inside;
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

export async function exportAll(): Promise<Backup> {
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    exportedAt: nowIso(),
    areas: await db.areas.toArray(),
    subAreas: await db.subAreas.toArray(),
    intervals: await db.intervals.toArray(),
    active: await db.active.toArray(),
  };
}

/** Replace everything with a backup. Returns how many records had to be fixed for overlaps. */
export async function importAll(data: Backup) {
  const fixed = normalize(data.intervals, data.active?.[0], Date.now());
  await db.transaction('rw', [db.areas, db.subAreas, db.intervals, db.active], async () => {
    await Promise.all([db.areas.clear(), db.subAreas.clear(), db.intervals.clear(), db.active.clear()]);
    await db.areas.bulkAdd(data.areas.map((a) => upgradeAreaSettings({ ...a })));
    await db.subAreas.bulkAdd(data.subAreas);
    await db.intervals.bulkAdd(fixed.intervals);
    if (fixed.active) await db.active.put(fixed.active);
  });
  return fixed.changed;
}
