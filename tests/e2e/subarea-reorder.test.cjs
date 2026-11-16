const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
(async () => {
  const S = lib.OUT; const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  const order = () => p.evaluate(() => new Promise(r => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction(['areas', 'subAreas']); t.objectStore('areas').getAll().onsuccess = e => { const home = e.target.result.find(a => a.name === 'Home'); t.objectStore('subAreas').getAll().onsuccess = e2 => r(e2.target.result.filter(s => s.areaId === home.id).sort((a, b) => a.order - b.order).map(s => s.name).join(', ')); }; }; }));
  console.log('before:', await order());
  await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(500);
  await p.locator('ion-item', { hasText: 'Home' }).first().click(); await p.waitForTimeout(700);
  await p.locator('ion-modal ion-content').evaluate(el => el.scrollToBottom(0)); await p.waitForTimeout(400);
  const handles = p.locator('ion-modal ion-reorder');
  console.log('handles:', await handles.count());
  const from = await handles.nth(3).boundingBox(), to = await handles.nth(0).boundingBox();   // Shower → top
  await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await p.mouse.down();
  await p.mouse.move(from.x + from.width / 2, to.y + 2, { steps: 20 }); await p.waitForTimeout(200); await p.mouse.up(); await p.waitForTimeout(600);
  console.log('in editor:', (await p.locator('ion-modal ion-reorder-group ion-input input').evaluateAll(es => es.map(e => e.value))).join(', '));
  await p.screenshot({ path: `${S}/subreorder.png` });
  await p.locator('ion-modal ion-button', { hasText: 'Save' }).click(); await p.waitForTimeout(600);
  { const o = await order(); lib.report('dragged sub-area order is saved', o.startsWith('Shower'), o); }
  await p.locator('ion-tab-button[tab="timer"]').click(); await p.waitForTimeout(400);
  await p.locator('.area-pill-btn[aria-label="Home"]').click(); await p.waitForTimeout(500);
  console.log('timer chips:', (await p.locator('.sub-chips ion-chip').allInnerTexts()).join(', '));
  lib.report('no page errors', errs.length === 0, errs.join('; ')); await b.close();
})();
