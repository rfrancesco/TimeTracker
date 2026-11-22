const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
const S = lib.OUT;
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-15T09:00:00') });
  await p.goto(lib.BASE);
  await p.waitForSelector('.area-pill-btn');
  const count = () => lib.read(p, ({ intervals, active, areas, subs }) => ({ intervals: intervals.length, active: active ? 1 : 0, areas: areas.sort((a, b) => a.order - b.order).map((a) => { const n = subs.filter((s) => s.areaId === a.id).length; return a.name + (n ? `(${n})` : ''); }).join(' ') }));
  console.log('defaults:', JSON.stringify(await count()));
  const btn = n => p.locator(`.area-pill-btn[aria-label="${n}"]`);
  const stop = () => p.locator('.stop-button').click();
  await btn('Music').click(); await p.waitForTimeout(300); await p.clock.fastForward(30000); await stop(); await p.waitForTimeout(200);
  { const c = await count(); lib.report('stop under a minute discards the timer', c.intervals === 0 && c.active === 0, JSON.stringify(c)); }
  await btn('Cinema').click(); await p.waitForTimeout(300); await p.clock.fastForward(5 * 60000); await stop(); await p.waitForTimeout(200);
  { const c = await count(); lib.report('stop after 5 min saves an interval', c.intervals === 1 && c.active === 0, JSON.stringify(c)); }
  await btn('Thesis').click(); await p.waitForTimeout(200);
  await p.screenshot({ path: S + '/n1-timer.png' });
  // reset: keep areas
  await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(600);
  await p.screenshot({ path: S + '/n2-settings.png' });
  await p.locator('ion-item', { hasText: 'start fresh' }).click(); await p.waitForTimeout(600);
  await p.screenshot({ path: S + '/n3-sheet.png' });
  await p.locator('ion-action-sheet button', { hasText: 'keep areas' }).click(); await p.waitForTimeout(600);
  await p.locator('ion-alert button', { hasText: 'Delete' }).click(); await p.waitForTimeout(600);
  { const c = await count(); lib.report('reset: delete tracked time, keep areas', c.intervals === 0 && c.active === 0 && c.areas.startsWith('Sleep'), JSON.stringify(c)); }
  // rename an area, then reset everything
  await p.evaluate(() => new Promise(r => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction('areas','readwrite'); const st = t.objectStore('areas'); st.getAll().onsuccess = e => { const a = e.target.result[0]; a.name = 'Renamed'; st.put(a); }; t.oncomplete = r; }; }));
  await p.locator('ion-item', { hasText: 'start fresh' }).click(); await p.waitForTimeout(600);
  await p.locator('ion-action-sheet button', { hasText: 'Reset everything' }).click(); await p.waitForTimeout(600);
  await p.locator('ion-alert button', { hasText: 'Delete' }).click(); await p.waitForTimeout(600);
  { const c = await count(); lib.report('reset everything restores the default areas', c.intervals === 0 && !c.areas.includes('Renamed') && c.areas.startsWith('Sleep Work Home'), c.areas); }
  console.log('build:', await p.locator('.version-note').innerText().catch(() => '?'));
  lib.report('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
