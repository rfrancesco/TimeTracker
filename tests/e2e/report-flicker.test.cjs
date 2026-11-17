const lib = require('./lib.cjs');
// Reports never flash an empty report while switching periods (each period here has
// data). Real clock on purpose: the fake clock changes when frames and IndexedDB
// callbacks fire, which hides the flash.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome', colorScheme: process.env.SCHEME || 'dark' })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  // 40 days of data (Work 9–12, Reading 21–22), up to today
  await p.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction(['areas', 'intervals'], 'readwrite'); t.objectStore('areas').getAll().onsuccess = (e) => { const by = Object.fromEntries(e.target.result.map((a) => [a.name, a.id])); const st = t.objectStore('intervals'); for (let d = 0; d <= 40; d++) { const day = new Date(); day.setDate(day.getDate() - d); const at = (h) => { const x = new Date(day); x.setHours(h, 0, 0, 0); return x; }; for (const [id, area, h0, h1] of [['w', by.Work, 0, 1], ['r', by.Reading, 21, 22]]) { const s = d === 0 ? new Date(Date.now() - 3 * 3600e3) : at(h0); const en = d === 0 ? new Date(Date.now() - 2 * 3600e3) : at(h1); if (d === 0 && id === 'r') continue; st.put({ id: id + d, areaId: area, subAreaId: null, start: s.toISOString(), end: en.toISOString(), updatedAt: en.toISOString() }); } } }; t.oncomplete = r; }; }));
  await p.reload(); await p.waitForSelector('.area-pill-btn');
  await p.locator('ion-tab-button[tab="reports"]').click(); await p.waitForSelector('.report');
  await p.evaluate(() => {
    window.__frames = [];
    const tick = () => {
      const page = [...document.querySelectorAll('.ion-page')].find((x) => x.querySelector('.period-label') && !x.classList.contains('ion-page-hidden'));
      window.__frames.push(page?.querySelector('.report-empty') ? 'EMPTY' : page?.querySelector('.report') ? 'report' : 'none');
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const prev = () => p.locator('ion-button[aria-label="Previous period"]').click();
  for (let i = 0; i < 6; i++) { await prev(); await p.waitForTimeout(250); }
  await p.locator('ion-segment-button', { hasText: 'Week' }).click(); await p.waitForTimeout(400);
  await prev(); await p.waitForTimeout(400);
  await p.locator('ion-segment-button', { hasText: 'Month' }).click(); await p.waitForTimeout(400);
  await prev(); await p.waitForTimeout(400);
  const frames = await p.evaluate(() => window.__frames);
  const bad = frames.filter((f) => f !== 'report').length;
  lib.report('switching days/weeks/months never flashes an empty report', frames.length > 30 && bad === 0, `${frames.length} frames, ${bad} without the report`);
  const lastMonth = await p.evaluate(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString([], { month: 'long', year: 'numeric' }); });
  const label = (await p.locator('.period-label').innerText()).split('\n')[0];
  lib.report('the label follows: one month back shows last month', label === lastMonth, `${label} | expected ${lastMonth}`);
  lib.report('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
