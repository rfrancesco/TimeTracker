const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
const fs = require('fs');
const S = lib.OUT;
const URL = lib.BASE;
const dump = p => p.evaluate(() => new Promise(r => { const q = indexedDB.open('timetracker'); q.onsuccess = () => { const t = q.result.transaction(['areas', 'subAreas', 'intervals', 'active']); const o = {}; let n = 0; for (const s of ['areas', 'subAreas', 'intervals', 'active']) t.objectStore(s).getAll().onsuccess = e => { o[s] = e.target.result.sort((a, b) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key))); if (++n === 4) r(o); }; }; }));
const canon = o => JSON.stringify(o);
async function open(ctx) { const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); await p.clock.install({ time: new Date('2026-11-15T18:00:00+01:00') }); await p.goto(URL); await p.waitForSelector('.area-pill-btn'); return p; }
async function toSettings(p) { await p.locator('ion-tab-button[tab="settings"]').click(); await p.waitForTimeout(500); }
async function exportFile(p, path) {
  await toSettings(p);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.locator('ion-item', { hasText: 'Export backup' }).click()]);
  await dl.saveAs(path); return dl.suggestedFilename();
}
async function importFile(p, path, confirm = true) {
  await toSettings(p);
  // Record the next toast that gets presented (Ionic reuses toast elements, so watch the
  // present event rather than looking for a new element).
  await p.evaluate(() => {
    window.__toast = null;
    if (!window.__toastHook) { document.addEventListener('ionToastWillPresent', (e) => { window.__toast = e.target.message; }); window.__toastHook = true; }
  });
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('ion-item', { hasText: 'Restore backup' }).click()]);
  await fc.setFiles(path);
  // Every file leads to a dialog: the confirmation, or "Import failed" for a bad file.
  await p.waitForSelector('ion-alert .alert-title');
  const header = await p.locator('ion-alert .alert-title').last().innerText();
  const alert = await p.locator('ion-alert .alert-message').last().innerText();
  if (header === 'Import failed') { await p.locator('ion-alert button', { hasText: 'OK' }).click(); await p.waitForSelector('ion-alert', { state: 'detached' }); return { failed: alert }; }
  if (!confirm) return { alert };
  await p.locator('ion-alert button', { hasText: 'Replace' }).click();
  // The outcome: a new toast (success) or an "Import failed" dialog. Large files take a
  // while under the fake clock, hence the longer wait here.
  const outcome = await p.waitForFunction(() => {
    if (window.__toast) return { toast: window.__toast };
    const f = [...document.querySelectorAll('ion-alert')].find(a => a.querySelector('.alert-title')?.textContent === 'Import failed');
    if (f) return { failed: f.querySelector('.alert-message')?.textContent ?? '' };
    return null;
  }, null, { timeout: 120000 }).then(h => h.jsonValue());
  if (outcome.failed !== undefined) await p.locator('ion-alert button', { hasText: 'OK' }).click();
  return { alert, ...outcome };
}
const check = lib.report;
fs.mkdirSync(`${lib.OUT}/bk`, { recursive: true });
(async () => {
  const b = await chromium.launch();
  // ---------- 1. Build varied data in phone A ----------
  const A = await b.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome', acceptDownloads: true });
  const pa = await open(A);
  await pa.evaluate(() => new Promise(r => { const q = indexedDB.open('timetracker'); q.onsuccess = () => {
    const t = q.result.transaction(['areas', 'subAreas', 'intervals', 'active'], 'readwrite');
    const A = t.objectStore('areas'), SA = t.objectStore('subAreas'), I = t.objectStore('intervals');
    A.getAll().onsuccess = e => { const by = Object.fromEntries(e.target.result.map(a => [a.name, a]));
      const w = by.Work; w.name = 'Lavoro 💼'; w.color = '#123456'; A.put(w);                        // renamed + custom colour
      A.put({ id: 'custom-area', name: 'Languages', icon: 'language', color: '#00ACC1', order: 8, breakAfter: true, updatedAt: '2026-11-01T10:00:00.000Z' });
      A.put({ id: 'archived-area', name: 'Old hobby', icon: 'brush', color: '#6D4C41', order: 9, archived: true, updatedAt: '2026-10-01T10:00:00.000Z' });
      SA.put({ id: 'sub-es', areaId: 'custom-area', name: 'Español', order: 0, updatedAt: '2026-11-01T10:00:00.000Z' });
      SA.put({ id: 'sub-old', areaId: by.Guitar.id, name: 'Retired sub', order: 9, archived: true, updatedAt: '2026-10-01T10:00:00.000Z' });
      const add = (id, areaId, subAreaId, s, e, note) => I.put({ id, areaId, subAreaId, start: s, end: e, note, updatedAt: e });
      add('dst-sleep', by.Sleep.id, null, '2026-03-28T22:00:00.000Z', '2026-03-29T06:00:00.000Z');            // across DST night
      add('note-unicode', 'custom-area', 'sub-es', '2026-11-14T08:00:00.000Z', '2026-11-14T09:00:00.000Z', 'Subjuntivo 😅\nline two — "quotes" & <tags>');
      add('archived-hist', 'archived-area', null, '2026-09-01T16:00:00.000Z', '2026-09-01T18:00:00.000Z');
      add('archived-sub-hist', by.Guitar.id, 'sub-old', '2026-09-02T16:00:00.000Z', '2026-09-02T16:30:00.000Z');
      add('midnight', by.Cinema.id, null, '2026-11-13T21:30:00.000Z', '2026-11-13T23:45:00.000Z');
      for (let d = 0; d < 30; d++) add('bulk-' + d, by.Thesis.id, null, new Date(Date.UTC(2026, 9, 10 + d, 9)).toISOString(), new Date(Date.UTC(2026, 9, 10 + d, 12, 17, 33, 250)).toISOString());
      t.objectStore('active').put({ key: 'current', areaId: by.Reading.id, subAreaId: null, start: '2026-11-15T16:20:00.000Z' });
    }; t.oncomplete = r; }; }));
  const original = await dump(pa);
  console.log(`data: ${original.areas.length} areas, ${original.subAreas.length} sub-areas, ${original.intervals.length} intervals, running timer: ${original.active.length}`);

  // ---------- 2. Export ----------
  const file = `${S}/bk/export.json`;
  const name = await exportFile(pa, file);
  const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('export downloads a file', fs.statSync(file).size > 0, `${name}, ${fs.statSync(file).size} bytes`);
  check('file name uses the local date', name === 'timetracker-2026-11-15.json', name);
  const sorted = o => ({ areas: [...o.areas].sort((a, b) => a.id.localeCompare(b.id)), subAreas: [...o.subAreas].sort((a, b) => a.id.localeCompare(b.id)), intervals: [...o.intervals].sort((a, b) => a.id.localeCompare(b.id)), active: o.active });
  check('export contains exactly the database', canon(sorted(exported)) === canon(original));
  check('timestamps are UTC ISO strings', exported.intervals.every(i => /Z$/.test(i.start) && /Z$/.test(i.end)));
  check('unicode note survives', exported.intervals.find(i => i.id === 'note-unicode').note === 'Subjuntivo 😅\nline two — "quotes" & <tags>');

  // ---------- 3. Restore on a brand-new phone B ----------
  const B = await b.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome' });
  const pb = await open(B);
  const before = await dump(pb);
  const r1 = await importFile(pb, file);
  check('confirmation names the backup size', !!r1.alert && r1.alert.includes(String(original.intervals.length)), r1.alert);
  const restored = await dump(pb);
  check('new phone: restored data identical to original', canon(restored) === canon(original));
  check('restore says so', r1.toast === 'Backup restored', r1.toast || r1.failed);
  check('new phone: had different (default) data before', canon(before) !== canon(original));
  await pb.locator('ion-tab-button[tab="timer"]').click(); await pb.waitForTimeout(500);
  check('new phone: running timer resumes', (await pb.locator('.timer-label').innerText().catch(() => '')).includes('Reading'), await pb.locator('.timer-digits').innerText().catch(() => ''));
  check('new phone: renamed + custom areas shown, archived hidden', await pb.evaluate(() => { const n = [...document.querySelectorAll('.timer-layout .area-pill-btn')].map(x => x.getAttribute('aria-label')); return n.includes('Lavoro 💼') && n.includes('Languages') && !n.includes('Old hobby'); }));

  // ---------- 4. Wipe + restore on phone A ----------
  await toSettings(pa);
  await pa.locator('ion-item', { hasText: 'start fresh' }).click(); await pa.waitForTimeout(500);
  await pa.locator('ion-action-sheet button', { hasText: 'Reset everything' }).click(); await pa.waitForTimeout(500);
  await pa.locator('ion-alert button', { hasText: 'Delete' }).click(); await pa.waitForTimeout(800);
  const wiped = await dump(pa);
  check('reset wiped the data', wiped.intervals.length === 0 && wiped.active.length === 0);
  const r2 = await importFile(pa, file);
  check('same phone: wipe → restore gives identical data', canon(await dump(pa)) === canon(original), r2.toast || r2.failed);

  // ---------- 5. Cancel leaves data untouched ----------
  const cur = await dump(pb);
  fs.writeFileSync(`${S}/bk/other.json`, JSON.stringify({ ...exported, intervals: exported.intervals.slice(0, 3) }));
  await importFile(pb, `${S}/bk/other.json`, false);
  await pb.locator('ion-alert button', { hasText: 'Cancel' }).click(); await pb.waitForTimeout(400);
  check('cancelling the confirmation changes nothing', canon(await dump(pb)) === canon(cur));

  // ---------- 6. Bad files never touch data ----------
  const bad = {
    'not JSON': 'hello, this is not json',
    'empty file': '',
    'a JSON array': '[1,2,3]',
    'missing sub-areas': JSON.stringify({ ...exported, subAreas: undefined }),
    'interval for unknown area': JSON.stringify({ ...exported, intervals: [...exported.intervals, { id: 'x', areaId: 'nope', subAreaId: null, start: '2026-11-01T10:00:00.000Z', end: '2026-11-01T11:00:00.000Z', updatedAt: '2026-11-01T11:00:00.000Z' }] }),
    'duplicate ids': JSON.stringify({ ...exported, intervals: [...exported.intervals, exported.intervals[0]] }),
    'invalid timestamp': JSON.stringify({ ...exported, intervals: [...exported.intervals, { ...exported.intervals[0], id: 'y', start: 'yesterday-ish' }] }),
    'file from another app': JSON.stringify({ ...exported, app: 'someotherapp' }),
    'backup from a newer app version': JSON.stringify({ ...exported, format: 99 }),
    'area with broken colour': JSON.stringify({ ...exported, areas: exported.areas.map((a, i) => i ? a : { ...a, color: 'blue' }) }),
    'area with a broken live updates setting': JSON.stringify({ ...exported, areas: exported.areas.map((a, i) => i ? a : { ...a, liveUpdates: 'no' }) }),
  };
  for (const [label, content] of Object.entries(bad)) {
    const f = `${S}/bk/bad-${label.replace(/\W+/g, '-')}.json`; fs.writeFileSync(f, content);
    const snapshot = await dump(pb);
    const r = await importFile(pb, f);
    const unchanged = canon(await dump(pb)) === canon(snapshot);
    check(`bad file (${label}): rejected before asking, data unchanged`, unchanged && !!r.failed && !r.alert, r.failed || JSON.stringify(r));
  }

  // ---------- 6b. Backup made by an older version of the app ----------
  const legacy = { version: 1, exportedAt: exported.exportedAt, areas: exported.areas, subAreas: exported.subAreas, intervals: exported.intervals.map(({ updatedAt, ...rest }) => rest), active: exported.active };
  fs.writeFileSync(`${S}/bk/legacy.json`, JSON.stringify(legacy));
  const rl = await importFile(pb, `${S}/bk/legacy.json`);
  const ld = await dump(pb);
  check('older-format backup still restores', /^Backup restored/.test(rl.toast || '') && ld.intervals.length === exported.intervals.length && ld.areas.length === exported.areas.length, rl.failed || rl.toast);

  // ---------- 7. Large: ~3 years of tracking ----------
  const big = { ...exported, intervals: [] };
  const areaIds = exported.areas.filter(a => !a.archived).map(a => a.id);
  let t = Date.UTC(2023, 10, 15);
  while (big.intervals.length < 12000) { const len = (20 + (big.intervals.length * 37) % 160) * 60000; big.intervals.push({ id: 'big-' + big.intervals.length, areaId: areaIds[big.intervals.length % areaIds.length], subAreaId: null, start: new Date(t).toISOString(), end: new Date(t + len).toISOString(), updatedAt: new Date(t + len).toISOString() }); t += len + 5 * 60000; }
  big.active = [];
  fs.writeFileSync(`${S}/bk/big.json`, JSON.stringify(big));
  let t0 = Date.now(); const bigBack = await importFile(pb, `${S}/bk/big.json`); const tImport = Date.now() - t0;
  const bigDump = await dump(pb);
  check('large backup restores completely', bigDump.intervals.length === big.intervals.length && bigBack.toast === 'Backup restored', `${big.intervals.length} intervals, ${(fs.statSync(`${S}/bk/big.json`).size / 1e6).toFixed(1)} MB, import+confirm ${tImport} ms | ${bigBack.toast || bigBack.failed}`);
  t0 = Date.now(); await exportFile(pb, `${S}/bk/big-export.json`); const tExport = Date.now() - t0;
  const reexp = JSON.parse(fs.readFileSync(`${S}/bk/big-export.json`, 'utf8'));
  check('large backup exports back out identically', reexp.intervals.length === big.intervals.length, `export ${tExport} ms`);

  // ---------- 8. Large AND overlapping (slow path) ----------
  const messy = { ...big, intervals: big.intervals.map((iv, i) => i % 10 ? iv : { ...iv, end: new Date(Date.parse(iv.end) + 40 * 60000).toISOString() }) };
  fs.writeFileSync(`${S}/bk/messy.json`, JSON.stringify(messy));
  t0 = Date.now(); const messyBack = await importFile(pb, `${S}/bk/messy.json`);
  const md = await dump(pb); const tMessy = Date.now() - t0;
  const ms = md.intervals.map(i => [Date.parse(i.start), Date.parse(i.end)]).sort((a, b) => a[0] - b[0]);
  const noOverlap = ms.every((x, i) => !i || ms[i - 1][1] <= x[0]);
  check('large backup with overlaps: restored without any overlap', noOverlap, `${md.intervals.length} intervals after clean-up, ${tMessy} ms`);
  check('…and the message says how many records were fixed', /^Backup restored · \d+ overlapping records fixed$/.test(messyBack.toast || ''), messyBack.toast || messyBack.failed);

  check('no page errors', pa.errs.length + pb.errs.length === 0, [...pa.errs, ...pb.errs].join(' | '));
  await b.close();
})();
