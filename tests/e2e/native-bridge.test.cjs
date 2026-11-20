const lib = require('./lib.cjs');
// The Android wrapper bridge (src/native.ts), with a fake native side: the running
// timer is mirrored to the notification; a Stop pressed on the notification (live
// event, or recorded while the app was closed) is applied through stopAt + undo;
// stale stops are ignored; export goes through the native share sheet.
const { chromium, devices } = require('playwright');

const FAKE_NATIVE = () => {
  window.androidBridge = { postMessage() {} };
  const calls = (window.__calls = []);
  const state = (window.__native = { listeners: [] });
  // The pending stop lives in "SharedPreferences": it survives reloads (sessionStorage here).
  const KEY = 'nativePending';
  if (sessionStorage.getItem('pendingStop')) { sessionStorage.setItem(KEY, sessionStorage.getItem('pendingStop')); sessionStorage.removeItem('pendingStop'); }
  const getPending = () => JSON.parse(sessionStorage.getItem(KEY) || 'null');
  const setPending = (v) => (v ? sessionStorage.setItem(KEY, JSON.stringify(v)) : sessionStorage.removeItem(KEY));
  const oldApk = !!window.__oldApk; // an APK from before peek/clear existed
  const promise = ['showTimer', 'hideTimer', 'takePendingStop', 'shareFile', 'status', 'openNotificationSettings', 'removeListener', ...(oldApk ? [] : ['peekPendingStop', 'clearPendingStop', 'haptic'])];
  window.Capacitor = {
    PluginHeaders: [{ name: 'TimeTracker', methods: [...promise.map((name) => ({ name, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' }] }],
    nativePromise(_plugin, method, opts) {
      calls.push([method, opts]);
      if (method === 'takePendingStop') { const p = getPending(); setPending(null); return Promise.resolve(p || {}); }
      if (method === 'peekPendingStop') {
        if (window.__stallPeek) return new Promise(() => {}); // never answers: the page reloads meanwhile
        return Promise.resolve(getPending() || {});
      }
      if (method === 'clearPendingStop') { if (getPending()?.start === opts.start) setPending(null); return Promise.resolve(); }
      if (method === 'status') return Promise.resolve({ sdk: 37, permission: 'granted', notificationsEnabled: true, liveUpdatesAllowed: !!window.__liveAllowed, promotable: true, posted: true, promoted: false, longPressTimeout: 1000, lastLoadError: { at: Date.parse('2026-11-16T07:00:00Z'), code: -2, description: 'net::ERR_INTERNET_DISCONNECTED', url: 'https://rfrancesco.github.io/TimeTracker/' } });
      return Promise.resolve(method === 'showTimer' ? { shown: true } : undefined);
    },
    nativeCallback(_plugin, method, opts, cb) {
      if (method === 'addListener') state.listeners.push({ event: opts?.eventName, cb });
      return 'cb' + state.listeners.length;
    },
  };
  window.__pending = getPending;
  window.__notificationStop = (start, end) => {
    setPending({ start, end });
    state.listeners.filter((l) => l.event === 'stop').forEach((l) => l.cb({}));
  };
  window.__openTimer = () => state.listeners.filter((l) => l.event === 'openTimer').forEach((l) => l.cb({}));
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome', colorScheme: process.env.SCHEME || 'dark' });
  await ctx.addInitScript(FAKE_NATIVE);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-16T18:00:00+01:00') });
  await p.goto(lib.BASE);
  await p.waitForSelector('.area-pill-btn');
  await p.waitForTimeout(500);

  const db = () => p.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction(['intervals', 'active', 'areas']); t.objectStore('areas').getAll().onsuccess = (e0) => { const n = Object.fromEntries(e0.target.result.map((a) => [a.id, a.name])); t.objectStore('intervals').getAll().onsuccess = (e) => { t.objectStore('active').get('current').onsuccess = (e2) => { const f = (s) => new Date(s).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }); const a = e2.target.result; r(`[${e.target.result.sort((x, y) => x.start.localeCompare(y.start)).map((i) => n[i.areaId] + ' ' + f(i.start) + '–' + f(i.end)).join(', ')}] ${a ? '▶ ' + n[a.areaId] + ' since ' + f(a.start) : 'idle'}`); }; }; }; }; }));
  const calls = () => p.evaluate(() => window.__calls.filter(([m]) => !['takePendingStop', 'peekPendingStop', 'clearPendingStop', 'haptic', 'status'].includes(m)));
  const last = async () => (await calls()).at(-1);
  const activeStart = () => p.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { q.result.transaction('active').objectStore('active').get('current').onsuccess = (e) => r(e.target.result && Date.parse(e.target.result.start)); }; }));
  const tap = async (name) => { await p.locator(`.timer-layout .area-pill-btn[aria-label="${name}"]`).click(); await p.waitForTimeout(400); };
  const j = (x) => JSON.stringify(x, (k, v) => (k === 'icon' && typeof v === 'string' ? `<png ${v.length} b64>` : v));
  const ff = (min) => p.clock.fastForward(min * 60000);
  const visible = () => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  const first = await calls();
  lib.report('idle on launch → notification hidden, never shown', first.length >= 1 && first.every(([m]) => m === 'hideTimer'), j(first));

  await tap('Guitar');
  const start = await activeStart();
  const haptics = await p.evaluate(() => window.__calls.filter(([m]) => m === 'haptic').map(([, o]) => o.kind));
  lib.report('tapping an area asks the app for a system haptic (light tick)', haptics.includes('tick'), JSON.stringify(haptics));
  let l = await last();
  const guitarColor = await p.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { q.result.transaction('areas').objectStore('areas').getAll().onsuccess = (e) => r(e.target.result.find((a) => a.name === 'Guitar').color); }; }));
  lib.report('start → showTimer with the start time, area name and stored colour', l[0] === 'showTimer' && l[1].start === start && l[1].title === 'Guitar' && l[1].color === guitarColor, j(l));

  // The area's icon travels as a white-on-transparent PNG, plus the readable ink for the badge.
  const glyph = await p.evaluate(async ([png, color, ink]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0, nonWhite = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { opaque++; if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) nonWhite++; }
    // preview of the native badge: glyph in `ink` on a circle of the area colour
    const b = document.createElement('canvas'); b.width = b.height = 192; const g = b.getContext('2d');
    g.fillStyle = color; g.beginPath(); g.arc(96, 96, 96, 0, 7); g.fill();
    const t = document.createElement('canvas'); t.width = t.height = 192; const tg = t.getContext('2d');
    tg.drawImage(img, 42, 42, 108, 108); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = ink; tg.fillRect(0, 0, 192, 192);
    g.drawImage(t, 0, 0);
    document.body.insertAdjacentHTML('beforeend', `<img id="badge-preview" src="${b.toDataURL()}" style="position:fixed;top:0;left:0;z-index:99999;background:#222;padding:8px">`);
    return { w: img.width, h: img.height, opaque, nonWhite, corner: d[3] };
  }, [l[1].icon, l[1].color, l[1].onColor]);
  await p.locator('#badge-preview').screenshot({ path: `${lib.OUT}/native-badge.png` });
  await p.evaluate(() => document.getElementById('badge-preview').remove());
  lib.report('the area icon is sent as a white glyph on transparent, with the readable ink', glyph.w === 96 && glyph.opaque > 500 && glyph.nonWhite === 0 && glyph.corner === 0 && /^#[0-9a-f]{6}$/i.test(l[1].onColor), JSON.stringify({ ...glyph, onColor: l[1].onColor }));

  await ff(0.5); await tap('Work');
  l = await last();
  lib.report('relabel → notification updated, same start', l[0] === 'showTimer' && l[1].title === 'Work' && l[1].start === start, j(l));

  const before = (await calls()).length;
  await visible(); await p.waitForTimeout(300);
  l = await last();
  lib.report('back in the foreground → notification re-posted (in case it was swiped away)', (await calls()).length > before && l[0] === 'showTimer', j(l));

  // Stop on the notification while the app is alive.
  await ff(10);
  await p.evaluate(([s]) => window.__notificationStop(s, s + 5 * 60000), [start]);
  await p.waitForTimeout(600);
  lib.report('Stop on the notification → interval saved up to when Stop was pressed', (await db()) === '[Work 18:00–18:05] idle', await db());
  lib.report('…and the notification is hidden', (await last())[0] === 'hideTimer');
  lib.report('…and it can be undone with ↶', await p.locator('.undo-button').evaluate((e) => e.classList.contains('show')));
  await p.locator('.undo-button').click(); await p.waitForTimeout(500);
  l = await last();
  lib.report('undo → timer resumes and the notification comes back', (await db()) === '[] ▶ Work since 18:00' && l[0] === 'showTimer' && l[1].start === start, `${await db()} ${j(l)}`);

  // A stop that refers to an older timer is ignored.
  await p.evaluate(([s]) => window.__notificationStop(s - 3600000, s), [start]);
  await p.waitForTimeout(500);
  lib.report('stale Stop (different timer) is ignored', (await db()) === '[] ▶ Work since 18:00', await db());

  // Stop recorded natively while the web app was closed: applied on the next launch.
  await p.evaluate(([s]) => sessionStorage.setItem('pendingStop', JSON.stringify({ start: s, end: s + 7 * 60000 })), [start]);
  await p.reload(); await p.waitForSelector('.area-pill-btn'); await p.waitForTimeout(800);
  const afterReload = await calls();
  lib.report('Stop pressed while the app was closed → applied on launch', (await db()) === '[Work 18:00–18:07] idle', await db());
  lib.report('…and the notification is not shown again', afterReload.every(([m]) => m !== 'showTimer'), j(afterReload));
  lib.report('…and it can still be undone with ↶', await p.locator('.undo-button').evaluate((e) => e.classList.contains('show')));
  await p.locator('.undo-button').click(); await p.waitForTimeout(500);
  lib.report('undo → timer resumes', (await db()) === '[] ▶ Work since 18:00', await db());
  await p.locator('.stop-button').click(); await p.waitForTimeout(600);

  // Export goes through the native share sheet.
  await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(500);
  await p.locator('ion-item', { hasText: 'Export backup' }).click(); await p.waitForTimeout(500);
  const share = (await calls()).find(([m]) => m === 'shareFile');
  let parsed = null;
  try { parsed = JSON.parse(share[1].text); } catch {}
  lib.report('export → native shareFile with the backup JSON', !!share && /^timetracker-\d{4}-\d{2}-\d{2}\.json$/.test(share[1].name) && parsed?.app && parsed.intervals?.length === 1, share ? share[1].name : 'not called');

  // The app reloads (e.g. an update on resume) while it is reading the pending stop:
  // the stop must survive and be applied after the reload, then cleared.
  await p.locator('ion-tab-button[tab="timer"]').click(); await p.waitForTimeout(300);
  await tap('Guitar'); await p.waitForTimeout(300);
  const s2 = await activeStart();
  await ff(20);
  await p.evaluate(() => { window.__stallPeek = true; });
  await p.evaluate(([s]) => window.__notificationStop(s, s + 12 * 60000), [s2]);
  await p.waitForTimeout(300);
  const midway = await db();
  await p.reload(); await p.waitForSelector('.area-pill-btn'); await p.waitForTimeout(800);
  lib.report('reload while the stop is being read → still applied after the reload', midway.includes('▶ Guitar') && (await db()).includes('Guitar 18:') && (await db()).endsWith('idle'), `${midway} → ${await db()}`);
  lib.report('…and only then forgotten by the native side', (await p.evaluate(() => window.__pending())) === null);
  lib.report('…and still undoable with ↶', await p.locator('.undo-button').evaluate((e) => e.classList.contains('show')));
  await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(400);

  // Settings → Android app: diagnostics from the native side.
  const section = p.locator('ion-list', { has: p.locator('ion-list-header', { hasText: 'Android app' }) });
  const rows = async () => (await section.locator('ion-item').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  const r0 = await rows();
  lib.report('Settings shows the Android app status', r0.includes('Notifications Allowed') && r0.includes('Live updates Off in Android') && r0.includes('Timer notification Showing · not promoted'), JSON.stringify(r0));
  await section.locator('ion-item', { hasText: /^Notifications/ }).click(); await p.waitForTimeout(300);
  lib.report('“Notifications” opens the system notification settings', (await calls()).some(([m]) => m === 'openNotificationSettings'));
  await p.screenshot({ path: `${lib.OUT}/native-settings.png` });

  // Two per-area settings: Running time (Appearance: Off / App only / On) and
  // Live updates (Android app: on/off). A live update ticks only for running time On.
  const areaFlags = () => p.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { q.result.transaction('areas').objectStore('areas').getAll().onsuccess = (e) => r(Object.fromEntries(e.target.result.map((a) => [a.name, { rt: a.runningTime, lu: a.liveUpdate, legacy: a.liveUpdates }]))); }; }));
  const lastShow = async () => (await calls()).filter(([m]) => m === 'showTimer').at(-1)?.[1];
  const openDlg = async (row, cls) => { await p.locator('ion-item', { hasText: new RegExp(`^${row}`) }).first().click(); await p.waitForSelector(`ion-modal.${cls} ion-title`); await p.waitForTimeout(400); };
  const closeDlg = async (cls) => { await p.locator(`ion-modal.${cls}`).getByRole('button', { name: 'Close' }).click(); await p.waitForSelector(`ion-modal.${cls} ion-title`, { state: 'detached' }); await p.waitForTimeout(300); };
  const rtChip = (area, label) => p.locator(`ion-modal.running-time-dialog [aria-label="${area} running time"] ion-chip`, { hasText: new RegExp(`^${label}$`) });

  const icons = await p.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { q.result.transaction('areas').objectStore('areas').getAll().onsuccess = (e) => r(Object.fromEntries(e.target.result.map((a) => [a.name, a.icon]))); }; }));
  lib.report('fresh install: Hobby has the palette icon, Self-care the paw', icons.Hobby === 'color-palette' && icons['Self-care'] === 'paw', JSON.stringify([icons.Hobby, icons['Self-care']]));
  // Running time dialog: three chips per area in the Android app, all On by default.
  await openDlg('Running time', 'running-time-dialog');
  const rtState = await p.locator('ion-modal.running-time-dialog .running-time-chips').evaluateAll((es) => es.map((e) => [...e.querySelectorAll('ion-chip')].map((c) => (c.outline ? c.textContent : `[${c.textContent}]`)).join('|')));
  lib.report('Running time: Off · App only · On per area; by default Sleep and Work Off, the rest On', rtState.length === 12 && rtState[0] === '[Off]|App only|On' && rtState[1] === '[Off]|App only|On' && rtState.slice(2).every((x) => x === 'Off|App only|[On]'), rtState.slice(0, 3).join(' · '));
  await rtChip('Work', 'App only').click(); await p.waitForTimeout(300);
  const sel = await rtChip('Sleep', 'Off').evaluate((c) => ({ bg: c.style.getPropertyValue('--background'), selected: !c.outline, dot: c.closest('ion-item').querySelector('.dot').style.background }));
  const toRgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
  lib.report('…the selected chip is filled with the area colour (as displayed)', sel.selected && toRgb(sel.bg) === sel.dot, JSON.stringify(sel));
  await p.screenshot({ path: `${lib.OUT}/native-running-time-dialog.png` });
  await closeDlg('running-time-dialog');
  let f = await areaFlags();
  lib.report('saved on the areas (Sleep off, Work now app only, Home default)', f.Sleep.rt === 'off' && f.Work.rt === 'app' && f.Home.rt === undefined, JSON.stringify([f.Sleep, f.Work]));
  lib.report('the Settings row sums it up', (await p.locator('ion-item', { hasText: /^Running time/ }).innerText()).includes('2 areas quieter'));

  // Live updates dialog: one switch per area.
  await openDlg('Live updates', 'live-updates-dialog');
  const luCount = await p.locator('ion-modal.live-updates-dialog ion-toggle').count();
  lib.report('Live updates: a switch per area, all off by default', luCount === 12 && (await p.locator('ion-modal.live-updates-dialog ion-toggle').evaluateAll((es) => es.every((e) => !e.checked))));
  await p.locator('ion-modal.live-updates-dialog ion-toggle[aria-label="Sleep"]').click(); await p.waitForTimeout(300);
  await p.locator('ion-modal.live-updates-dialog ion-toggle[aria-label="Guitar"]').click(); await p.waitForTimeout(300);
  await p.screenshot({ path: `${lib.OUT}/native-live-updates-dialog.png` });
  await closeDlg('live-updates-dialog');
  f = await areaFlags();
  await p.evaluate(() => { window.__liveAllowed = true; });
  await p.locator('ion-tab-button[tab="timer"]').click(); await p.waitForTimeout(300);
  await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(500);
  lib.report('the Live updates row sums it up: “2 of 12 areas”', (await rows()).includes('Live updates 2 of 12 areas'), JSON.stringify(await rows()));
  lib.report('saved on the areas (Sleep, Guitar: live update on; the rest off)', f.Sleep.lu === true && f.Guitar.lu === true && f.Work.lu === false && f.Reading.lu === false, JSON.stringify([f.Sleep, f.Guitar, f.Work]));

  // What reaches the notification, per area.
  await p.locator('ion-tab-button[tab="timer"]').click(); await p.waitForTimeout(400);
  const run = async (name) => { await tap(name); await ff(2); await p.waitForTimeout(300); return lastShow(); };
  const sl = await run('Sleep');
  lib.report('Sleep (time off, live update on) → icon-only live update', sl?.title === 'Sleep' && sl.promote === true && sl.showTime === false, j(sl));
  const quiet = { caption: await p.locator('.timer-caption').innerText(), number: await p.locator('.timer-digits').innerText(), muted: await p.locator('.timer-digits').evaluate((e) => e.classList.contains('quiet')), tab: await p.locator('ion-tab-button[tab="timer"]').innerText(), today: await p.locator('.today-row', { hasText: 'Sleep' }).innerText() };
  const startHm = await p.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { q.result.transaction('active').objectStore('active').get('current').onsuccess = (e) => r(new Date(e.target.result.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); }; }));
  lib.report('…and in the app: “Started at” over the muted start time; the start time in the tab', quiet.caption.trim() === 'Started at' && quiet.number.trim() === startHm && quiet.muted && quiet.tab.trim() === startHm, JSON.stringify(quiet));
  lib.report('…while Today keeps the real total', /\d+m$/.test(quiet.today.replace(/\s+/g, ' ').trim()) && !/since/i.test(quiet.today), quiet.today.replace(/\s+/g, ' '));
  // Nothing else moves between a quiet and a ticking area (at two screen widths).
  const layout = async () => p.evaluate(() => { const top = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().top); return { pills: top('.area-pills'), caption: top('.timer-caption'), number: top('.timer-digits'), display: Math.round(document.querySelector('.timer-display').getBoundingClientRect().height) }; });
  const quietL = await layout();
  await p.screenshot({ path: `${lib.OUT}/native-quiet-timer.png` });
  const wk = await run('Work');
  lib.report('Work (app only, live update off) → plain notification, no ticking', wk?.title === 'Work' && wk.promote === false && wk.showTime === false, j(wk));
  lib.report('…but the app ticks', /^\d+:\d\d:\d\d$/.test(await p.locator('.timer-digits').innerText()), await p.locator('.timer-digits').innerText());
  const rd = await run('Reading');
  lib.report('Reading (defaults: time on, live update off) → plain notification that ticks', rd?.title === 'Reading' && rd.promote === false && rd.showTime === true, j(rd));
  const gt = await run('Guitar');
  lib.report('Guitar (time on, live update on) → live update that ticks', gt?.title === 'Guitar' && gt.promote === true && gt.showTime === true, j(gt));
  const tickL = await layout();
  lib.report('ticking: “Started at <time>” above the digits', /^Started at \d\d:\d\d/.test((await p.locator('.timer-caption').innerText()).trim()), await p.locator('.timer-caption').innerText());
  lib.report('quiet and ticking areas share one layout (caption, number and area buttons don’t move)', quietL.pills === tickL.pills && quietL.caption === tickL.caption && quietL.number === tickL.number, `${JSON.stringify(quietL)} vs ${JSON.stringify(tickL)}`);
  await p.setViewportSize({ width: 360, height: 760 }); await p.waitForTimeout(300);
  const tick360 = await layout();
  await tap('Sleep'); await ff(2); await p.waitForTimeout(400);
  const quiet360 = await layout();
  await p.locator('.stop-button').click(); await p.waitForTimeout(500);
  const idle360 = await layout();
  lib.report('idle: “Tap an area to start”, same layout too', (await p.locator('.timer-caption').innerText()).trim() === 'Tap an area to start' && idle360.pills === tick360.pills && idle360.caption === tick360.caption && idle360.number === tick360.number, `${JSON.stringify(idle360)} vs ${JSON.stringify(tick360)}`);
  await tap('Sleep'); await ff(2); await p.waitForTimeout(400);
  lib.report('…also on a 360 px screen', quiet360.pills === tick360.pills && quiet360.caption === tick360.caption && quiet360.number === tick360.number, `${JSON.stringify(quiet360)} vs ${JSON.stringify(tick360)}`);
  await p.setViewportSize({ width: 412, height: 839 }); await p.waitForTimeout(300);
  await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(400);

  // Settings shows the last time the app's page couldn't load (what the WebView said).
  const loadRow = await p.locator('ion-item', { hasText: 'couldn’t open' }).innerText().catch(() => '');
  lib.report('Settings shows the last load problem', /ERR_INTERNET_DISCONNECTED/.test(loadRow), loadRow.replace(/\s+/g, ' '));

  // The Day view's hold uses Android's long-press delay (1 s in this fake).
  await p.locator('ion-tab-button[tab="day"]').click(); await p.waitForTimeout(800);
  const anyBlock = p.locator('.day-block:not(.active), .day-chip:not(.active)').first();
  await anyBlock.scrollIntoViewIfNeeded(); await anyBlock.click(); await p.waitForTimeout(300);
  const held = p.locator('.day-block.selected, .day-chip.selected').first();
  const bb = await held.boundingBox();
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.waitForTimeout(600);
  const early = await held.evaluate((e) => e.classList.contains('lifted'));
  await p.waitForTimeout(600);
  const late = await held.evaluate((e) => e.classList.contains('lifted'));
  await p.mouse.up(); await p.waitForTimeout(400);
  lib.report('Day view: the hold follows Android’s long-press delay (not lifted at 0.6 s, lifted at 1.2 s)', !early && late, JSON.stringify({ early, late }));
  await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(400);

  // Tapping the notification (app already open) switches to the Timer tab.
  await p.evaluate(() => window.__openTimer()); await p.waitForTimeout(600);
  lib.report('tapping the notification opens the Timer tab', /\/timer$/.test(new URL(p.url()).pathname), p.url());
  await p.locator('.stop-button').click(); await p.waitForTimeout(500);
  await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(400);

  // An older APK (no peek/clear) still gets its stops applied, via takePendingStop.
  const oldCtx = await b.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome' });
  await oldCtx.addInitScript(() => { window.__oldApk = true; });
  await oldCtx.addInitScript(FAKE_NATIVE);
  const po = await oldCtx.newPage(); po.on('pageerror', (e) => errs.push(e.message));
  await po.goto(lib.BASE); await po.waitForSelector('.area-pill-btn');
  await po.locator('.timer-layout .area-pill-btn[aria-label="Reading"]').click(); await po.waitForSelector('.stop-button'); await po.waitForTimeout(300);
  const so = await po.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { q.result.transaction('active').objectStore('active').get('current').onsuccess = (e) => r(Date.parse(e.target.result.start)); }; }));
  await po.evaluate(([s]) => window.__notificationStop(s - 0, s + 5 * 60000), [so - 10 * 60000]); // a stale one first: ignored
  await po.evaluate(([s]) => window.__notificationStop(s, Date.now()), [so]);
  await po.waitForTimeout(700);
  const oldState = await po.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { q.result.transaction('active').objectStore('active').get('current').onsuccess = (e) => r(e.target.result ? 'running' : 'stopped'); }; }));
  const usedTake = await po.evaluate(() => window.__calls.some(([m]) => m === 'takePendingStop') && !window.__calls.some(([m]) => m === 'peekPendingStop' && false));
  lib.report('older APK (no peek/clear): the stop is applied via takePendingStop', oldState === 'stopped' && usedTake, oldState);
  await oldCtx.close();

  // The browser-storage note is for the PWA only.
  const storedNative = await p.locator('ion-item', { hasText: 'Stored on this device' }).innerText();
  lib.report('Android app: no “may be cleared by the browser” note', /intervals/.test(storedNative) && !/browser|cleanup/.test(storedNative), storedNative.replace(/\s+/g, ' '));

  // In a plain browser there's no such section.
  const plain = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  await plain.goto(lib.BASE); await plain.waitForSelector('.area-pill-btn');
  await plain.locator('ion-tab-button[tab="settings"]').click(); await plain.waitForTimeout(500);
  const storedPwa = await plain.locator('ion-item', { hasText: 'Stored on this device' }).innerText();
  lib.report('PWA: the storage note is still there', /may be cleared by the browser|protected from cleanup/.test(storedPwa), storedPwa.replace(/\s+/g, ' '));
  // PWA: Running time without "App only" (no notification), and Off still quiets the Timer.
  await plain.locator('ion-item', { hasText: /^Running time/ }).click(); await plain.waitForSelector('ion-modal.running-time-dialog ion-title'); await plain.waitForTimeout(400);
  const pwaChips = await plain.locator('ion-modal.running-time-dialog [aria-label="Guitar running time"] ion-chip').allInnerTexts();
  lib.report('PWA: running time offers Off · On only', pwaChips.join('|') === 'Off|On', pwaChips.join('|'));
  await plain.locator('ion-modal.running-time-dialog [aria-label="Guitar running time"] ion-chip', { hasText: /^Off$/ }).click(); await plain.waitForTimeout(300);
  await plain.locator('ion-modal.running-time-dialog').getByRole('button', { name: 'Close' }).click(); await plain.waitForTimeout(400);
  await plain.locator('ion-tab-button[tab="timer"]').click(); await plain.waitForTimeout(300);
  await plain.locator('.timer-layout .area-pill-btn[aria-label="Guitar"]').click(); await plain.waitForTimeout(500);
  lib.report('PWA: running time Off → “Started at” over the start time', (await plain.locator('.timer-caption').innerText()).trim() === 'Started at' && /^\d\d:\d\d/.test((await plain.locator('.timer-digits').innerText()).trim()), await plain.locator('.timer-digits').innerText());
  await plain.locator('ion-tab-button[tab="settings"]').click(); await plain.waitForTimeout(400);
  lib.report('browser/PWA: no Android section', (await plain.locator('ion-list-header', { hasText: 'Android app' }).count()) === 0);

  lib.report('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
