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
  const promise = ['showTimer', 'hideTimer', 'takePendingStop', 'shareFile', 'status', 'openNotificationSettings', 'removeListener', ...(oldApk ? [] : ['peekPendingStop', 'clearPendingStop'])];
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
      if (method === 'status') return Promise.resolve({ sdk: 37, permission: 'granted', notificationsEnabled: true, liveUpdatesAllowed: !!window.__liveAllowed, promotable: true, posted: true, promoted: false });
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
  const calls = () => p.evaluate(() => window.__calls.filter(([m]) => !['takePendingStop', 'peekPendingStop', 'clearPendingStop'].includes(m)));
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
  lib.report('Settings shows the Android app status', r0.includes('Notifications Allowed') && r0.includes('Running time Live updates off') && r0.includes('Timer notification Showing · not promoted'), JSON.stringify(r0));
  await section.locator('ion-item', { hasText: /^Notifications/ }).click(); await p.waitForTimeout(300);
  lib.report('“Notifications” opens the system notification settings', (await calls()).some(([m]) => m === 'openNotificationSettings'));
  await p.screenshot({ path: `${lib.OUT}/native-settings.png` });

  // Running time: every timer is a live update; a global switch and one per area
  // choose whether its time ticks.
  const dlg = 'ion-modal.running-time-dialog';
  const openDialog = async () => { await section.locator('ion-item', { hasText: /^Running time/ }).click(); await p.waitForSelector(`${dlg} ion-title`); await p.waitForTimeout(400); };
  const closeDialog = async () => { await p.locator(dlg).getByRole('button', { name: 'Close' }).click(); await p.waitForSelector(`${dlg} ion-title`, { state: 'detached' }); await p.waitForTimeout(300); };
  const toggle = (name) => p.locator(`${dlg} ion-toggle[aria-label="${name}"]`);
  await openDialog();
  const areaToggles = await p.locator(`${dlg} .live-area ion-toggle`).evaluateAll((es) => es.map((e) => `${e.getAttribute('aria-label')}:${e.checked ? 'on' : 'off'}`));
  lib.report('the dialog lists every area, all showing the time by default', areaToggles.length === 12 && areaToggles.every((t) => t.endsWith(':on')) && areaToggles[0].startsWith('Sleep'), areaToggles.join(' '));
  lib.report('…and says when Android itself has live updates off (with a link)', (await p.locator(`${dlg} ion-item`, { hasText: 'Live updates are off in Android settings' }).count()) === 1);
  await toggle('Sleep').click(); await p.waitForTimeout(400);
  const sleepFlag = await p.evaluate(() => new Promise((r) => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { q.result.transaction('areas').objectStore('areas').getAll().onsuccess = (e) => r(e.target.result.find((a) => a.name === 'Sleep').liveUpdates); }; }));
  lib.report('switching Sleep off is saved on the area (so it travels with backups)', sleepFlag === false, String(sleepFlag));
  await p.screenshot({ path: `${lib.OUT}/native-running-time-dialog.png` });
  await closeDialog();
  // With Android allowing live updates, the row sums up the per-area choice.
  await p.evaluate(() => { window.__liveAllowed = true; });
  await p.locator('ion-tab-button[tab="timer"]').click(); await p.waitForTimeout(300);
  await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(500);
  lib.report('the Settings row sums up the choice: “11 of 12 areas”', (await rows()).includes('Running time 11 of 12 areas'), JSON.stringify(await rows()));

  // Sleep → quiet notification (promote: false); Reading → live update.
  const lastShow = async () => (await calls()).filter(([m]) => m === 'showTimer').at(-1)?.[1];
  await p.locator('ion-tab-button[tab="timer"]').click(); await p.waitForTimeout(400);
  await tap('Sleep'); await p.waitForTimeout(300);
  const sleepShow = await lastShow();
  lib.report('Sleep without the time → still a live update, no ticking (promote: true, showTime: false)', sleepShow?.title === 'Sleep' && sleepShow.promote === true && sleepShow.showTime === false, j(sleepShow));
  await tap('Reading'); await p.waitForTimeout(300);
  const readShow = await lastShow();
  lib.report('Reading → live update with the running time', readShow?.title === 'Reading' && readShow.promote === true && readShow.showTime === true, j(readShow));

  // Global switch off → quiet for every area.
  await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(400);
  await openDialog();
  await toggle('Show the running time').click(); await p.waitForTimeout(400);
  const disabled = await p.locator(`${dlg} .live-area`).evaluateAll((es) => es.every((e) => e.disabled));
  lib.report('global switch off greys out the areas', disabled);
  const offShow = await lastShow();
  lib.report('…and the running timer stops ticking (still a live update)', offShow?.title === 'Reading' && offShow.promote === true && offShow.showTime === false, j(offShow));
  await toggle('Show the running time').click(); await p.waitForTimeout(400);
  lib.report('back on → the time ticks again, Sleep still off', (await lastShow()).showTime === true && !(await toggle('Sleep').evaluate((e) => e.checked)));
  await closeDialog();

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
  lib.report('browser/PWA: no Android section', (await plain.locator('ion-list-header', { hasText: 'Android app' }).count()) === 0);

  lib.report('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
