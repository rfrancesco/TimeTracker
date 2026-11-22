const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
const S = lib.OUT;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.clock.install({ time: new Date('2026-11-15T09:00:00') });
  await p.goto(lib.BASE);
  await p.waitForSelector('.area-pill-btn');
  await p.waitForTimeout(500);
  await p.screenshot({ path: S + '/1-idle.png' });
  const btn = n => p.locator(`.area-pill-btn[aria-label="${n}"]`);
  await btn('Work').click(); await p.waitForTimeout(300);
  await p.clock.fastForward(20000);
  await btn('Guitar').click(); // < 1 min: relabel
  await p.clock.fastForward(30000);
  await p.waitForTimeout(300);
  { const l = await p.locator('.timer-label').innerText(); lib.report('switch within a minute relabels', l.includes('Guitar'), l); }
  await p.locator('.sub-chips ion-chip', { hasText: 'Technique' }).click(); // still <1min -> relabel
  await p.clock.fastForward(25 * 60000);
  await p.waitForTimeout(300);
  await p.screenshot({ path: S + '/2-tracking.png' });
  await p.locator('.sub-chips ion-chip', { hasText: 'Songs' }).click(); // >1min -> split
  await p.clock.fastForward(40 * 60000);
  await btn('Reading').click(); await p.waitForTimeout(300);
  await p.clock.fastForward(15 * 60000);
  await p.waitForTimeout(300);
  const counts = await p.evaluate(() => new Promise(r => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction(['intervals','active']); const a = t.objectStore('intervals').getAll(); a.onsuccess = () => { const c = t.objectStore('active').getAll(); c.onsuccess = () => r({ intervals: a.result.map(i => [i.start.slice(11,19), i.end.slice(11,19), i.subAreaId?.slice(0,4)]), active: c.result }); }; }; }));
  lib.report('switch after a minute saves intervals', counts.intervals.length === 2 && counts.active.length === 1, JSON.stringify(counts.intervals));
  await p.reload();
  await p.waitForSelector('.area-pill-btn');
  await p.waitForTimeout(500);
  { const l = await p.locator('.timer-label').innerText(), d = await p.locator('.timer-digits').innerText(); lib.report('running timer survives a reload', l.includes('Reading') && /^0:15:0[01]$/.test(d), `${l} ${d}`); }
  await p.screenshot({ path: S + '/3-reload.png' });
  // Day view
  await p.locator('ion-tab-button[tab="day"]').click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: S + '/4-day.png' });
  // select first block, drag bottom handle
  const blk = p.locator('.day-block:not(.active)').first();
  await blk.click({ force: true });
  await p.waitForTimeout(200);
  const h = p.locator('.day-block.selected .handle.bottom');
  const bb = await h.boundingBox();
  await p.mouse.move(bb.x + bb.width/2, bb.y + bb.height/2);
  await p.mouse.down();
  await p.mouse.move(bb.x + bb.width/2, bb.y + 40, { steps: 5 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  await p.screenshot({ path: S + '/5-resized.png' });
  console.log('block text:', await p.locator('.day-block').first().innerText());
  // open editor on selected block by tapping it
  await p.locator('.day-block.selected').click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: S + '/6-editor.png' });
  await p.locator('ion-modal ion-button', { hasText: 'Save' }).click();
  await p.waitForTimeout(500);
  await p.locator('ion-tab-button[tab="settings"]').click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: S + '/7-settings.png' });
  await p.locator('ion-item', { hasText: 'Guitar' }).first().click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: S + '/8-area-editor.png' });
  lib.report('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
