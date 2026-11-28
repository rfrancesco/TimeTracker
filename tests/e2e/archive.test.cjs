const lib = require('./lib.cjs');
// Archiving instead of deleting: archive/restore areas and sub-areas (also while they
// run), the Archived page, permanent deletion with its destinations (Deleted, plain,
// merge, drop), restore-on-recreate, archived items in the editor, and cleanup.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome', colorScheme: process.env.SCHEME || 'dark' })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-16T18:00:00+01:00') });
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  const Z = (d, h) => new Date(`2026-11-${d}T${h}:00+01:00`).toISOString();
  await lib.seed(p, { intervals: [
    { id: 'w2', area: 'Work', start: Z(13, '09:00'), end: Z(13, '10:00') },
    { id: 'w1', area: 'Work', start: Z(14, '22:00'), end: Z(15, '02:00') },
    { id: 'g1', area: 'Guitar', sub: 'Songs', start: Z(16, '09:00'), end: Z(16, '10:00') },
    { id: 'r1', area: 'Reading', start: Z(16, '10:00'), end: Z(16, '11:00') },
    { id: 'h1', area: 'Home', sub: 'Cooking', start: Z(16, '11:00'), end: Z(16, '11:30') },
    { id: 'c1', area: 'Cinema', start: Z(16, '12:00'), end: Z(16, '13:00') },
  ] });
  await p.reload(); await p.waitForSelector('.area-pill-btn'); await p.waitForTimeout(400);

  const S = (sel) => p.locator(sel);
  const pills = () => p.locator('.timer-layout .area-pill-btn').evaluateAll((es) => es.map((e) => e.getAttribute('aria-label')));
  const tab = async (t) => { await p.locator(`ion-tab-button[tab="${t}"]`).click(); await p.waitForTimeout(700); };
  const areaItem = (name) => p.locator('ion-reorder-group ion-item', { has: p.locator('h3', { hasText: new RegExp(`^${name}$`) }) });
  const openArea = async (name) => { await areaItem(name).click(); await p.waitForSelector('ion-modal ion-title:has-text("Edit area")'); await p.waitForTimeout(400); };
  const alertBtn = async (text) => { await p.locator('ion-alert button', { hasText: text }).click(); await p.waitForTimeout(500); };
  const sheetBtn = async (text) => { await p.locator('ion-action-sheet button', { hasText: text }).click(); await p.waitForTimeout(500); };
  const archiveArea = async (name) => { await openArea(name); await p.locator('ion-modal ion-button', { hasText: 'Archive area' }).click(); await p.waitForTimeout(400); };
  const archivedRow = () => p.locator('ion-item.archived-entry');
  const openArchived = async () => { await archivedRow().click(); await p.waitForSelector('ion-modal ion-title:has-text("Archived")'); await p.waitForTimeout(400); };
  const closeTop = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(500); };
  const row = (name) => p.locator('ion-modal .archived-row', { has: p.locator('h3', { hasText: new RegExp(`^${name}$`) }) });
  const area = (name) => lib.read(p, ({ areas, arg }) => areas.find((a) => a.name === arg) ?? null, name);
  const labels = () => lib.read(p, ({ areas, subs, intervals }) => Object.fromEntries(intervals.map((i) => [i.id, areas.find((a) => a.id === i.areaId)?.name + (i.subAreaId ? ' · ' + subs.find((s) => s.id === i.subAreaId)?.name : '')])));
  const deletePermanently = async (name, option, merge) => {
    await row(name).locator('ion-button.more-button').click(); await p.waitForTimeout(300);
    await sheetBtn('Delete permanently');
    await p.waitForSelector('ion-modal.delete-sheet .sheet-title'); await p.waitForTimeout(500);
    if (option) { await p.locator('ion-modal.delete-sheet ion-radio', { hasText: option }).click(); await p.waitForTimeout(300); }
    if (merge) { await p.locator(`ion-modal.delete-sheet .area-pill-btn[aria-label="${merge}"]`).click(); await p.waitForTimeout(300); }
  };
  const archiveSub = async (sub) => {
    const items = p.locator('ion-modal ion-item:has(ion-button.sub-archive)');
    const i = await items.evaluateAll((es, n) => es.findIndex((e) => (e.querySelector('ion-input')?.value ?? e.querySelector('input')?.value) === n), sub);
    await items.nth(i).locator('ion-button.sub-archive').click(); await p.waitForTimeout(400);
  };
  const confirmDelete = async () => { await p.locator('ion-modal.delete-sheet .sheet-apply').click(); await p.waitForTimeout(800); };

  // 1. Archive an area that isn't running.
  await tab('settings');
  lib.report('no “Archived” row while nothing is archived', (await archivedRow().count()) === 0);
  await archiveArea('Reading'); await alertBtn('Archive');
  lib.report('Reading archived: off the area list, “Archived · 1” shown', (await areaItem('Reading').count()) === 0 && (await archivedRow().innerText()).includes('1'));
  lib.report('…its time is kept', (await labels()).r1 === 'Reading');
  await tab('timer');
  lib.report('…and it’s gone from the timer', !(await pills()).includes('Reading'));
  await tab('settings'); await openArchived();
  lib.report('Archived page lists it with its time', /1h 00m tracked/.test(await row('Reading').innerText()), await row('Reading').innerText());
  await p.screenshot({ path: `${lib.OUT}/archived-page.png` });
  await row('Reading').locator('ion-button', { hasText: 'Restore' }).click(); await p.waitForTimeout(500);
  lib.report('Restore brings it back (last in the order)', !(await area('Reading')).archived && (await area('Reading')).order >= Math.max(...(await lib.read(p, ({ areas }) => areas.map((a) => a.order)))));
  await closeTop();
  lib.report('…and the Archived row disappears', (await archivedRow().count()) === 0);

  // 2. Running Guitar · Songs: archive Songs, keep it until the switch.
  await tab('timer'); await S('.timer-layout .area-pill-btn[aria-label="Guitar"]').click(); await p.waitForTimeout(400);
  await p.locator('.timer-layout .sub-chips ion-chip', { hasText: /^Songs$/ }).click(); await p.waitForTimeout(400);
  await tab('settings'); await openArea('Guitar');
  await archiveSub('Songs');
  lib.report('archiving the running sub-area asks what the timer does', (await p.locator('ion-action-sheet').innerText()).includes('Songs is running'));
  await sheetBtn('keep Songs until I switch');
  await p.locator('ion-modal ion-button', { hasText: 'Save' }).click(); await p.waitForTimeout(600);
  lib.report('…kept: the timer still runs as Guitar · Songs', (await lib.timeline(p)).includes('▶ Guitar · Songs'), await lib.timeline(p));
  await tab('timer');
  const songs = p.locator('.timer-layout .sub-chips ion-chip', { hasText: /^Songs$/ });
  lib.report('…and the Timer still shows Songs (greyed, selected)', (await songs.count()) === 1 && (await songs.evaluate((e) => e.classList.contains('archived') && e.classList.contains('selected'))));
  // Restore Songs, then archive it detaching the timer.
  await tab('settings'); await openArchived(); await row('Guitar · Songs').locator('ion-button', { hasText: 'Restore' }).click(); await p.waitForTimeout(400); await closeTop();
  await openArea('Guitar');
  await archiveSub('Songs');
  await sheetBtn('continues as Guitar');
  await p.locator('ion-modal ion-button', { hasText: 'Save' }).click(); await p.waitForTimeout(600);
  lib.report('…or: the timer continues as Guitar (same start)', /▶ Guitar since 18:00$/.test(await lib.timeline(p)), await lib.timeline(p));

  // 3. Archive the running area, keep tracking.
  await archiveArea('Guitar');
  lib.report('archiving the running area asks', (await p.locator('ion-action-sheet').innerText()).includes('Guitar is running'));
  await sheetBtn('keep tracking');
  await tab('timer');
  lib.report('…kept running, still selected in the pill', (await lib.timeline(p)).includes('▶ Guitar') && (await S('.timer-layout .area-pill-btn[aria-label="Guitar"].selected.archived').count()) === 1);
  await p.screenshot({ path: `${lib.OUT}/archived-running.png` });

  // 4. Editor: an old interval of an archived area shows it (greyed, selected).
  await tab('day');
  const g1 = p.locator('.day-block', { hasText: 'Guitar' }).first();
  await g1.click(); await p.waitForTimeout(300); await g1.click(); await p.waitForSelector('ion-modal ion-title:has-text("Edit interval")'); await p.waitForTimeout(400);
  lib.report('editor: the archived area is shown selected', (await p.locator('ion-modal .area-pill-btn[aria-label="Guitar"].selected.archived').count()) === 1);
  lib.report('…and its archived sub-area too', (await p.locator('ion-modal .sub-chips ion-chip.archived', { hasText: 'Songs' }).count()) === 1);
  await closeTop();

  // 5. Permanent deletion of the running area, merged into Music: the timer is relabelled.
  await tab('settings'); await openArchived();
  await deletePermanently('Guitar', 'another area', 'Music');
  lib.report('dialog says the running timer continues as Music', /continues as Music/.test(await p.locator('ion-modal.delete-sheet').innerText()));
  await p.screenshot({ path: `${lib.OUT}/delete-dialog.png` });
  await confirmDelete();
  lib.report('Guitar merged into Music: its interval and the running timer are Music', (await labels()).g1 === 'Music' && (await lib.timeline(p)).includes('▶ Music') && !(await area('Guitar')), JSON.stringify(await labels()));
  await closeTop();
  await tab('timer');
  lib.report('undo history is cleared after a permanent deletion', (await S('.undo-button.show').count()) === 0);

  // 6. Default: keep the time as “Deleted”.
  await tab('settings'); await archiveArea('Reading'); await alertBtn('Archive');
  await openArchived(); await deletePermanently('Reading'); await confirmDelete();
  lib.report('Reading → its time kept as “Deleted” (built-in, hidden)', (await labels()).r1 === 'Deleted' && (await area('Deleted')).system === 'deleted' && (await area('Deleted')).archived);
  lib.report('“Deleted” isn’t listed on the Archived page', (await row('Deleted').count()) === 0);
  await closeTop();

  // 7. Sub-area: keep the time in its area without a sub-area.
  await openArea('Home');
  await archiveSub('Cooking');
  await p.locator('ion-modal ion-button', { hasText: 'Save' }).click(); await p.waitForTimeout(600);
  await openArchived(); await deletePermanently('Home · Cooking', 'without a sub-area'); await confirmDelete();
  lib.report('Home · Cooking → plain Home', (await labels()).h1 === 'Home', (await labels()).h1);
  await closeTop();

  // 8. Delete the time too.
  await archiveArea('Cinema'); await alertBtn('Archive');
  await openArchived(); await deletePermanently('Cinema', 'Delete the time too'); await confirmDelete();
  lib.report('Cinema and its time deleted', !(await labels()).c1 && !(await area('Cinema')));
  await closeTop();

  // 9. A new area named like an archived one offers to restore it.
  await archiveArea('Friends'); await alertBtn('Archive');
  await p.locator('ion-item', { hasText: 'Add area' }).click(); await p.waitForSelector('ion-modal ion-title:has-text("New area")'); await p.waitForTimeout(400);
  await p.locator('ion-modal input').first().fill('friends'); await p.waitForTimeout(200);
  await p.locator('ion-modal ion-button', { hasText: 'Save' }).click(); await p.waitForTimeout(500);
  lib.report('new “friends” → “Friends is archived” prompt', (await p.locator('ion-alert').innerText()).includes('is archived'));
  await alertBtn('Restore');
  lib.report('…Restore: the archived one is back, no duplicate', !(await area('Friends')).archived && (await lib.read(p, ({ areas }) => areas.filter((a) => a.name.toLowerCase() === 'friends').length)) === 1);

  // 10. Cleanup: a range of days (crossing intervals are cut), then the "Deleted" time.
  await p.locator('ion-item', { hasText: 'Delete tracked time…' }).click(); await p.waitForSelector('ion-modal.cleanup-sheet .sheet-title'); await p.waitForTimeout(500);
  await p.locator('ion-modal.cleanup-sheet ion-radio', { hasText: 'From one day to another' }).click(); await p.waitForTimeout(300);
  const dates = p.locator('ion-modal.cleanup-sheet ion-input'); await dates.nth(0).locator('input:not(.cloned-input)').fill('2026-11-14'); await p.waitForTimeout(200); await dates.nth(1).locator('input:not(.cloned-input)').fill('2026-11-14'); await p.waitForTimeout(500);
  lib.report('cleanup preview: the part of Work on the 14th (2h)', /1 interval · 2h 00m/.test(await p.locator('ion-modal.cleanup-sheet .cleanup-summary').innerText()), await p.locator('ion-modal.cleanup-sheet .cleanup-summary').innerText());
  await p.screenshot({ path: `${lib.OUT}/cleanup.png` });
  await p.locator('ion-modal.cleanup-sheet .sheet-apply').click(); await p.waitForTimeout(800);
  const w1 = await lib.read(p, ({ intervals }) => intervals.find((i) => i.id === 'w1'));
  lib.report('…Work 22:00–02:00 cut to 00:00–02:00 on the 15th', w1 && w1.start === Z(15, '00:00') && w1.end === Z(15, '02:00'), JSON.stringify(w1));
  await p.locator('ion-item', { hasText: 'Delete tracked time…' }).click(); await p.waitForSelector('ion-modal.cleanup-sheet .sheet-title'); await p.waitForTimeout(500);
  await p.locator('ion-modal.cleanup-sheet .cleanup-dates input').first().fill('2026-11-14'); await p.waitForTimeout(400);
  await p.locator('ion-modal.cleanup-sheet .sheet-apply').click(); await p.waitForTimeout(800);
  lib.report('“before the 14th” removes Work on the 13th only', !(await labels()).w2 && !!(await labels()).w1);
  await p.locator('ion-item', { hasText: 'Delete tracked time…' }).click(); await p.waitForSelector('ion-modal.cleanup-sheet .sheet-title'); await p.waitForTimeout(500);
  await p.locator('ion-modal.cleanup-sheet ion-radio', { hasText: 'Time kept as' }).click(); await p.waitForTimeout(400);
  await p.locator('ion-modal.cleanup-sheet .sheet-apply').click(); await p.waitForTimeout(800);
  lib.report('“Time kept as Deleted” removes Reading’s old time', !(await labels()).r1 && !!(await labels()).g1, JSON.stringify(await labels()));
  lib.report('the running timer was never touched', (await lib.timeline(p)).includes('▶ Music'), await lib.timeline(p));

  lib.report('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
