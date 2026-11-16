const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
(async () => {
  const S = lib.OUT; const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome', colorScheme: 'dark' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-16T18:00:00+01:00') });
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  const db = () => p.evaluate(() => new Promise(r => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction(['intervals', 'active']); t.objectStore('intervals').getAll().onsuccess = e => { t.objectStore('active').get('current').onsuccess = e2 => { const f = s => new Date(s).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }); r(`intervals: [${e.target.result.map(i => f(i.start) + '–' + f(i.end)).join(', ')}] | running: ${e2.target.result ? 'since ' + f(e2.target.result.start) : 'none'}`); }; }; }; }));
  const toastMsg = () => p.evaluate(() => [...document.querySelectorAll('ion-toast')].map(t => t.message).pop() || '(none)');
  const clickUndo = () => p.locator('.undo-button').click();
  // ---- tap Stop + undo
  await p.locator('.area-pill-btn[aria-label="Guitar"]').click(); await p.waitForSelector('.stop-button'); await p.waitForTimeout(300); await p.clock.fastForward(40 * 60000); await p.waitForTimeout(300);
  await p.locator('.stop-button').click(); await p.waitForTimeout(600);
  { const d = await db(); lib.report('tap Stop saves the interval and offers Undo', d.includes('18:00–18:40') && d.includes('running: none') && await p.locator('.undo-button').evaluate(e => e.classList.contains('show')), d); }
  await clickUndo(); await p.waitForTimeout(500);
  { const d = await db(); lib.report('Undo resumes the same timer', d === 'intervals: [] | running: since 18:00', d); }
  // ---- long-press Stop → sheet → 15 min ago
  const box = await p.locator('.stop-button').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(800); await p.mouse.up(); await p.waitForTimeout(700);
  console.log('long-press:      ', await p.locator('ion-modal.stop-sheet .sheet-title').innerText().catch(() => 'NO SHEET'), '| still running:', (await db()).includes('running: since'));
  await p.locator('ion-modal.stop-sheet ion-chip', { hasText: /^15 min$/ }).click(); await p.waitForTimeout(200);
  console.log('sheet hint:      ', await p.locator('.sheet-hint').innerText());
  await p.screenshot({ path: S + '/stop-sheet.png' });
  for (const width of [411, 390, 360]) {
    await p.setViewportSize({ width, height: 915 }); await p.waitForTimeout(250);
    const lay = await p.evaluate(() => {
      const row = document.querySelector('ion-modal.stop-sheet .sheet-quick').getBoundingClientRect();
      const chips = [...document.querySelectorAll('ion-modal.stop-sheet .sheet-quick ion-chip')].map(c => c.getBoundingClientRect());
      const times = document.querySelector('ion-modal.stop-sheet .sheet-times');
      const bin = chips[chips.length - 1];
      return { oneLine: chips.every(c => Math.abs(c.top - chips[0].top) < 2), binAtRight: row.right - bin.right < 8, scrolls: times.scrollWidth > times.clientWidth };
    });
    lib.report(`${width}px: all chips visible on one line, 🗑 at the right end`, lay.oneLine && lay.binAtRight && !lay.scrolls, JSON.stringify(lay));
  }
  await p.setViewportSize({ width: 412, height: 915 }); await p.waitForTimeout(250);
  await p.locator('ion-modal.stop-sheet ion-button', { hasText: 'Stop at' }).click(); await p.waitForTimeout(900);
  { const d = await db(); lib.report('“15 min ago” stops at 18:25', d.includes('18:00–18:25') && d.includes('running: none'), d); }
  await clickUndo(); await p.waitForTimeout(500);
  console.log('undo:            ', await db());

  // ---- Back gesture
  const where = () => p.evaluate(() => ({ url: location.pathname, modals: [...document.querySelectorAll('ion-modal, ion-alert, ion-action-sheet')].filter(m => !m.classList.contains('overlay-hidden')).length }));
  await p.locator('ion-tab-button[tab="day"]').click(); await p.waitForTimeout(600);
  await p.locator('.day-grid').click({ position: { x: 60, y: 8 * 60 * 1.2 + 5 } }); await p.waitForTimeout(700);
  console.log('\nDay: editor open    ', JSON.stringify(await where()));
  await p.goBack(); await p.waitForTimeout(700);
  { const w = await where(); lib.report('back closes the Day editor and stays on Day', w.url === '/day' && w.modals === 0, JSON.stringify(w)); }
  await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(600);
  await p.locator('ion-item', { hasText: 'Home' }).first().click(); await p.waitForTimeout(700);
  console.log('Settings: area editor', JSON.stringify(await where()));
  await p.goBack(); await p.waitForTimeout(700);
  { const w = await where(); lib.report('back closes the area editor and stays on Settings', w.url === '/settings' && w.modals === 0, JSON.stringify(w)); }
  await p.locator('ion-item', { hasText: 'start fresh' }).click(); await p.waitForTimeout(600);
  await p.locator('ion-action-sheet button', { hasText: 'keep areas' }).click(); await p.waitForTimeout(700);
  console.log('sheet → confirm      ', JSON.stringify(await where()));
  await p.goBack(); await p.waitForTimeout(700);
  { const w = await where(); lib.report('back cancels a stacked confirmation', w.url === '/settings' && w.modals === 0, JSON.stringify(w)); }
  { const d = await db(); lib.report('cancelled confirmation changed nothing', d.includes('running: since 18:00'), d); }
  await p.locator('ion-select').click(); await p.waitForTimeout(600);
  await p.locator('ion-alert button', { hasText: 'Cancel' }).click(); await p.waitForTimeout(700);
  console.log('theme picker, Cancel ', JSON.stringify(await where()));
  await p.goBack(); await p.waitForTimeout(700);
  { const w = await where(); lib.report('after closing by button, back navigates normally', w.url === '/day', JSON.stringify(w)); }
  await p.goBack(); await p.waitForTimeout(700);
  console.log('  back again →       ', JSON.stringify(await where()));
  lib.report('no page errors', errs.length === 0, errs.join('; ')); await b.close();
})();
