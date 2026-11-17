import type { ActiveTimer, Area, Interval, SubArea } from './db';

/**
 * Backup file format. Exports carry `app` + `format`; files without them
 * (exports from before this field existed) are accepted if their content is valid.
 */
export const BACKUP_APP = 'timetracker';
export const BACKUP_FORMAT = 1;

export interface Backup {
  app?: string;
  format?: number;
  version?: number;
  exportedAt?: string;
  areas: Area[];
  subAreas: SubArea[];
  intervals: Interval[];
  active: ActiveTimer[];
}

export class BackupError extends Error {}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const isTime = (x: unknown) => typeof x === 'string' && Number.isFinite(Date.parse(x));
const isColor = (x: unknown) => typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x);

/**
 * Parse and fully validate a backup before anything is written: structure, field
 * types, unique ids and every reference between records. Throws BackupError with
 * a message that names the first problem found.
 */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('This file isn’t valid JSON, so it can’t be a backup.');
  }
  if (!isObj(raw)) throw new BackupError('This file isn’t a Time Tracker backup.');
  if (raw.app !== undefined && raw.app !== BACKUP_APP) throw new BackupError('This file was made by a different app.');
  if (typeof raw.format === 'number' && raw.format > BACKUP_FORMAT) {
    throw new BackupError('This backup is from a newer version of the app. Update the app first.');
  }
  for (const key of ['areas', 'subAreas', 'intervals'] as const) {
    if (!Array.isArray(raw[key])) throw new BackupError(`This file is missing its “${key}” list, so it isn’t a complete backup.`);
  }
  const active = raw.active === undefined ? [] : raw.active;
  if (!Array.isArray(active) || active.length > 1) throw new BackupError('The running-timer section of this file is invalid.');

  const areas = raw.areas as unknown[];
  const subAreas = raw.subAreas as unknown[];
  const intervals = raw.intervals as unknown[];

  const ids = (list: unknown[], what: string) => {
    const seen = new Set<string>();
    list.forEach((x, i) => {
      if (!isObj(x) || !isStr(x.id)) throw new BackupError(`${what} #${i + 1} has no id.`);
      if (seen.has(x.id)) throw new BackupError(`Two ${what.toLowerCase()}s share the id “${x.id}”.`);
      seen.add(x.id);
    });
    return seen;
  };
  const areaIds = ids(areas, 'Area');
  const subIds = ids(subAreas, 'Sub-area');
  ids(intervals, 'Interval');

  for (const a of areas as Record<string, unknown>[]) {
    if (!isStr(a.name) || !isStr(a.icon) || !isColor(a.color) || typeof a.order !== 'number') {
      throw new BackupError(`Area “${String(a.name ?? a.id)}” is incomplete (name, icon, colour or order).`);
    }
    if (a.liveUpdates !== undefined && typeof a.liveUpdates !== 'boolean') {
      throw new BackupError(`Area “${String(a.name)}” has an invalid live updates setting.`);
    }
  }
  for (const s of subAreas as Record<string, unknown>[]) {
    if (!isStr(s.name) || typeof s.order !== 'number') throw new BackupError(`Sub-area “${String(s.id)}” is incomplete.`);
    if (!areaIds.has(s.areaId as string)) throw new BackupError(`Sub-area “${String(s.name)}” belongs to an area that isn’t in the file.`);
  }
  for (const iv of intervals as Record<string, unknown>[]) {
    if (!areaIds.has(iv.areaId as string)) throw new BackupError(`An interval refers to an area that isn’t in the file.`);
    if (iv.subAreaId !== null && iv.subAreaId !== undefined && !subIds.has(iv.subAreaId as string)) {
      throw new BackupError(`An interval refers to a sub-area that isn’t in the file.`);
    }
    if (!isTime(iv.start) || !isTime(iv.end)) throw new BackupError(`An interval has an invalid start or end time.`);
    if (iv.note !== undefined && typeof iv.note !== 'string') throw new BackupError(`An interval has an invalid note.`);
  }
  for (const t of active as Record<string, unknown>[]) {
    if (!isObj(t) || t.key !== 'current' || !areaIds.has(t.areaId as string) || !isTime(t.start)) {
      throw new BackupError('The running timer in this file is invalid.');
    }
  }

  return {
    ...(raw as object),
    areas: areas as Area[],
    subAreas: subAreas as SubArea[],
    intervals: (intervals as Interval[]).map((iv) => ({
      ...iv,
      subAreaId: iv.subAreaId ?? null,
      updatedAt: isTime(iv.updatedAt) ? iv.updatedAt : iv.end, // older files: needed for overlap resolution
    })),
    active: active as ActiveTimer[],
  };
}
