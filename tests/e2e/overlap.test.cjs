const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
const S = lib.OUT;
const T = (hm) => new Date(`2026-11-15T${hm}:00+01:00`).toISOString();
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'light', timezoneId: 'Europe/Rome' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-15T18:00:00+01:00') });
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  const idb = (fn, arg) => p.evaluate(([src, arg]) => new Promise((res, rej) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const f = new Function('db', 'arg', 'res', src); f(q.result, arg, res); }; }), [fn, arg]);
  const dump = () => idb(`const t = db.transaction(['intervals','active','areas']); const out = {}; t.objectStore('areas').getAll().onsuccess = e => { out.names = Object.fromEntries(e.target.result.map(a => [a.id, a.name])); t.objectStore('intervals').getAll().onsuccess = e2 => { out.iv = e2.target.result; t.objectStore('active').get('current').onsuccess = e3 => { out.active = e3.target.result; res(out); }; }; };`);
  const check = async (label) => {
    const { iv, active, names } = await dump();
    const now = await p.evaluate(() => Date.now());
    const s = iv.map(i => ({ n: names[i.areaId], s: Date.parse(i.start), e: Date.parse(i.end) })).sort((a, b) => a.s - b.s);
    const bad = [];
    s.forEach((x, k) => { if (!(x.e > x.s)) bad.push('empty ' + x.n); if (x.e > now) bad.push('future ' + x.n); if (k && s[k - 1].e > x.s) bad.push(`overlap ${s[k - 1].n}/${x.n}`); });
    if (active && s.length && Date.parse(active.start) < Math.max(...s.map(x => x.e))) bad.push('active overlaps');
    const fmt = t => new Date(t).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
    lib.report(`data valid after: ${label}`, bad.length === 0, bad.join(','));
    console.log(`${label.padEnd(34)} ${bad.length ? 'INVALID ' + bad.join(',') : 'ok'} | ${s.map(x => `${x.n} ${fmt(x.s)}-${fmt(x.e)}`).join(', ')}${active ? ` | ▶ ${names[active.areaId]} since ${fmt(Date.parse(active.start))}` : ''}`);
  };
  // Seed: Work 09:00-12:00, Thesis 14:00-17:00
  await idb(`const t = db.transaction(['areas','intervals'],'readwrite'); t.objectStore('areas').getAll().onsuccess = e => { const id = n => e.target.result.find(a => a.name === n).id; const st = t.objectStore('intervals'); st.add({ id: 'w', areaId: id('Work'), subAreaId: null, start: arg.w1, end: arg.w2, updatedAt: arg.w1 }); st.add({ id: 't', areaId: id('Thesis'), subAreaId: null, start: arg.t1, end: arg.t2, updatedAt: arg.t1 }); }; t.oncomplete = () => res();`, { w1: T('09:00'), w2: T('12:00'), t1: T('14:00'), t2: T('17:00') });
  await check('seed');
  await p.locator('ion-tab-button[tab="day"]').click(); await p.waitForTimeout(800);

  // 1) Resize Work's bottom handle way down: must stop at Thesis (14:00)
  const work = p.locator('.day-block', { hasText: 'Work' });
  await work.click(); await p.waitForTimeout(400);
  let h = await p.locator('.day-block.selected .handle.bottom').boundingBox();
  await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await p.mouse.down();
  await p.mouse.move(h.x + h.width / 2, h.y + 600, { steps: 12 }); await p.mouse.up(); await p.waitForTimeout(500);
  await check('drag Work end far down');
  // 2) Move Thesis up into Work: must stop at Work's end
  await p.locator('.day-block', { hasText: 'Thesis' }).click(); await p.waitForTimeout(400);
  const th = await p.locator('.day-block.selected').boundingBox();
  await p.mouse.move(th.x + th.width / 2, th.y + 30); await p.mouse.down();
  await p.mouse.move(th.x + th.width / 2, th.y - 400, { steps: 12 }); await p.mouse.up(); await p.waitForTimeout(500);
  await check('move Thesis up into Work');
  // 3) Resize Thesis bottom into the future: must stop at now (18:00)
  // (Thesis is still selected from step 2; tapping it again would open the editor.)
  h = await p.locator('.day-block.selected .handle.bottom').boundingBox();
  await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await p.mouse.down();
  await p.mouse.move(h.x + h.width / 2, h.y + 700, { steps: 12 }); await p.mouse.up(); await p.waitForTimeout(500);
  await check('drag Thesis end into future');
  await p.locator('ion-fab-button').click(); await p.waitForTimeout(300);
  { const t = await p.locator('ion-toast').evaluate(t => t.message).catch(() => 'none'); lib.report('+ with no free time says so', /No free time/.test(t), t); }
  await p.waitForTimeout(2500);

  // 4) Editor: new interval overlapping both -> alert; cancel, then replace
  const setDT = async (label, v) => { const [d, t] = v.split('T');
    await p.locator(`ion-modal input[aria-label="${label} date"]`).fill(d);
    await p.locator(`ion-modal input[aria-label="${label} time"]`).fill(t); };
  const openEditorWith = async (start, end) => {
    if (await p.locator('.day-block.selected').count()) { await p.locator('.day-grid').click({ position: { x: 60, y: 6 * 60 * 1.2 + 5 } }); await p.waitForTimeout(500); }
    await p.locator('.day-grid').click({ position: { x: 60, y: 6 * 60 * 1.2 + 5 } }); await p.waitForTimeout(600);
    await setDT('Start', start); await setDT('End', end); await p.waitForTimeout(200);
  };
  await openEditorWith('2026-11-15T11:00', '2026-11-15T15:00');
  await p.locator('ion-modal .area-pill-btn[aria-label="Guitar"]').click();
  await p.locator('ion-modal ion-button', { hasText: 'Save' }).click(); await p.waitForTimeout(500);
  console.log('alert:', (await p.locator('ion-alert .alert-message').innerText()).replace(/\n/g, ' / '));
  await p.screenshot({ path: S + '/ovl-alert.png' });
  await p.locator('ion-alert button', { hasText: 'Cancel' }).click(); await p.waitForTimeout(300);
  await check('overlap -> cancel');
  await p.locator('ion-modal ion-button', { hasText: 'Save' }).click(); await p.waitForTimeout(400);
  await p.locator('ion-alert button', { hasText: 'Replace' }).click(); await p.waitForTimeout(600);
  await check('overlap -> replace');
  // 5) Future end: Save disabled with message
  await openEditorWith('2026-11-15T17:30', '2026-11-15T19:00');
  console.log('future:', await p.locator('ion-modal .duration-hint').innerText(), '| save disabled:', await p.locator('ion-modal ion-button', { hasText: 'Save' }).evaluate(e => e.disabled));
  await p.locator('ion-modal ion-button[aria-label="Close"]').click(); await p.waitForTimeout(500);
  // 6) Start a timer, then edit its start back into Thesis -> alert -> replace
  await p.locator('ion-tab-button[tab="timer"]').click(); await p.waitForTimeout(500);
  await p.locator('.area-pill-btn[aria-label="Reading"]').click(); await p.waitForTimeout(300);
  await check('start Reading timer');
  await p.locator('ion-tab-button[tab="day"]').click(); await p.waitForTimeout(600);
  console.log('active blocks:', await p.locator('.day-block.active, .day-chip.active').count());
  await p.locator('.day-block.active, .day-chip.active').click(); await p.waitForTimeout(600);
  console.log('modal title:', await p.locator('ion-modal ion-title').innerText().catch(() => 'no modal'), '| inputs:', await p.locator('ion-modal ion-input input').count());
  await setDT('Start', '2026-11-15T16:00');
  await p.waitForTimeout(200);
  console.log('hint:', await p.locator('ion-modal .duration-hint').innerText());
  await p.locator('ion-modal ion-button', { hasText: 'Save' }).click(); await p.waitForTimeout(500);
  await p.screenshot({ path: S + '/ovl-dbg.png' });
  console.log('alert:', (await p.locator('ion-alert .alert-message').innerText()).replace(/\n/g, ' / '));
  await p.locator('ion-alert button', { hasText: 'Replace' }).click(); await p.waitForTimeout(600);
  await check('timer start -> 16:00, replace');
  lib.report('no page errors', errs.length === 0, errs.join('; '));
  await p.locator('ion-tab-button[tab="day"]').click(); await p.waitForTimeout(300);
  await p.screenshot({ path: S + '/ovl-day.png' });
  await b.close();
})();
