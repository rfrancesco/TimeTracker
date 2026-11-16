const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
const S = lib.OUT;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: process.env.SCHEME || 'dark', timezoneId: 'Europe/Rome' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.clock.install({ time: new Date('2026-11-15T18:20:00+01:00') });
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  // Seed 14 days of data directly into IndexedDB.
  await p.evaluate(() => new Promise((res) => {
    const q = indexedDB.open('timetracker');
    q.onsuccess = () => {
      const db = q.result;
      const t = db.transaction(['areas', 'subAreas', 'intervals'], 'readwrite');
      const areas = {}; const subs = {};
      t.objectStore('areas').getAll().onsuccess = (e) => {
        e.target.result.forEach(a => areas[a.name] = a.id);
        t.objectStore('subAreas').getAll().onsuccess = (e2) => {
          e2.target.result.forEach(s => subs[s.name] = s.id);
          const st = t.objectStore('intervals');
          const add = (area, sub, y, mo, d, h1, m1, h2, m2, nextDay) => {
            const s = new Date(y, mo, d, h1, m1); const en = new Date(y, mo, d + (nextDay ? 1 : 0), h2, m2);
            st.add({ id: crypto.randomUUID(), areaId: areas[area], subAreaId: sub ? subs[sub] : null, start: s.toISOString(), end: en.toISOString(), updatedAt: new Date().toISOString() });
          };
          for (let i = 14; i >= 1; i--) {
            const d = new Date(2026, 10, 15 - i); const Y = d.getFullYear(), M = d.getMonth(), D = d.getDate(); const dow = d.getDay();
            add('Sleep', null, Y, M, D, 23, 15 + (i % 3) * 10, 7, 10 + (i % 4) * 5, true);
            if (dow >= 1 && dow <= 5) { add('Work', null, Y, M, D, 9, 0, 12, 45); add('Thesis', null, Y, M, D, 13, 45, 17, 30 + (i % 3) * 10); }
            else { add('Home', i % 2 ? 'Cleaning' : 'Cooking', Y, M, D, 10, 0, 11, 30); add('Thesis', null, Y, M, D, 15, 0, 17, 0); }
            add('Guitar', i % 2 ? 'Technique' : 'Songs', Y, M, D, 19, 0, 19, 45);
            if (i % 3 === 0) add('Cinema', null, Y, M, D, 21, 0, 22, 50); else add('Reading', null, Y, M, D, 21, 30, 22, 40);
            if (i % 2 === 0) add('Music', null, Y, M, D, 18, 0, 18, 40);
          }
          // today so far
          add('Home', 'Cooking', 2026, 10, 15, 9, 0, 10, 0);
          add('Thesis', null, 2026, 10, 15, 14, 0, 17, 30);
        };
      };
      t.oncomplete = () => res();
    };
  }));
  // running timer: Guitar since 18:00
  await p.locator('.area-pill-btn[aria-label="Guitar"]').click();
  await p.evaluate(() => new Promise(r => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction('active', 'readwrite'); const st = t.objectStore('active'); st.get('current').onsuccess = e => { const a = e.target.result; a.start = new Date('2026-11-15T18:00:00+01:00').toISOString(); st.put(a); }; t.oncomplete = r; }; }));
  await p.locator('ion-tab-button[tab="reports"]').click(); await p.waitForTimeout(900);
  const parse = t => { const m = /(?:(\d+)h )?(\d+)m/.exec(t); return m ? (+(m[1] || 0)) * 60 + +m[2] : 0; };
  const fmt = m => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  const read = async (label) => {
    const rows = (await p.locator('.report-row .row-top').allInnerTexts()).map(x => x.split('\n'));
    const sum = rows.reduce((a, r) => a + parse(r[1]), 0);
    const restRows = rows.filter(r => ['Untracked', 'Still to come', 'Before tracking'].includes(r[0])).map(r => r[0] + ' ' + r[1]).join(', ');
    const expect = { day: '24h 00m', week: '168h 00m', month: '720h 00m' }[label];
    if (expect) lib.report(`${label}: parts add up to the whole period`, fmt(sum) === expect, `${fmt(sum)} | ${restRows}`);
    console.log(`${label.padEnd(18)} slices=${await p.locator('.donut-slice').count()} | rows sum ${fmt(sum)} | ${restRows || '(tracked only)'} | centre: ${await p.locator('.donut-caption').innerText()} | hero: ${await p.locator('.hero-caption').innerText()}`);
  };
  await read('day');
  await p.screenshot({ path: S + '/day.png' });
  await p.locator('ion-segment-button', { hasText: 'Week' }).click(); await p.waitForTimeout(700);
  await read('week');
  await p.locator('ion-content').last().evaluate(el => el.scrollToBottom(0)); await p.waitForTimeout(300);
  await p.locator('.day-bars .hit').nth(6).click(); await p.waitForTimeout(300);
  console.log('today detail:      ', (await p.locator('.day-detail-items').innerText()).replace(/\n/g, ' · '));
  await p.screenshot({ path: S + '/week.png' });
  await p.locator('ion-segment-button', { hasText: 'Month' }).click(); await p.waitForTimeout(700);
  await read('month');
  await p.locator('ion-content').last().evaluate(el => el.scrollToBottom(0)); await p.waitForTimeout(300);
  await p.screenshot({ path: S + '/month.png' });
  await p.locator('.report-list-header ion-toggle').click(); await p.waitForTimeout(400);
  await read('month, toggle off');
  console.log('toggle label:      ', await p.locator('.report-list-header ion-toggle').innerText());
  lib.report('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
