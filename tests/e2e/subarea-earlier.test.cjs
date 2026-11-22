const lib = require('./lib.cjs');
// Sub-areas in "earlier": the start/switch sheet shows the target area's sub-areas, the
// running area's sheet can relabel the whole timer, and holding a sub-area chip opens
// "When did you switch to <sub-area>?" with "From the start".
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome', colorScheme: process.env.SCHEME || 'dark' })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-16T18:35:00+01:00') });
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  await p.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction(['areas', 'intervals'], 'readwrite'); t.objectStore('areas').getAll().onsuccess = (e) => { const th = e.target.result.find((a) => a.name === 'Thesis'); t.objectStore('intervals').put({ id: 'th', areaId: th.id, subAreaId: null, start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:30:00.000Z', updatedAt: 'x' }); }; t.oncomplete = r; }; }));
  await p.reload(); await p.waitForSelector('.area-pill-btn'); await p.waitForTimeout(500);

  const db = () => p.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction(['intervals', 'active', 'areas', 'subAreas']); t.objectStore('areas').getAll().onsuccess = (e0) => { const n = Object.fromEntries(e0.target.result.map((a) => [a.id, a.name])); t.objectStore('subAreas').getAll().onsuccess = (e1) => { const sn = Object.fromEntries(e1.target.result.map((s) => [s.id, s.name])); const lab = (x) => n[x.areaId] + (x.subAreaId ? ' · ' + sn[x.subAreaId] : ''); t.objectStore('intervals').getAll().onsuccess = (e) => { t.objectStore('active').get('current').onsuccess = (e2) => { const f = (s) => new Date(s).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }); const a = e2.target.result; r(`[${e.target.result.sort((x, y) => x.start.localeCompare(y.start)).map((i) => lab(i) + ' ' + f(i.start) + '–' + f(i.end)).join(', ')}] ${a ? '▶ ' + lab(a) + ' since ' + f(a.start) : 'idle'}`); }; }; }; }; }; }));
  const pill = (name) => p.locator(`.timer-layout .area-pill-btn[aria-label="${name}"]`);
  const subChip = (name) => p.locator('.timer-layout .sub-chips ion-chip', { hasText: new RegExp(`^${name}$`) });
  const hold = async (loc, ms = 800) => { const r = await loc.boundingBox(); await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up(); await p.waitForTimeout(400); };
  const sheet = 'ion-modal.stop-sheet';
  const title = () => p.locator(`${sheet} .sheet-title`).innerText();
  const chip = (label) => p.locator(`${sheet} .sheet-times ion-chip`, { hasText: new RegExp(`^${label}$`) });
  const sheetSub = (label) => p.locator(`${sheet} .sub-chips ion-chip`, { hasText: new RegExp(`^${label}$`) });
  const sheetSubs = () => p.locator(`${sheet} .sub-chips ion-chip`).evaluateAll((es) => es.map((e) => e.innerText + (e.classList.contains('selected') ? '*' : '')).join(' '));
  const apply = p.locator(`${sheet} .sheet-apply`);
  const applyText = () => apply.innerText();
  const hint = () => p.locator(`${sheet} .sheet-hint`).innerText();
  const open = () => p.waitForSelector(`${sheet} .sheet-title`);
  const done = async () => { await apply.click(); await p.waitForSelector(`${sheet} .sheet-title`, { state: 'detached' }); await p.waitForTimeout(500); };
  const undo = async () => { await p.locator('.undo-button').click(); await p.waitForTimeout(500); };
  const BASE = '[Thesis 16:00–17:30]';

  // A. Idle: start earlier with a sub-area, in one step.
  await hold(pill('Guitar')); await open();
  lib.report('idle “When did you start?” shows Guitar’s sub-areas (None selected)', (await sheetSubs()) === 'None* Technique Songs', await sheetSubs());
  await sheetSub('Songs').click(); await chip('After Thesis').click(); await p.waitForTimeout(200);
  lib.report('…picking Songs names it in the header and the hint', /Guitar · Songs/.test(await p.locator(`${sheet} .sheet-running`).innerText()) && /Tracks Guitar · Songs since (17:30|05:30 PM)/.test(await hint()), await hint());
  await done();
  lib.report('→ Guitar · Songs since 17:30', (await db()) === `${BASE} ▶ Guitar · Songs since 17:30`, await db());
  await undo();
  lib.report('(undo → idle)', (await db()) === `${BASE} idle`, await db());
  // Areas without sub-areas: no row.
  await hold(pill('Reading')); await open();
  lib.report('an area without sub-areas has no sub-area row', (await p.locator(`${sheet} .sub-chips`).count()) === 0);
  await p.keyboard.press('Escape'); await p.waitForTimeout(600);

  // Running Guitar (no sub-area) since 18:05 for the rest.
  await hold(pill('Guitar')); await open(); await chip('30 min ago').click(); await done();
  lib.report('(Guitar since 18:05)', (await db()) === `${BASE} ▶ Guitar since 18:05`, await db());

  // A'. Hold the running area: change only the sub-area → the whole timer is relabelled.
  await hold(pill('Guitar')); await open();
  lib.report('running area: its sub-areas, the current one (None) selected', (await sheetSubs()) === 'None* Technique Songs', await sheetSubs());
  await p.locator(`${sheet} .time-input input`).fill('18:05'); await p.waitForTimeout(200);
  lib.report('…same start and same sub-area: nothing to apply', await apply.evaluate((e) => e.disabled));
  await sheetSub('Technique').click(); await p.waitForTimeout(200);
  lib.report('…only the sub-area changed: “Technique since 18:05”, whole timer', /Technique since (18:05|06:05 PM)/i.test(await applyText()) && /whole timer becomes Guitar · Technique/.test(await hint()) && !(await apply.evaluate((e) => e.disabled)), `${await applyText()} | ${await hint()}`);
  await done();
  lib.report('→ Guitar · Technique since 18:05, nothing saved', (await db()) === `${BASE} ▶ Guitar · Technique since 18:05`, await db());
  await undo();
  // …and with an earlier start too.
  await hold(pill('Guitar')); await open(); await sheetSub('Songs').click(); await chip('15 min earlier').click(); await done();
  lib.report('running area: earlier start + sub-area together → Guitar · Songs since 17:50', (await db()) === `${BASE} ▶ Guitar · Songs since 17:50`, await db());
  await undo();
  lib.report('(undo → Guitar since 18:05)', (await db()) === `${BASE} ▶ Guitar since 18:05`, await db());

  // B. Hold a sub-area chip.
  {
    const r = await subChip('Songs').boundingBox(); await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await p.mouse.down(); await p.waitForTimeout(320);
    await p.clock.pauseAt(new Date((await p.evaluate(() => Date.now())) + 20));
    const ind = await p.locator('.stop-button').innerText();
    await p.screenshot({ path: `${lib.OUT}/subarea-hold.png` });
    lib.report('holding a sub-area chip: the Stop slot says “Switch earlier”', /Switch earlier/i.test(ind), ind);
    await p.mouse.up(); await p.clock.resume(); await p.waitForTimeout(400);
    lib.report('…released early: nothing changes, no sheet', (await db()) === `${BASE} ▶ Guitar since 18:05` && (await p.locator(`${sheet} .sheet-title`).count()) === 0, await db());
  }
  await hold(subChip('Songs')); await open();
  const bChips = await p.locator(`${sheet} .sheet-times ion-chip`).evaluateAll((es) => es.map((e) => e.innerText + (e.getAttribute('outline') === 'false' || e.outline === false ? '*' : '')).join('|'));
  await p.waitForTimeout(300); await p.screenshot({ path: `${lib.OUT}/subarea-sheet.png` });
  lib.report('sheet: “When did you switch to Songs?”, “From the start” first and selected, no sub-area row', (await title()) === 'When did you switch to Songs?' && bChips.startsWith('From the start*|5 min ago') && (await p.locator(`${sheet} .sub-chips`).count()) === 0, `${await title()} | ${bChips}`);
  lib.report('…“Songs since 18:05”, the whole timer', /Songs since (18:05|06:05 PM)/i.test(await applyText()) && /whole timer becomes Guitar · Songs/.test(await hint()), `${await applyText()} | ${await hint()}`);
  await done();
  lib.report('From the start → Guitar · Songs since 18:05, nothing saved', (await db()) === `${BASE} ▶ Guitar · Songs since 18:05`, await db());
  await undo();
  await hold(subChip('Songs')); await open(); await chip('15 min ago').click(); await p.waitForTimeout(200);
  lib.report('“15 min ago”: saves Guitar until then, Guitar · Songs after', /Saves Guitar (18:05|06:05 PM)–(18:20|06:20 PM), then Guitar · Songs since (18:20|06:20 PM)/.test(await hint()), await hint());
  await done();
  lib.report('→ [Guitar 18:05–18:20] ▶ Guitar · Songs since 18:20', (await db()) === `[Thesis 16:00–17:30, Guitar 18:05–18:20] ▶ Guitar · Songs since 18:20`, await db());
  await undo();

  // Holding the current sub-area does nothing; a tap still switches from now.
  await hold(subChip('None'));
  lib.report('holding the current sub-area opens nothing and changes nothing', (await p.locator(`${sheet} .sheet-title`).count()) === 0 && (await db()) === `${BASE} ▶ Guitar since 18:05`, await db());
  await subChip('Technique').click(); await p.waitForTimeout(500);
  lib.report('a tap on a sub-area still switches from now', (await db()) === `[Thesis 16:00–17:30, Guitar 18:05–18:35] ▶ Guitar · Technique since 18:35`, await db());
  await undo();

  // Switch earlier to another area with sub-areas.
  await hold(pill('Home')); await open();
  lib.report('switch to Home: Home’s sub-areas', (await sheetSubs()) === 'None* Cleaning Cooking Laundry Shower', await sheetSubs());
  await sheetSub('Cooking').click(); await chip('15 min ago').click(); await done();
  lib.report('→ [Guitar 18:05–18:20] ▶ Home · Cooking since 18:20', (await db()) === `[Thesis 16:00–17:30, Guitar 18:05–18:20] ▶ Home · Cooking since 18:20`, await db());

  lib.report('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
