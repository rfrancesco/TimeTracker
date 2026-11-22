const lib = require('./lib.cjs');
// Day view: dragging is deliberate (hold to lift), and every edit (drag, editor save,
// delete) offers a one-step Undo in a snackbar, valid until the view is left.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome', colorScheme: process.env.SCHEME || 'dark' })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-16T18:00:00+01:00') });
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  await lib.seed(p, { intervals: [{ id: 'w', area: 'Work', start: '2026-11-16T08:00:00.000Z', end: '2026-11-16T11:00:00.000Z' }, { id: 'r', area: 'Reading', start: '2026-11-16T13:00:00.000Z', end: '2026-11-16T14:00:00.000Z' }] });
  await p.reload(); await p.waitForSelector('.area-pill-btn');
  await p.evaluate(() => { window.__toasts = []; document.addEventListener('ionToastWillPresent', (e) => window.__toasts.push(e.target.message)); });
  await p.locator('ion-tab-button[tab="day"]').click(); await p.waitForTimeout(800);

  const db = async () => (await lib.timeline(p)).replace(/^\[(.*)\] idle$/, '$1');
  const toasts = () => p.evaluate(() => window.__toasts.slice());
  const lastToast = async () => (await toasts()).at(-1);
  const block = (name) => p.locator('.day-block', { hasText: name });
  const centre = async (loc) => { const r = await loc.boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
  const undoBtn = () => p.locator('ion-toast.edit-undo-toast').last().locator('button', { hasText: /undo/i });
  const START = 'Work 09:00–12:00, Reading 14:00–15:00';
  lib.report('seed', (await db()) === START, await db());

  // Select Reading (first tap).
  await block('Reading').click(); await p.waitForTimeout(300);
  lib.report('a tap selects the block', (await p.locator('.day-block.selected', { hasText: 'Reading' }).count()) === 1);

  // 1. Press and move right away = a scroll, not a drag.
  let [x, y] = await centre(block('Reading'));
  await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x, y - 150, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(400);
  lib.report('press-and-move without a hold doesn’t move the block', (await db()) === START, await db());

  // 2. Hold, then move: the block lifts and follows.
  [x, y] = await centre(block('Reading'));
  await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(450);
  const liftedClass = await block('Reading').evaluate((e) => e.classList.contains('lifted'));
  const px = await p.evaluate(() => { const g = document.querySelector('.day-view'); return parseFloat(g.style.height) / (24 * 60); });
  await p.mouse.move(x, y - 60 * px, { steps: 10 }); await p.mouse.up(); await p.waitForTimeout(700);
  lib.report('holding lifts the block', liftedClass);
  lib.report('…then it follows the finger (moved one hour earlier)', (await db()) === 'Work 09:00–12:00, Reading 13:00–14:00', await db());
  lib.report('…and a snackbar offers Undo (“Moved Reading”)', (await lastToast()) === 'Moved Reading' && (await undoBtn().count()) === 1, await lastToast());
  const fabUp = await p.evaluate(() => document.body.classList.contains('snackbar-up') && getComputedStyle(document.querySelector('ion-fab')).transform !== 'none');
  lib.report('the + button moves above the snackbar', fabUp);
  await undoBtn().click(); await p.waitForTimeout(700);
  lib.report('Undo puts it back', (await db()) === START, await db());

  // 3. Hold released in place: nothing happens (no move, no editor).
  [x, y] = await centre(block('Reading'));
  await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(450); await p.mouse.up(); await p.waitForTimeout(500);
  lib.report('a hold released in place changes nothing and opens nothing', (await db()) === START && (await p.locator('ion-modal ion-title', { hasText: 'Edit interval' }).count()) === 0);

  // 4. A quick tap on the selected block opens the editor; delete → Undo brings it back.
  await block('Reading').click(); await p.waitForSelector('ion-modal ion-title'); await p.waitForTimeout(400);
  lib.report('a tap on the selected block opens the editor', (await p.locator('ion-modal ion-title').innerText()) === 'Edit interval');
  await p.locator('ion-modal ion-button', { hasText: /delete interval/i }).click(); await p.waitForTimeout(300);
  await p.locator('ion-alert button', { hasText: 'Delete' }).click(); await p.waitForTimeout(800);
  lib.report('delete → “Deleted Reading” with Undo', (await db()) === 'Work 09:00–12:00' && (await lastToast()) === 'Deleted Reading', `${await db()} | ${await lastToast()}`);
  await undoBtn().click(); await p.waitForTimeout(700);
  lib.report('Undo restores the deleted interval', (await db()) === START, await db());

  // 5. Editor save → Undo.
  await block('Work').click(); await p.waitForTimeout(300); await block('Work').click(); await p.waitForSelector('ion-modal ion-title'); await p.waitForTimeout(400);
  await p.locator('ion-modal input[aria-label="End time"]').fill('11:00'); await p.waitForTimeout(200);
  await p.locator('ion-modal ion-button', { hasText: /save/i }).click(); await p.waitForTimeout(800);
  lib.report('editor save → “Saved Work” with Undo', (await db()) === 'Work 09:00–11:00, Reading 14:00–15:00' && (await lastToast()) === 'Saved Work', `${await db()} | ${await lastToast()}`);
  await undoBtn().click(); await p.waitForTimeout(700);
  lib.report('Undo restores the old times', (await db()) === START, await db());

  // 6. Undo refuses if things changed in between.
  await block('Reading').click(); await p.waitForTimeout(300);
  [x, y] = await centre(block('Reading'));
  await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(450); await p.mouse.move(x, y + 30 * px, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(700);
  const moved = await db();
  await lib.patchInterval(p, 'r', { note: 'edited elsewhere' });
  await undoBtn().click(); await p.waitForTimeout(700);
  lib.report('Undo refuses when the data changed since, and changes nothing', (await db()) === moved && /Can’t undo/.test(await lastToast()), `${moved} | ${await lastToast()}`);

  // Real touch input: a finger scrolling across the selected block scrolls the page;
  // a held finger lifts the block and the page doesn't scroll.
  const cdp = await p.context().newCDPSession(p);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y })) });
  const scrollTop = () => p.evaluate(async () => { const c = [...document.querySelectorAll('ion-content')].find((x) => x.closest('.ion-page:not(.ion-page-hidden)') && x.querySelector('.day-view')); return (await c.getScrollElement()).scrollTop; });
  const beforeTouch = await db(); const st0 = await scrollTop();
  [x, y] = await centre(block('Reading'));
  await touch('touchStart', [[x, y]]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[x, y - i * 20]]); await p.waitForTimeout(16); }
  await touch('touchEnd', []); await p.waitForTimeout(700);
  const st1 = await scrollTop();
  lib.report('touch: a finger moving across the selected block scrolls the page', st1 !== st0 && (await db()) === beforeTouch, `scrollTop ${st0} → ${st1} | ${await db()}`);
  if (!(await p.locator('.day-block.selected', { hasText: 'Reading' }).count())) { await block('Reading').click(); await p.waitForTimeout(300); }
  [x, y] = await centre(block('Reading'));
  const st2 = await scrollTop();
  await touch('touchStart', [[x, y]]); await p.waitForTimeout(450);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[x, y + i * 6 * px]]); await p.waitForTimeout(16); }
  await touch('touchEnd', []); await p.waitForTimeout(800);
  const st3 = await scrollTop();
  lib.report('touch: hold, then move → the block moves and the page doesn’t scroll', (await db()) !== beforeTouch && Math.abs(st3 - st2) < 2, `scrollTop ${st2} → ${st3} | ${await db()}`);

  // 7. Leaving the Day view forgets the undo (and closes the snackbar).
  [x, y] = await centre(block('Reading'));
  await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(450); await p.mouse.move(x, y - 30 * px, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(700);
  lib.report('(another move offers Undo)', (await undoBtn().count()) === 1);
  await p.locator('ion-tab-button[tab="timer"]').click(); await p.waitForTimeout(800);
  lib.report('leaving the Day view closes the Undo snackbar', (await p.locator('ion-toast.edit-undo-toast').count()) === 0);

  lib.report('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
