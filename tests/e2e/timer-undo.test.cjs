const lib = require('./lib.cjs');
// Timer undo (↶): start, relabel, split, stop, rewind, discard; several in a row;
// refuses (without changing anything) if data changed underneath.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome', colorScheme: process.env.SCHEME || 'dark' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-16T18:00:00+01:00') });
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  const db = () => p.evaluate(() => new Promise(r => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction(['intervals', 'active', 'areas']); t.objectStore('areas').getAll().onsuccess = e0 => { const n = Object.fromEntries(e0.target.result.map(a => [a.id, a.name])); t.objectStore('intervals').getAll().onsuccess = e => { t.objectStore('active').get('current').onsuccess = e2 => { const f = s => new Date(s).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }); const a = e2.target.result; r(`[${e.target.result.sort((x, y) => x.start.localeCompare(y.start)).map(i => n[i.areaId] + ' ' + f(i.start) + '–' + f(i.end)).join(', ')}] ${a ? '▶ ' + n[a.areaId] + ' since ' + f(a.start) : 'idle'}`); }; }; }; }; }));
  const tap = async (name) => { await p.locator(`.timer-layout .area-pill-btn[aria-label="${name}"]`).click(); await p.waitForTimeout(400); };
  const undo = async () => { await p.locator('.undo-button').click(); await p.waitForTimeout(500); };
  const undoShown = () => p.locator('.undo-button').evaluate(e => e.classList.contains('show'));
  const ff = (min) => p.clock.fastForward(min * 60000);
  const hold = async () => { const r = await p.locator('.stop-button').boundingBox(); await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await p.mouse.down(); await p.waitForTimeout(800); await p.mouse.up(); await p.waitForTimeout(700); };

  lib.report('no undo button when there is nothing to undo', !(await undoShown()));
  await tap('Guitar');
  lib.report('undo appears after an action', await undoShown());
  await undo();
  lib.report('undo a start → idle', (await db()) === '[] idle', await db());

  await tap('Guitar'); await ff(0.5); await tap('Work');
  lib.report('switch within a minute relabels', (await db()) === '[] ▶ Work since 18:00', await db());
  await undo();
  lib.report('undo a relabel → previous area, same start', (await db()) === '[] ▶ Guitar since 18:00', await db());

  await ff(10); await tap('Reading');
  lib.report('switch after a minute saves an interval', (await db()) === '[Guitar 18:00–18:10] ▶ Reading since 18:10', await db());
  await undo();
  lib.report('undo a switch → interval removed, previous timer resumes', (await db()) === '[] ▶ Guitar since 18:00', await db());

  await ff(10); await p.locator('.stop-button').click(); await p.waitForTimeout(600);
  lib.report('stop saves the interval', (await db()) === '[Guitar 18:00–18:20] idle', await db());
  await undo();
  lib.report('undo a stop → timer resumes', (await db()) === '[] ▶ Guitar since 18:00', await db());

  await hold();
  await p.locator('ion-modal.stop-sheet ion-chip', { hasText: /^5 min$/ }).click(); await p.waitForTimeout(200);
  await p.locator('ion-modal.stop-sheet ion-button', { hasText: 'Stop at' }).click(); await p.waitForTimeout(700);
  lib.report('rewind stops 5 min earlier', (await db()) === '[Guitar 18:00–18:15] idle', await db());
  await undo();
  lib.report('undo a rewind → timer resumes', (await db()) === '[] ▶ Guitar since 18:00', await db());

  await hold();
  const applyBefore = await p.locator('ion-modal.stop-sheet .sheet-apply').innerText();
  await p.locator('ion-modal.stop-sheet .discard-chip').click(); await p.waitForTimeout(250);
  const applyAfter = await p.locator('ion-modal.stop-sheet .sheet-apply').innerText();
  lib.report('choosing 🗑 morphs the main button into DISCARD (nothing happens yet)', /^stop at/i.test(applyBefore) && /^discard$/i.test(applyAfter) && (await db()).includes('▶ Guitar'), `${applyBefore} → ${applyAfter}`);
  await p.screenshot({ path: `${lib.OUT}/rewind-sheet-discard.png` });
  // there is always a way back from 🗑: the Now chip, or touching the time field
  await p.locator('ion-modal.stop-sheet ion-chip', { hasText: /^Now$/ }).click(); await p.waitForTimeout(250);
  const backByNow = await p.locator('ion-modal.stop-sheet .sheet-apply').innerText();
  await p.locator('ion-modal.stop-sheet .discard-chip').click(); await p.waitForTimeout(250);
  // (tap the dimmed field's container: a real tap would also open the system picker)
  await p.locator('ion-modal.stop-sheet .sheet-dimmed').evaluate(el => el.click()); await p.waitForTimeout(250);
  const backByField = await p.locator('ion-modal.stop-sheet .sheet-apply').innerText();
  lib.report('from 🗑 you can go back to stopping (Now chip, or the time field)', /^stop at/i.test(backByNow) && /^stop at/i.test(backByField), `${backByNow} | ${backByField}`);
  await p.locator('ion-modal.stop-sheet .discard-chip').click(); await p.waitForTimeout(250);
  await p.locator('ion-modal.stop-sheet .sheet-apply').click(); await p.waitForTimeout(700);
  lib.report('discard throws the running interval away', (await db()) === '[] idle', await db());
  await undo();
  lib.report('undo a discard → timer back', (await db()) === '[] ▶ Guitar since 18:00', await db());
  await p.screenshot({ path: `${lib.OUT}/timer-undo-button.png` });

  // several in a row: switch (split) → stop → undo, undo
  await ff(5); await tap('Thesis'); await ff(5); await p.locator('.stop-button').click(); await p.waitForTimeout(600);
  const two = await db();
  await undo(); await undo();
  lib.report('two undos in a row walk back two steps', two === '[Guitar 18:00–18:25, Thesis 18:25–18:30] idle' && (await db()) === '[] ▶ Guitar since 18:00', `${two} → ${await db()}`);

  // safety: the saved interval was edited elsewhere (e.g. Day view) → refuse, change nothing
  await ff(5); await p.locator('.stop-button').click(); await p.waitForTimeout(600);
  await p.evaluate(() => new Promise(r => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction('intervals', 'readwrite'); const st = t.objectStore('intervals'); st.getAll().onsuccess = e => { const iv = e.target.result[0]; iv.end = new Date(Date.parse(iv.end) - 600000).toISOString(); st.put(iv); }; t.oncomplete = r; }; }));
  const before = await db();
  await undo();
  const msg = await p.evaluate(() => [...document.querySelectorAll('ion-toast')].map(t => t.message).pop() || '');
  lib.report('undo refuses when the data changed underneath, and changes nothing', (await db()) === before && /Can’t undo/.test(msg), `${before} | ${msg}`);
  const toasts = await p.evaluate(() => [...document.querySelectorAll('ion-toast')].map(t => t.message).filter(m => !/Can’t undo/.test(m)));
  lib.report('no success toasts on the Timer page', toasts.length === 0, JSON.stringify(toasts));
  lib.report('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
