const lib = require('./lib.cjs');
// Permanent deletion, every destination with and without a running timer (archive.ts,
// called directly), restore details, the built-in "Deleted" never offered anywhere,
// reports, backups, cleanup edge cases, and the UI paths not covered by archive.test.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome', colorScheme: process.env.SCHEME || 'dark' })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  // A fixed evening, so the seeded hours (now − 10 h … now − 2 h) are all today.
  await p.clock.install({ time: new Date('2026-11-16T20:00:00+01:00') });
  await p.goto(lib.DEV); await p.waitForSelector('.area-pill-btn', { timeout: 15000 });
  const H = 3600_000;
  const now = await p.evaluate(() => Date.now());
  const at = (h) => new Date(now - h * H).toISOString();
  const call = (fn, arg) => p.evaluate(async ([src, arg]) => {
    const A = await import('/src/archive.ts'); const db = (await import('/src/db.ts')).db;
    const area = async (n) => (await db.areas.toArray()).find((a) => a.name === n);
    const sub = async (a, n) => (await db.subAreas.toArray()).find((s) => s.areaId === (a && a.id) && s.name === n);
    return new Function('ctx', `return (${src})(ctx)`)({ A, db, area, sub, arg });
  }, [fn.toString(), arg]);
  const reset = async (active) => {
    await p.evaluate(async () => { const db = (await import('/src/db.ts')).db; await db.transaction('rw', [db.areas, db.subAreas, db.intervals, db.active], async () => { await Promise.all([db.areas.clear(), db.subAreas.clear(), db.intervals.clear(), db.active.clear()]); }); await (await import('/src/db.ts')).resetEverything(); });
    await lib.seed(p, { intervals: [
      { id: 'g1', area: 'Guitar', sub: 'Songs', start: at(10), end: at(9) },
      { id: 'g2', area: 'Guitar', sub: 'Technique', start: at(9), end: at(8) },
      { id: 'g3', area: 'Guitar', start: at(8), end: at(7) },
      { id: 'm1', area: 'Music', start: at(7), end: at(6) },
    ], active });
  };
  const labels = () => lib.read(p, ({ areas, subs, intervals }) => intervals.sort((x, y) => x.id.localeCompare(y.id)).map((i) => `${i.id.length < 4 ? i.id : 'new'}:${areas.find((a) => a.id === i.areaId)?.name}${i.subAreaId ? '·' + subs.find((s) => s.id === i.subAreaId)?.name : ''}`).join(' '));
  const running = () => lib.read(p, ({ areas, subs, active }) => (active ? `${areas.find((a) => a.id === active.areaId)?.name}${active.subAreaId ? '·' + subs.find((s) => s.id === active.subAreaId)?.name : ''}@${active.start}` : 'idle'));
  const del = (target, dest) => call(async ({ A, area, sub, arg }) => {
    const g = await area(arg.area);
    const t = arg.sub ? { kind: 'sub', id: (await sub(g, arg.sub)).id } : { kind: 'area', id: g.id };
    let d = arg.dest;
    if (d.kind === 'merge') { const m = await area(d.area); d = { kind: 'merge', areaId: m.id, subAreaId: d.sub ? (await sub(m, d.sub)).id : null }; }
    await A.deletePermanently(t, d);
  }, { ...target, dest });
  const runAt = at(2);

  // ---- Area: each destination, not running and running ----
  await reset();
  await del({ area: 'Guitar' }, { kind: 'deleted' });
  lib.report('area → Deleted: all its intervals (any sub-area) become plain “Deleted”', (await labels()) === 'g1:Deleted g2:Deleted g3:Deleted m1:Music', await labels());
  lib.report('…the area and its sub-areas are gone', await call(async ({ area, db }) => !(await area('Guitar')) && (await db.subAreas.toArray()).every((s) => ['Songs', 'Technique'].indexOf(s.name) < 0)));
  await reset({ area: 'Guitar', sub: 'Songs', start: runAt });
  await del({ area: 'Guitar' }, { kind: 'deleted' });
  lib.report('running area → Deleted: the timer stops, its time saved as Deleted', (await running()) === 'idle' && /new:Deleted/.test(await labels()), `${await running()} | ${await labels()}`);
  await reset({ area: 'Guitar', sub: 'Songs', start: runAt });
  await del({ area: 'Guitar' }, { kind: 'merge', area: 'Home', sub: 'Cooking' });
  lib.report('running area → merge into Home · Cooking: intervals and timer relabelled, same start', (await labels()) === 'g1:Home·Cooking g2:Home·Cooking g3:Home·Cooking m1:Music' && (await running()) === `Home·Cooking@${runAt}`, `${await labels()} | ${await running()}`);
  await reset({ area: 'Guitar', start: runAt });
  await del({ area: 'Guitar' }, { kind: 'drop' });
  lib.report('running area → drop: its time and the timer are gone, others untouched', (await labels()) === 'm1:Music' && (await running()) === 'idle', `${await labels()} | ${await running()}`);
  await reset();
  await del({ area: 'Guitar' }, { kind: 'deleted' }); await del({ area: 'Music' }, { kind: 'deleted' });
  lib.report('a second deleted area reuses the same “Deleted” area', (await call(async ({ db }) => (await db.areas.toArray()).filter((a) => a.system === 'deleted').length)) === 1);

  // ---- Sub-area: each destination ----
  await reset({ area: 'Guitar', sub: 'Songs', start: runAt });
  await del({ area: 'Guitar', sub: 'Songs' }, { kind: 'deleted' });
  lib.report('running sub-area → Deleted: Guitar · Deleted, timer stops (saved as Guitar · Deleted)', /g1:Guitar·Deleted g2:Guitar·Technique g3:Guitar m1:Music/.test(await labels()) && /new:Guitar·Deleted/.test(await labels()) && (await running()) === 'idle', `${await labels()} | ${await running()}`);
  await del({ area: 'Guitar', sub: 'Technique' }, { kind: 'deleted' });
  lib.report('…a second one reuses Guitar’s “Deleted” sub-area (hidden, archived)', await call(async ({ db, area }) => { const g = await area('Guitar'); const d = (await db.subAreas.toArray()).filter((s) => s.areaId === g.id && s.system === 'deleted'); return d.length === 1 && d[0].archived; }));
  await reset({ area: 'Guitar', sub: 'Songs', start: runAt });
  await del({ area: 'Guitar', sub: 'Songs' }, { kind: 'plain' });
  lib.report('running sub-area → plain: Guitar without sub-area, the timer keeps running', /g1:Guitar g2:Guitar·Technique/.test(await labels()) && (await running()) === `Guitar@${runAt}`, `${await labels()} | ${await running()}`);
  await reset({ area: 'Guitar', sub: 'Songs', start: runAt });
  await del({ area: 'Guitar', sub: 'Songs' }, { kind: 'merge', area: 'Guitar', sub: 'Technique' });
  lib.report('sub-area → merge into a sibling sub-area', /g1:Guitar·Technique g2:Guitar·Technique/.test(await labels()) && (await running()) === `Guitar·Technique@${runAt}`, `${await labels()} | ${await running()}`);
  await reset({ area: 'Guitar', sub: 'Songs', start: runAt });
  await del({ area: 'Guitar', sub: 'Songs' }, { kind: 'drop' });
  lib.report('running sub-area → drop: only its time and the timer go', (await labels()) === 'g2:Guitar·Technique g3:Guitar m1:Music' && (await running()) === 'idle', `${await labels()} | ${await running()}`);

  // ---- Undo history is cleared; usage; restore ----
  await reset();
  const undoAfter = await call(async ({ A, area }) => {
    const U = await import('/src/undo.ts'); const T = await import('/src/timer.ts');
    const readingId = (await area('Reading')).id;
    await U.recordTimerAction('start', () => T.track(readingId, null));
    await A.deletePermanently({ kind: 'area', id: (await area('Cinema')).id }, { kind: 'deleted' });
    return U.undo();
  });
  lib.report('a permanent deletion clears the timer’s undo history', undoAfter.ok === false && !undoAfter.label, JSON.stringify(undoAfter));
  await reset({ area: 'Guitar', sub: 'Songs', start: runAt });
  const u = await call(async ({ A, area, sub }) => { const g = await area('Guitar'); return [await A.usage({ kind: 'area', id: g.id }), await A.usage({ kind: 'sub', id: (await sub(g, 'Songs')).id })]; });
  lib.report('usage(): count, total, last, running', u[0].count === 3 && u[0].ms === 3 * H && u[0].running && u[1].count === 1 && u[1].running, JSON.stringify(u));
  await call(async ({ A, area, sub }) => { const g = await area('Guitar'); await A.archive({ kind: 'sub', id: (await sub(g, 'Songs')).id }); await A.archive({ kind: 'area', id: g.id }); await A.restore({ kind: 'sub', id: (await sub(g, 'Songs')).id }); });
  const rest = await call(async ({ db, area }) => { const g = await area('Guitar'); const max = Math.max(...(await db.areas.toArray()).filter((a) => !a.system).map((a) => a.order)); return { area: !g.archived, last: g.order === max, subs: (await db.subAreas.where('areaId').equals(g.id).toArray()).filter((s) => !s.archived).map((s) => s.name).sort().join(',') }; });
  lib.report('restoring a sub-area of an archived area restores the area too (last in order, sub-areas intact)', rest.area && rest.last && rest.subs === 'Songs,Technique', JSON.stringify(rest));

  // ---- Cleanup: a range inside one interval leaves both ends; Deleted time ----
  await reset();
  await call(async ({ A, arg }) => A.deleteTimeBetween(Date.parse(arg.s), Date.parse(arg.e)), { s: new Date(Date.parse(at(9.75))).toISOString(), e: new Date(Date.parse(at(9.25))).toISOString() });
  const pieces = await lib.read(p, ({ intervals }) => intervals.filter((i) => i.areaId === intervals.find((x) => x.id === 'g1').areaId && i.subAreaId === intervals.find((x) => x.id === 'g1').subAreaId).map((i) => (Date.parse(i.end) - Date.parse(i.start)) / 60000).sort());
  lib.report('deleting a range inside an interval keeps both ends (15 + 15 min)', JSON.stringify(pieces) === '[15,15]', JSON.stringify(pieces));
  await reset();
  await del({ area: 'Music' }, { kind: 'deleted' }); await del({ area: 'Guitar', sub: 'Songs' }, { kind: 'deleted' });
  await call(async ({ A }) => A.deleteDeletedTime());
  lib.report('“time kept as Deleted” removes the Deleted area’s and Deleted sub-areas’ time only', (await labels()) === 'g2:Guitar·Technique g3:Guitar', await labels());

  // ---- Backups keep and validate the flags ----
  await reset();
  await del({ area: 'Music' }, { kind: 'deleted' });
  await call(async ({ A, area }) => A.archive({ kind: 'area', id: (await area('Reading')).id }));
  const bk = await p.evaluate(async () => {
    const D = await import('/src/db.ts'); const B = await import('/src/backup.ts');
    const data = await D.exportAll();
    const parsed = B.parseBackup(JSON.stringify(data));
    await D.importAll(parsed);
    const areas = await D.db.areas.toArray();
    let bad = '';
    try { B.parseBackup(JSON.stringify({ ...data, areas: data.areas.map((a, i) => (i ? a : { ...a, system: 'nope' })) })); } catch (e) { bad = e.message; }
    return { deleted: areas.some((a) => a.system === 'deleted' && a.archived), reading: areas.find((a) => a.name === 'Reading').archived, bad };
  });
  lib.report('backup round trip keeps “Deleted” and archived flags', bk.deleted && bk.reading === true, JSON.stringify(bk));
  lib.report('…and rejects an invalid flag', /invalid archived\/system flag/.test(bk.bad), bk.bad);

  // ---- UI: “Deleted” is never offered; reports show it ----
  await p.reload(); await p.waitForSelector('.area-pill-btn'); await p.waitForTimeout(600);
  const pillNames = () => p.locator('.timer-layout .area-pill-btn').evaluateAll((es) => es.map((e) => e.getAttribute('aria-label')));
  lib.report('Timer: “Deleted” and archived areas aren’t offered', !(await pillNames()).includes('Deleted') && !(await pillNames()).includes('Reading'));
  await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(800);
  const settingsNames = await p.locator('ion-reorder-group ion-item h3').allInnerTexts();
  lib.report('Settings area list: no “Deleted”, no archived', !settingsNames.includes('Deleted') && !settingsNames.includes('Reading'), settingsNames.join(','));
  await p.locator('ion-item', { hasText: 'Running time' }).click(); await p.waitForTimeout(700);
  lib.report('Running time dialog: no “Deleted”', !(await p.locator('ion-modal').last().innerText()).includes('Deleted'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  await p.locator('ion-item.archived-entry').click(); await p.waitForTimeout(700);
  lib.report('Archived page: Reading listed, “Deleted” not', (await p.locator('ion-modal .archived-row h3').allInnerTexts()).join(',') === 'Reading', (await p.locator('ion-modal .archived-row h3').allInnerTexts()).join(','));
  await p.locator('ion-modal .archived-row .more-button').click(); await p.waitForTimeout(300);
  await p.locator('ion-action-sheet button', { hasText: 'Delete permanently' }).click(); await p.waitForTimeout(600);
  await p.locator('ion-modal.delete-sheet ion-radio', { hasText: 'another area' }).click(); await p.waitForTimeout(300);
  const mergeNames = await p.locator('ion-modal.delete-sheet .area-pill-btn').evaluateAll((es) => es.map((e) => e.getAttribute('aria-label')));
  lib.report('merge picker: no “Deleted”, not Reading itself', !mergeNames.includes('Deleted') && !mergeNames.includes('Reading') && mergeNames.length > 5, mergeNames.join(','));
  lib.report('…“Delete permanently” waits until a target is picked', await p.locator('ion-modal.delete-sheet .sheet-apply').evaluate((e) => e.disabled));
  await p.keyboard.press('Escape'); await p.waitForTimeout(500); await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  await p.locator('ion-tab-button[tab="reports"]').click(); await p.waitForTimeout(1200);
  const reportRows = await p.locator('.ion-page:not(.ion-page-hidden) .name').allInnerTexts();
  lib.report('Reports list the time kept as “Deleted” as its own row', reportRows.includes('Deleted'), reportRows.join(','));

  // ---- UI: archive the running area with “Stop the timer, then archive” ----
  await p.locator('ion-tab-button[tab="timer"]').click(); await p.waitForTimeout(500);
  await p.locator('.timer-layout .area-pill-btn[aria-label="Hobby"]').click(); await p.waitForTimeout(400);
  await p.evaluate(async () => { const db = (await import('/src/db.ts')).db; const a = await db.active.get('current'); await db.active.put({ ...a, start: new Date(Date.now() - 600_000).toISOString() }); });
  await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(700);
  await p.locator('ion-reorder-group ion-item', { has: p.locator('h3', { hasText: /^Hobby$/ }) }).click(); await p.waitForTimeout(600);
  await p.locator('ion-modal ion-button', { hasText: 'Archive area' }).click(); await p.waitForTimeout(400);
  await p.locator('ion-action-sheet button', { hasText: 'Stop the timer, then archive' }).click(); await p.waitForTimeout(800);
  const hobby = await lib.read(p, ({ areas, intervals, active }) => { const h = areas.find((a) => a.name === 'Hobby'); return { archived: h.archived, saved: intervals.some((i) => i.areaId === h.id), active: !!active }; });
  lib.report('“Stop the timer, then archive”: stopped (10 min saved), then archived', hobby.archived && hobby.saved && !hobby.active, JSON.stringify(hobby));

  // ---- UI: a new sub-area named like an archived one brings it back (same id) ----
  const songsId = await call(async ({ A, area, sub }) => { const s = await sub(await area('Guitar'), 'Songs'); await A.archive({ kind: 'sub', id: s.id }); return s.id; });
  await p.locator('ion-reorder-group ion-item', { has: p.locator('h3', { hasText: /^Guitar$/ }) }).click(); await p.waitForTimeout(600);
  await p.locator('ion-modal ion-item', { hasText: 'Add sub-area' }).click(); await p.waitForTimeout(300);
  await p.locator('ion-modal ion-item:has(ion-button.sub-archive) input').last().fill('songs'); await p.waitForTimeout(200);
  await p.locator('ion-modal ion-button', { hasText: 'Save' }).click(); await p.waitForTimeout(700);
  const songs = await lib.read(p, ({ subs }) => subs.filter((s) => s.name.toLowerCase() === 'songs').map((s) => `${s.id}:${!!s.archived}`));
  lib.report('new sub-area “songs” restores the archived Songs (no duplicate)', songs.length === 1 && songs[0] === `${songsId}:false`, JSON.stringify(songs));

  // ---- UI: cleanup dialog edge cases ----
  await p.locator('ion-item', { hasText: 'Delete tracked time…' }).click(); await p.waitForSelector('ion-modal.cleanup-sheet .sheet-title'); await p.waitForTimeout(500);
  lib.report('“Time kept as Deleted” offered only when there is some', (await p.locator('ion-modal.cleanup-sheet ion-radio', { hasText: 'Time kept as' }).count()) === 1);
  await p.locator('ion-modal.cleanup-sheet .cleanup-dates input').first().fill('2020-01-01'); await p.waitForTimeout(400);
  lib.report('nothing in range: “Nothing to delete”, button disabled', /Nothing to delete/.test(await p.locator('ion-modal.cleanup-sheet .cleanup-summary').innerText()) && (await p.locator('ion-modal.cleanup-sheet .sheet-apply').evaluate((e) => e.disabled)));
  await p.locator('ion-modal.cleanup-sheet ion-radio', { hasText: 'From one day to another' }).click(); await p.waitForTimeout(300);
  const dates = p.locator('ion-modal.cleanup-sheet ion-input');
  await dates.nth(0).locator('input:not(.cloned-input)').fill('2026-11-20'); await dates.nth(1).locator('input:not(.cloned-input)').fill('2026-11-10'); await p.waitForTimeout(400);
  lib.report('first day after the last: says so, button disabled', /first day is after the last/.test(await p.locator('ion-modal.cleanup-sheet .cleanup-summary').innerText()) && (await p.locator('ion-modal.cleanup-sheet .sheet-apply').evaluate((e) => e.disabled)));

  lib.report('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
