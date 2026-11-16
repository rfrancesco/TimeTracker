const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const [label, now, sleepStart] of [['spring (Mar 29)', '2026-03-29T12:00:00+02:00', '2026-03-28T23:00:00+01:00'], ['fall (Oct 25)', '2026-10-25T12:00:00+01:00', '2026-10-24T23:00:00+02:00']]) {
    const p = await (await b.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome' })).newPage();
    await p.clock.install({ time: new Date(now) });
    await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
    await p.evaluate(([s]) => new Promise(r => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction(['areas', 'intervals'], 'readwrite'); t.objectStore('areas').getAll().onsuccess = e => { const sleep = e.target.result.find(a => a.name === 'Sleep').id; t.objectStore('intervals').add({ id: 's', areaId: sleep, subAreaId: null, start: new Date(s).toISOString(), end: new Date(new Date(s).getTime() + 9 * 3600e3).toISOString(), updatedAt: 'x' }); }; t.oncomplete = r; }; }), [sleepStart]);
    await p.locator('ion-tab-button[tab="reports"]').click(); await p.waitForTimeout(900);
    const rows = (await p.locator('.report-row .row-top').allInnerTexts()).map(x => x.replace(/\n/g, ' ')).join(' ; ');
    const centre = await p.locator('.donut-caption').innerText();
    lib.report(`${label}: day report covers ${label.startsWith('spring') ? 23 : 25} h`, centre.includes(label.startsWith('spring') ? '23h 00m' : '25h 00m'), `${centre} | ${rows}`);
  }
  await b.close();
})();
