import { db, nowIso, uuid, type ActiveTimer, type Interval } from './db';
import { clearRange, commitTimerSpan } from './constraints';
import { clearAllHistory } from './undo';

/**
 * Archiving, restoring and permanently deleting areas and sub-areas, and cleaning up
 * tracked time. Nothing is deleted by accident: removing an area or sub-area archives
 * it (hidden from pickers, history kept); permanent deletion happens from the
 * Archived page and says where the time goes.
 */

export type Target = { kind: 'area'; id: string } | { kind: 'sub'; id: string };

/**
 * Where a permanently deleted item's time goes:
 * - deleted: the built-in "Deleted" area (or, for a sub-area, its area's "Deleted" sub-area)
 * - plain:   (sub-areas) its area, with no sub-area
 * - merge:   another area / sub-area
 * - drop:    delete the time too
 */
export type Destination =
  | { kind: 'deleted' }
  | { kind: 'plain' }
  | { kind: 'merge'; areaId: string; subAreaId: string | null }
  | { kind: 'drop' };

export const DELETED_NAME = 'Deleted';
const DELETED_COLOR = '#78716C';

const t = () => nowIso();

/** Archive: hidden from the pickers, history kept. A running timer on it keeps running. */
export async function archive(target: Target) {
  if (target.kind === 'area') await db.areas.update(target.id, { archived: true, updatedAt: t() });
  else await db.subAreas.update(target.id, { archived: true, updatedAt: t() });
}

/** Archive the running sub-area and let the timer continue as its area (no sub-area). */
export async function archiveSubAndDetach(subId: string) {
  await db.transaction('rw', [db.subAreas, db.active], async () => {
    await db.subAreas.update(subId, { archived: true, updatedAt: t() });
    const a = await db.active.get('current');
    if (a?.subAreaId === subId) await db.active.put({ ...a, subAreaId: null });
  });
}

/** Restore: back in the pickers (an area goes to the end of the order; a sub-area's area is restored too). */
export async function restore(target: Target) {
  await db.transaction('rw', [db.areas, db.subAreas], async () => {
    const areaId = target.kind === 'area' ? target.id : (await db.subAreas.get(target.id))?.areaId;
    if (!areaId) return;
    const area = await db.areas.get(areaId);
    if (area?.archived) {
      const last = await db.areas.orderBy('order').last();
      await db.areas.update(areaId, { archived: false, order: (last?.order ?? 0) + 1, updatedAt: t() });
    }
    if (target.kind === 'sub') {
      const subs = await db.subAreas.where('areaId').equals(areaId).toArray();
      const order = Math.max(-1, ...subs.filter((s) => !s.archived).map((s) => s.order)) + 1;
      await db.subAreas.update(target.id, { archived: false, order, updatedAt: t() });
    }
  });
}

/** The intervals an item covers (a sub-area's, or all of an area's). */
function intervalsOf(target: Target) {
  return target.kind === 'area'
    ? db.intervals.where('areaId').equals(target.id).toArray()
    : db.intervals.filter((i) => i.subAreaId === target.id).toArray();
}

/** How much time an item has: intervals, total ms, last end (ms), and whether the running timer is on it. */
export async function usage(target: Target) {
  const list = await intervalsOf(target);
  const a = await db.active.get('current');
  return {
    count: list.length,
    ms: list.reduce((s, i) => s + Date.parse(i.end) - Date.parse(i.start), 0),
    last: list.reduce((m, i) => Math.max(m, Date.parse(i.end)), 0) || null,
    running: !!a && (target.kind === 'area' ? a.areaId === target.id : a.subAreaId === target.id),
  };
}

/** The built-in "Deleted" area, created on first use. */
async function deletedArea() {
  const found = (await db.areas.toArray()).find((a) => a.system === 'deleted');
  if (found) return found.id;
  const id = uuid();
  const last = await db.areas.orderBy('order').last();
  await db.areas.add({ id, name: DELETED_NAME, icon: 'trash', color: DELETED_COLOR, order: (last?.order ?? 0) + 1, archived: true, system: 'deleted', runningTime: 'on', updatedAt: t() });
  return id;
}

/** An area's built-in "Deleted" sub-area, created on first use. */
async function deletedSub(areaId: string) {
  const found = (await db.subAreas.where('areaId').equals(areaId).toArray()).find((s) => s.system === 'deleted');
  if (found) return found.id;
  const id = uuid();
  await db.subAreas.add({ id, areaId, name: DELETED_NAME, order: 999, archived: true, system: 'deleted', updatedAt: t() });
  return id;
}

/**
 * Delete an area or sub-area permanently, moving (or deleting) its time as `to` says.
 * A running timer on it follows: merge / plain = relabelled, keeps running; deleted =
 * stopped, its time kept as Deleted; drop = discarded. Clears all undo history.
 */
export async function deletePermanently(target: Target, to: Destination) {
  await db.transaction('rw', [db.areas, db.subAreas, db.intervals, db.active], async () => {
    const sub = target.kind === 'sub' ? await db.subAreas.get(target.id) : undefined;
    if (target.kind === 'sub' && !sub) return;
    // The new label for this item's time, or null to delete it.
    let label: { areaId: string; subAreaId: string | null } | null = null;
    if (to.kind === 'merge') label = { areaId: to.areaId, subAreaId: to.subAreaId };
    else if (to.kind === 'plain' && sub) label = { areaId: sub.areaId, subAreaId: null };
    else if (to.kind === 'deleted') label = sub ? { areaId: sub.areaId, subAreaId: await deletedSub(sub.areaId) } : { areaId: await deletedArea(), subAreaId: null };

    const list: Interval[] = await intervalsOf(target);
    if (label) await db.intervals.bulkPut(list.map((i) => ({ ...i, ...label, updatedAt: t() })));
    else await db.intervals.bulkDelete(list.map((i) => i.id));

    const a = await db.active.get('current');
    if (a && (target.kind === 'area' ? a.areaId === target.id : a.subAreaId === target.id)) {
      if (!label) await db.active.delete('current');
      else {
        const relabelled: ActiveTimer = { ...a, ...label };
        if (to.kind === 'deleted') {
          await commitTimerSpan(relabelled, Date.now());
          await db.active.delete('current');
        } else await db.active.put(relabelled);
      }
    }

    if (target.kind === 'area') {
      await db.subAreas.where('areaId').equals(target.id).delete();
      await db.areas.delete(target.id);
    } else await db.subAreas.delete(target.id);
  });
  clearAllHistory();
}

/** Delete saved time in [from, to) (ms); intervals crossing a boundary are cut. The running timer is untouched. */
export async function deleteTimeBetween(from: number, to: number) {
  await clearRange(from, to);
  clearAllHistory();
}

/** The intervals kept as "Deleted" (the built-in area and the "Deleted" sub-areas). */
export async function deletedTime() {
  const area = (await db.areas.toArray()).find((a) => a.system === 'deleted');
  const subs = new Set((await db.subAreas.toArray()).filter((s) => s.system === 'deleted').map((s) => s.id));
  return db.intervals.filter((i) => i.areaId === area?.id || (!!i.subAreaId && subs.has(i.subAreaId))).toArray();
}

/** Delete all time kept as "Deleted". */
export async function deleteDeletedTime() {
  await db.transaction('rw', [db.areas, db.subAreas, db.intervals], async () => {
    await db.intervals.bulkDelete((await deletedTime()).map((i) => i.id));
  });
  clearAllHistory();
}
