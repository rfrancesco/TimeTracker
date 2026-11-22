const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
const S = lib.OUT;
const T = hm => new Date(`2026-11-15T${hm}:00+01:00`).toISOString();
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['Pixel 7'], colorScheme: process.env.SCHEME || 'dark', timezoneId: 'Europe/Rome' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-15T13:10:00+01:00') });
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  await p.evaluate((T) => new Promise(r => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction(['areas','subAreas','intervals'],'readwrite'); t.objectStore('areas').getAll().onsuccess = e => { const id = n => e.target.result.find(a => a.name === n).id; t.objectStore('subAreas').getAll().onsuccess = e2 => { const sid = n => e2.target.result.find(s => s.name === n).id; const st = t.objectStore('intervals'); const add = (i, a, s, f, to) => st.add({ id: i, areaId: id(a), subAreaId: s ? sid(s) : null, start: T[f], end: T[to], updatedAt: T[f] });
    add('w1', 'Work', null, 'a', 'b'); add('c', 'Home', 'Cooking', 'b', 'c2'); add('d', 'Home', 'Cleaning', 'c2', 'd2'); add('w2', 'Work', null, 'd2', 'e'); add('m', 'Music', null, 'e', 'e1'); }; }; t.oncomplete = r; }; }),
    { a: T('09:00'), b: T('12:00'), c2: T('12:02'), d2: T('12:05'), e: T('13:00'), e1: T('13:01') });
  await p.locator('.area-pill-btn[aria-label="Reading"]').click(); await p.waitForTimeout(300);  // timer since 13:10
  await p.locator('ion-tab-button[tab="day"]').click(); await p.waitForTimeout(900);
  const chips = async () => (await p.locator('.day-chip').allInnerTexts()).map(t => t.replace(/\n/g, ' ')).join(' | ');
  console.log('chips @1.2:', await chips());
  console.log('tab label:', await p.locator('ion-tab-button[tab="timer"] ion-label').innerText());
  const ov = await p.evaluate(() => { const r = [...document.querySelectorAll('.day-chip')].map(c => c.getBoundingClientRect()); return r.slice(1).every((x, i) => x.top >= r[i].bottom); });
  lib.report('tiny-interval chips never overlap', ov === true);
  await p.locator('.day-content, ion-content').last().evaluate(el => el.scrollToPoint(0, 11.5 * 60 * 1.2));
  await p.waitForTimeout(400);
  await p.screenshot({ path: S + '/tiny-1.png' });
  // tap chip -> selected; tap again -> editor
  await p.locator('.day-chip', { hasText: 'Cooking' }).click(); await p.waitForTimeout(300);
  console.log('selected chip:', await p.locator('.day-chip.selected').innerText().then(t => t.replace(/\n/g, ' ')));
  await p.screenshot({ path: S + '/tiny-2.png' });
  await p.locator('.day-chip.selected').click(); await p.waitForTimeout(700);
  console.log('editor:', await p.locator('ion-modal ion-title').innerText(), '|', await p.locator('ion-modal ion-input input').evaluateAll(es => es.map(e => e.value).join(' → ')));
  // (Ionic moves aria-label onto its inner <button>, so find it by role + accessible name)
  await p.getByRole('button', { name: 'Close' }).filter({ visible: true }).click();
  await p.waitForSelector('ion-modal ion-title', { state: 'hidden' });
  // zoom in with the pill (anchored), then pinch
  const zoomState = () => p.evaluate(() => ({ h: parseFloat(document.querySelector('.day-view').style.height), chips: document.querySelectorAll('.day-chip').length, blocks: document.querySelectorAll('.day-block').length }));
  await p.locator('.zoom-pill button[aria-label="Zoom in"]').click(); await p.waitForTimeout(300);
  await p.locator('.zoom-pill button[aria-label="Zoom in"]').click(); await p.waitForTimeout(300);
  await p.locator('.zoom-pill button[aria-label="Zoom in"]').click(); await p.waitForTimeout(500);
  console.log('after 3x zoom in:', JSON.stringify(await zoomState()), 'chips:', await chips());
  await p.screenshot({ path: S + '/tiny-3.png' });
  // pinch out (zoom back) with synthetic touches
  await p.evaluate(async () => {
    const el = document.querySelector('.day-view'); const r = el.getBoundingClientRect(); const x = 200, y0 = 400;
    const mk = (id, y) => new Touch({ identifier: id, target: el, clientX: x, clientY: y });
    const fire = (type, ts) => el.dispatchEvent(new TouchEvent(type, { touches: ts, targetTouches: ts, changedTouches: ts, bubbles: true, cancelable: true }));
    fire('touchstart', [mk(1, y0 - 200), mk(2, y0 + 200)]);
    for (let k = 1; k <= 8; k++) { fire('touchmove', [mk(1, y0 - 200 + k * 20), mk(2, y0 + 200 - k * 20)]); await new Promise(r => setTimeout(r, 30)); }
    fire('touchend', []);
  });
  await p.waitForTimeout(500);
  console.log('after pinch in (400px → 80px):', JSON.stringify(await zoomState()));
  // drag a chip: Music 13:00-13:01 can only move between Work end (13:00) and timer start (13:10)
  await p.locator('.day-chip', { hasText: 'Music' }).scrollIntoViewIfNeeded();
  await p.locator('.day-chip', { hasText: 'Music' }).click(); await p.waitForTimeout(300);
  const c = await p.locator('.day-chip.selected').boundingBox();
  await p.mouse.move(c.x + 20, c.y + 10); await p.mouse.down(); await p.waitForTimeout(400); /* hold to lift */ await p.mouse.move(c.x + 20, c.y + 300, { steps: 10 }); await p.mouse.up(); await p.waitForTimeout(500);
  const music = await lib.read(p, ({ intervals }) => intervals.find((i) => i.id === 'm'));
  const f = s => new Date(s).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
  lib.report('dragging a chip stops at the running timer', f(music.end) === '13:10', `${f(music.start)}-${f(music.end)}`);
  // tab bar tint on another page
  await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(600);
  await p.screenshot({ path: S + '/tiny-tabbar.png' });
  console.log('tabbar bg:', await p.locator('ion-tab-bar').evaluate(el => getComputedStyle(el).getPropertyValue('--background').trim().slice(0, 60)), '| theme-color:', await p.evaluate(() => document.querySelector('meta[name=theme-color]').content));
  lib.report('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
