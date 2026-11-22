/**
 * Shared helpers for the end-to-end suites (run them via tests/e2e/run.sh).
 * BASE_URL: the built app (vite preview), DEV_URL: the dev server (for suites that
 * import source modules), OUT: where screenshots/scratch files go.
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const DEV = process.env.DEV_URL || 'http://localhost:5174/';
const OUT = process.env.OUT || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
/** Print PASS/FAIL; any FAIL makes the suite exit non-zero. */
function report(label, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
  if (!ok) failures++;
}
process.on('beforeExit', () => {
  if (failures) process.exitCode = 1;
});

/**
 * Fail fast: every page gets a 5 s default timeout instead of Playwright's 30 s, so a
 * selector that doesn't match fails within seconds instead of silently costing half a
 * minute. Steps that really take longer (large imports under the fake clock) pass their
 * own timeout. Applies to every browser the suites launch (this module loads first).
 */
const DEFAULT_TIMEOUT = 5000;
const { chromium } = require('playwright');
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...args) => {
  const browser = await launch(...args);
  const withTimeout = (page) => (page.setDefaultTimeout(DEFAULT_TIMEOUT), page);
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...a) => withTimeout(await newPage(...a));
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => {
    const ctx = await newContext(...a);
    ctx.setDefaultTimeout(DEFAULT_TIMEOUT);
    return ctx;
  };
  return browser;
};

// ---- The app's IndexedDB, by area/sub-area name (runs in the page) ----

/** Open the app's database and run `fn(tx)` in one transaction on `stores`; resolves with fn's result. */
const inDb = (p, mode, fn, arg) =>
  p.evaluate(
    ([mode, src, arg]) =>
      new Promise((resolve, reject) => {
        const q = indexedDB.open('timetracker');
        q.onerror = () => reject(q.error);
        q.onsuccess = () => {
          const t = q.result.transaction(['areas', 'subAreas', 'intervals', 'active'], mode);
          const all = (store) => new Promise((r) => (t.objectStore(store).getAll().onsuccess = (e) => r(e.target.result)));
          let out;
          Promise.all([all('areas'), all('subAreas'), all('intervals'), all('active')]).then(([areas, subs, intervals, active]) => {
            // eslint-disable-next-line no-new-func
            out = new Function('ctx', `return (${src})(ctx)`)({ t, areas, subs, intervals, active: active[0] ?? null, arg });
          });
          t.oncomplete = () => resolve(out);
        };
      }),
    [mode, fn.toString(), arg],
  );

/**
 * Add intervals ({ area, sub?, start, end, id?, note? }, ISO times) and optionally the
 * running timer ({ area, sub?, start }).
 */
const seed = (p, { intervals = [], active = null } = {}) =>
  inDb(p, 'readwrite', ({ t, areas, subs, arg }) => {
    const area = (n) => areas.find((a) => a.name === n).id;
    const sub = (a, n) => (n ? subs.find((s) => s.areaId === area(a) && s.name === n).id : null);
    for (const [i, x] of arg.intervals.entries())
      t.objectStore('intervals').put({ id: x.id ?? `seed${i}`, areaId: area(x.area), subAreaId: sub(x.area, x.sub), start: x.start, end: x.end, note: x.note, updatedAt: x.start });
    if (arg.active) t.objectStore('active').put({ key: 'current', areaId: area(arg.active.area), subAreaId: sub(arg.active.area, arg.active.sub), start: arg.active.start });
  }, { intervals, active });

/** "[Thesis 16:00–17:30, Guitar · Songs 18:05–18:20] ▶ Reading since 18:20" (or "… idle"), in the page's time zone. */
const timeline = (p) =>
  inDb(p, 'readonly', ({ areas, subs, intervals, active }) => {
    const label = (x) => areas.find((a) => a.id === x.areaId)?.name + (x.subAreaId ? ' · ' + subs.find((s) => s.id === x.subAreaId)?.name : '');
    const hm = (iso) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const list = intervals.sort((x, y) => x.start.localeCompare(y.start)).map((i) => `${label(i)} ${hm(i.start)}–${hm(i.end)}`).join(', ');
    return `[${list}] ${active ? `▶ ${label(active)} since ${hm(active.start)}` : 'idle'}`;
  });

/** Read from the database: `fn({ areas, subs, intervals, active })` runs in the page. */
const read = (p, fn) => inDb(p, 'readonly', fn);

/** The running timer's start (ms), or null. */
const activeStart = (p) => inDb(p, 'readonly', ({ active }) => (active ? Date.parse(active.start) : null));

/** Change fields of a stored interval (simulates an edit made elsewhere). */
const patchInterval = (p, id, fields) =>
  inDb(p, 'readwrite', ({ t, intervals, arg }) => {
    t.objectStore('intervals').put({ ...intervals.find((i) => i.id === arg.id), ...arg.fields });
  }, { id, fields });

module.exports = { BASE, DEV, OUT, report, DEFAULT_TIMEOUT, seed, timeline, read, activeStart, patchInterval };
