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
  const saved = sessionStorage.getItem('pendingStop'); // a Stop recorded while the app was closed
  state.pending = saved ? JSON.parse(saved) : null;
  sessionStorage.removeItem('pendingStop');
  const promise = ['showTimer', 'hideTimer', 'takePendingStop', 'shareFile', 'status', 'openNotificationSettings', 'removeListener'];
  window.Capacitor = {
    PluginHeaders: [{ name: 'TimeTracker', methods: [...promise.map((name) => ({ name, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' }] }],
    nativePromise(_plugin, method, opts) {
      calls.push([method, opts]);
      if (method === 'takePendingStop') {
        const p = state.pending;
        state.pending = null;
        return Promise.resolve(p || {});
      }
      if (method === 'status') return Promise.resolve({ sdk: 37, permission: 'granted', notificationsEnabled: true, liveUpdatesAllowed: false, promotable: true, posted: true, promoted: false });
      return Promise.resolve(method === 'showTimer' ? { shown: true } : undefined);
    },
    nativeCallback(_plugin, method, _opts, cb) {
      if (method === 'addListener') state.listeners.push(cb);
      return 'cb' + state.listeners.length;
    },
  };
  window.__notificationStop = (start, end) => {
    state.pending = { start, end };
    state.listeners.forEach((cb) => cb({}));
  };
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
  const calls = () => p.evaluate(() => window.__calls.filter(([m]) => m !== 'takePendingStop'));
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

  // Settings → Android app: diagnostics from the native side.
  const section = p.locator('ion-list', { has: p.locator('ion-list-header', { hasText: 'Android app' }) });
  const rows = (await section.locator('ion-item').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  lib.report('Settings shows the Android app status', rows.includes('Notifications Allowed') && rows.includes('Live updates Off') && rows.includes('Timer notification Showing · not promoted'), JSON.stringify(rows));
  await section.locator('ion-item', { hasText: 'Live updates' }).click(); await p.waitForTimeout(300);
  lib.report('tapping it opens the system notification settings', (await calls()).some(([m]) => m === 'openNotificationSettings'));
  await p.screenshot({ path: `${lib.OUT}/native-settings.png` });

  // In a plain browser there's no such section.
  const plain = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  await plain.goto(lib.BASE); await plain.waitForSelector('.area-pill-btn');
  await plain.locator('ion-tab-button[tab="settings"]').click(); await plain.waitForTimeout(500);
  lib.report('browser/PWA: no Android section', (await plain.locator('ion-list-header', { hasText: 'Android app' }).count()) === 0);

  lib.report('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
