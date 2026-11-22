const lib = require('./lib.cjs');
// "Earlier" (hold an area; quick times count back from now, or from the start when holding the running area): start earlier while idle, switch earlier while running,
// move the start of the running area. The Stop slot is the hold indicator; releasing
// early cancels; a tap still starts at once; every action is undoable.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome', colorScheme: process.env.SCHEME || 'dark' })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-16T18:35:00+01:00') });
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  // history: Thesis 16:00–17:30
  await p.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction(['areas', 'intervals'], 'readwrite'); t.objectStore('areas').getAll().onsuccess = (e) => { const th = e.target.result.find((a) => a.name === 'Thesis'); t.objectStore('intervals').put({ id: 'th', areaId: th.id, subAreaId: null, start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:30:00.000Z', updatedAt: '2026-11-16T16:30:00.000Z' }); }; t.oncomplete = r; }; }));
  await p.reload(); await p.waitForSelector('.area-pill-btn'); await p.waitForTimeout(500);

  const db = () => p.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction(['intervals', 'active', 'areas']); t.objectStore('areas').getAll().onsuccess = (e0) => { const n = Object.fromEntries(e0.target.result.map((a) => [a.id, a.name])); t.objectStore('intervals').getAll().onsuccess = (e) => { t.objectStore('active').get('current').onsuccess = (e2) => { const f = (s) => new Date(s).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }); const a = e2.target.result; r(`[${e.target.result.sort((x, y) => x.start.localeCompare(y.start)).map((i) => n[i.areaId] + ' ' + f(i.start) + '–' + f(i.end)).join(', ')}] ${a ? '▶ ' + n[a.areaId] + ' since ' + f(a.start) : 'idle'}`); }; }; }; }; }));
  const pill = (name) => p.locator(`.timer-layout .area-pill-btn[aria-label="${name}"]`);
  const press = async (name, ms) => { const r = await pill(name).boundingBox(); await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await p.mouse.down(); await p.waitForTimeout(ms); };
  const release = async () => { await p.mouse.up(); await p.waitForTimeout(400); };
  const sheet = 'ion-modal.stop-sheet';
  const title = () => p.locator(`${sheet} .sheet-title`).innerText();
  const chip = (label) => p.locator(`${sheet} .sheet-times ion-chip`, { hasText: new RegExp(`^${label}$`) });
  const apply = p.locator(`${sheet} .sheet-apply`);
  const applyText = () => apply.innerText();
  const hint = () => p.locator(`${sheet} .sheet-hint`).innerText();
  const undo = async () => { await p.locator('.undo-button').click(); await p.waitForTimeout(500); };
  const sheetGone = () => p.waitForSelector(`${sheet} .sheet-title`, { state: 'detached' });
  const BASE = '[Thesis 16:00–17:30]';

  // 1. Indicator while holding, and an early release cancels.
  await press('Guitar', 320);
  // Freeze the page clock (and with it the hold timer) while looking: a screenshot can
  // take longer than the rest of the hold.
  const freeze = async () => p.clock.pauseAt(new Date((await p.evaluate(() => Date.now())) + 20));
  await freeze();
  await p.screenshot({ path: `${lib.OUT}/earlier-1-idle-hold.png` });
  const ind = await p.locator('.stop-button').evaluate((e) => ({ cls: e.className, text: e.innerText.trim(), bg: e.style.getPropertyValue('--background'), disabled: e.disabled }));
  const guitarColor = await pill('Guitar').evaluate((e) => e.style.getPropertyValue('--area-color'));
  lib.report('holding an area turns the Stop slot into the indicator (area colour, “Start earlier”)', /holding/.test(ind.cls) && /area-hold/.test(ind.cls) && /Start earlier/i.test(ind.text) && ind.bg === guitarColor && !ind.disabled, JSON.stringify(ind));
  await p.mouse.up(); await p.clock.resume(); await p.waitForTimeout(400);
  lib.report('releasing early cancels: nothing starts, no sheet', (await db()) === `${BASE} idle` && (await p.locator(`${sheet} .sheet-title`).count()) === 0, await db());
  lib.report('…and the Stop slot is back to a (disabled) Stop', await p.locator('.stop-button').evaluate((e) => !/area-hold|holding/.test(e.className) && e.disabled && /Stop/i.test(e.innerText)));

  // 2. A tap still starts at once.
  await pill('Guitar').click(); await p.waitForTimeout(500);
  lib.report('a tap still starts now', (await db()) === `${BASE} ▶ Guitar since 18:35`, await db());
  await undo();

  // 3. Idle: "When did you start?" (counts back from now)
  await press('Guitar', 800); await release();
  await p.waitForSelector(`${sheet} .sheet-title`);
  const chips = await p.locator(`${sheet} .sheet-times ion-chip`).allInnerTexts();
  lib.report('idle hold opens “When did you start?” with After Thesis + “… ago” times, no 🗑', (await title()) === 'When did you start?' && chips.join('|') === 'After Thesis|5 min ago|15 min ago|30 min ago|1 h ago' && (await p.locator(`${sheet} .discard-chip`).count()) === 0, chips.join('|'));
  await p.waitForTimeout(400); await p.screenshot({ path: `${lib.OUT}/earlier-2-started-sheet.png` });
  lib.report('default: 5 min ago (the last interval ended over an hour ago)', /Start at 06:30 PM|Start at 18:30/i.test(await applyText()), await applyText());
  const applyBg = await apply.evaluate((e) => e.style.getPropertyValue('--background'));
  lib.report('the main button is in the held area’s colour', applyBg === guitarColor, applyBg);
  await p.locator(`${sheet} .time-input input`).fill('17:00'); await p.waitForTimeout(300);
  lib.report('a time before the last interval ended is refused (says why)', /overlaps Thesis \(until (17:30|05:30 PM)\)/.test(await hint()) && (await apply.evaluate((e) => e.disabled)), await hint());
  await chip('After Thesis').click(); await p.waitForTimeout(200);
  lib.report('“After Thesis” = right where Thesis ended', /17:30|05:30 PM/.test(await applyText()) && /Tracks Guitar since (17:30|05:30 PM)/.test(await hint()), `${await applyText()} | ${await hint()}`);
  await apply.click(); await sheetGone(); await p.waitForTimeout(500);
  lib.report('Start at 17:30 → Guitar running since 17:30', (await db()) === `${BASE} ▶ Guitar since 17:30`, await db());
  await undo();
  lib.report('undo → idle again', (await db()) === `${BASE} idle`, await db());

  // start 30 min ago for the next steps
  await press('Guitar', 800); await release(); await p.waitForSelector(`${sheet} .sheet-title`);
  await chip('30 min ago').click(); await p.waitForTimeout(200); await apply.click(); await sheetGone(); await p.waitForTimeout(500);
  lib.report('Start at 18:05 via “30 min ago”', (await db()) === `${BASE} ▶ Guitar since 18:05`, await db());
  const elapsed = await p.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { q.result.transaction('active').objectStore('active').get('current').onsuccess = (e) => r(Date.now() - Date.parse(e.target.result.start)); }; }));
  lib.report('…exactly 30:00 before the tap (seconds kept, no jump to a whole minute)', elapsed >= 30 * 60000 && elapsed < 30 * 60000 + 3000, `${elapsed / 1000} s`);

  // 4. Running: hold another area → "When did you switch to Reading?" (counts back from now)
  await press('Reading', 320);
  await freeze();
  await p.screenshot({ path: `${lib.OUT}/earlier-3-running-hold.png` });
  const ind2 = await p.locator('.stop-button').evaluate((e) => e.innerText.trim());
  lib.report('while running, the indicator says “Switch earlier”', /Switch earlier/i.test(ind2), ind2);
  await p.clock.resume(); await p.waitForTimeout(500); await release(); await p.waitForSelector(`${sheet} .sheet-title`);
  lib.report('switch default: 5 min ago', /Switch at (18:30|06:30 PM)/i.test(await applyText()), await applyText());
  await chip('15 min ago').click(); await p.waitForTimeout(500); await p.screenshot({ path: `${lib.OUT}/earlier-4-switched-sheet.png` });
  const swDisabled = await p.locator(`${sheet} .sheet-times ion-chip`).evaluateAll((es) => es.map((e) => `${e.innerText}:${e.disabled ? 'off' : 'on'}`).join(' '));
  lib.report('“When did you switch to Reading?”: times before Guitar started are greyed (not hidden)', (await title()) === 'When did you switch to Reading?' && swDisabled === '5 min ago:on 15 min ago:on 30 min ago:on 1 h ago:off', swDisabled);
  await chip('15 min ago').click(); await p.waitForTimeout(200);
  lib.report('hint says what will be saved', /Saves Guitar (18:05|06:05 PM)–(18:20|06:20 PM), then Reading since (18:20|06:20 PM)/.test(await hint()), await hint());
  await apply.click(); await sheetGone(); await p.waitForTimeout(500);
  lib.report('Switch at 18:20 → Guitar saved 18:05–18:20, Reading since 18:20', (await db()) === `[Thesis 16:00–17:30, Guitar 18:05–18:20] ▶ Reading since 18:20`, await db());
  await undo();
  lib.report('undo → Guitar running since 18:05 again', (await db()) === `${BASE} ▶ Guitar since 18:05`, await db());

  // 5. Hold the running area → move its start earlier; the times count back from the current start.
  await press('Guitar', 800); await release(); await p.waitForSelector(`${sheet} .sheet-title`);
  lib.report('holding the running area: “When did you start?”, showing “started at 18:05”', (await title()) === 'When did you start?' && /started at (18:05|06:05 PM)/.test(await p.locator(`${sheet} .sheet-running`).innerText()));
  const rsChips = await p.locator(`${sheet} .sheet-times ion-chip`).evaluateAll((es) => es.map((e) => `${e.innerText}:${e.disabled ? 'off' : 'on'}`).join(' '));
  lib.report('…chips count back from the start (“earlier”); 1 h earlier would overlap Thesis → greyed', rsChips === 'After Thesis:on 5 min earlier:on 15 min earlier:on 30 min earlier:on 1 h earlier:off', rsChips);
  lib.report('…default: 5 min earlier than the start (18:00)', /Start at (18:00|06:00 PM)/i.test(await applyText()), await applyText());
  const startMs = () => p.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { q.result.transaction('active').objectStore('active').get('current').onsuccess = (e) => r(Date.parse(e.target.result.start)); }; }));
  const s0 = await startMs();
  await apply.click(); await sheetGone(); await p.waitForTimeout(500);
  const s1 = await startMs();
  lib.report('…“5 min earlier” moves the start by exactly 5:00', s0 - s1 === 5 * 60000, `${(s0 - s1) / 1000} s`);
  await undo();
  await press('Guitar', 800); await release(); await p.waitForSelector(`${sheet} .sheet-title`);
  await chip('15 min earlier').click(); await p.waitForTimeout(200);
  lib.report('…“15 min earlier” = 17:50', /Start at (17:50|05:50 PM)/i.test(await applyText()) && /Guitar since (17:50|05:50 PM) instead of (18:05|06:05 PM)/.test(await hint()), `${await applyText()} | ${await hint()}`);
  await p.locator(`${sheet} .time-input input`).fill('18:05'); await p.waitForTimeout(300);
  lib.report('…the current start itself can’t be applied (nothing would change)', /current start/.test(await hint()) && (await apply.evaluate((e) => e.disabled)), await hint());
  await chip('After Thesis').click(); await p.waitForTimeout(200);
  lib.report('…hint compares with the current start', /Guitar since (17:30|05:30 PM) instead of (18:05|06:05 PM)/.test(await hint()), await hint());
  await apply.click(); await sheetGone(); await p.waitForTimeout(500);
  lib.report('→ Guitar since 17:30 (same timer, earlier start)', (await db()) === `${BASE} ▶ Guitar since 17:30`, await db());
  await undo();
  lib.report('undo → since 18:05 again', (await db()) === `${BASE} ▶ Guitar since 18:05`, await db());

  // 6. Switching within a minute of the start relabels (same rule as switching live).
  await press('Reading', 800); await release(); await p.waitForSelector(`${sheet} .sheet-title`);
  await p.locator(`${sheet} .time-input input`).fill('18:05'); await p.waitForTimeout(300);
  lib.report('switch at Guitar’s start = relabel (hint says so)', /Under a minute of Guitar: the timer becomes Reading since (18:05|06:05 PM)/.test(await hint()), await hint());
  await apply.click(); await sheetGone(); await p.waitForTimeout(500);
  lib.report('→ Reading since 18:05, nothing saved for Guitar', (await db()) === `${BASE} ▶ Reading since 18:05`, await db());
  await undo();

  // 6b. Already right after Thesis: nothing earlier is possible, and the sheet says so.
  await press('Guitar', 800); await release(); await p.waitForSelector(`${sheet} .sheet-title`);
  await chip('After Thesis').click(); await p.waitForTimeout(200); await apply.click(); await sheetGone(); await p.waitForTimeout(500);
  await press('Guitar', 800); await release(); await p.waitForSelector(`${sheet} .sheet-title`);
  const noneChips = await p.locator(`${sheet} .sheet-times ion-chip`).evaluateAll((es) => es.every((e) => e.disabled));
  lib.report('running right after Thesis: every chip greyed, “Already right after Thesis.”', noneChips && /Already right after Thesis/.test(await hint()) && (await apply.evaluate((e) => e.disabled)), await hint());
  await p.keyboard.press('Escape'); await sheetGone(); await undo();
  lib.report('(undo → since 18:05)', (await db()) === `${BASE} ▶ Guitar since 18:05`, await db());

  // 6c. Slow storage (as on the phone): the timer shows the new start at once, and never
  // flashes back to the old value while the write and the live query catch up.
  await p.evaluate(() => {
    const d = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete'); window.__oncomplete = d;
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { configurable: true, get() { return d.get.call(this); }, set(fn) { d.set.call(this, fn && function (e) { setTimeout(() => fn.call(this, e), 700); }); } });
  });
  await press('Guitar', 800); await release(); await p.waitForSelector(`${sheet} .sheet-title`);
  await chip('15 min earlier').click(); await p.waitForTimeout(200);
  await p.evaluate(() => {
    const d = document.querySelector('.timer-digits'); window.__seq = [];
    const rec = () => window.__seq.push([Math.round(performance.now() - window.__click), d.innerText]);
    new MutationObserver(rec).observe(document.querySelector('.timer-display'), { subtree: true, characterData: true, childList: true });
    document.querySelector('ion-modal.stop-sheet .sheet-apply').addEventListener('click', () => { window.__click = performance.now(); window.__seq.push([0, d.innerText]); }, true);
  });
  await apply.click(); await sheetGone(); await p.waitForTimeout(2500);
  const seq = await p.evaluate(() => window.__seq);
  const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const firstJump = seq.find(([, t], i) => i > 0 && mins(t) - mins(seq[0][1]) >= 15);
  const flashBack = seq.some(([ms, t]) => firstJump && ms > firstJump[0] && mins(t) - mins(seq[0][1]) < 15);
  lib.report('slow storage: the timer jumps by 15 min right away and never flashes back', firstJump && firstJump[0] < 300 && !flashBack, seq.map(([ms, t]) => `${ms}:${t}`).join(' '));
  lib.report('…and the write lands', (await db()) === `${BASE} ▶ Guitar since 17:50`, await db());
  await p.evaluate(() => Object.defineProperty(IDBTransaction.prototype, 'oncomplete', window.__oncomplete));
  await undo();

  // 7. Holding Stop still opens "When did you stop?" (the mode resets), default 5 min ago.
  const sb = await p.locator('.stop-button').boundingBox();
  await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await p.mouse.down(); await p.waitForTimeout(800); await p.mouse.up();
  await p.waitForSelector(`${sheet} .sheet-title`);
  lib.report('holding Stop still opens “When did you stop?” with 🗑', (await title()) === 'When did you stop?' && (await p.locator(`${sheet} .discard-chip`).count()) === 1);
  const stopChips = await p.locator(`${sheet} .sheet-times ion-chip`).allInnerTexts();
  lib.report('…Now + “… ago” times, default 5 min ago', stopChips.join('|') === 'Now|5 min ago|15 min ago|30 min ago|1 h ago' && /Stop at (18:30|06:30 PM)/i.test(await applyText()), `${stopChips.join('|')} | ${await applyText()}`);
  await p.screenshot({ path: `${lib.OUT}/earlier-stop-after.png` });

  lib.report('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
