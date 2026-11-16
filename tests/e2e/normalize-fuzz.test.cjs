const lib = require('./lib.cjs');
// normalize() (overlap clean-up for old data / imported backups) against a brute-force
// reference: paint each minute with the most recently edited interval covering it.
// Needs the dev server (imports src/constraints.ts directly).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto(lib.DEV); await p.waitForTimeout(1500);
  const r = await p.evaluate(async () => {
    const { normalize } = await import('/src/constraints.ts');
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const base = Date.UTC(2026, 10, 1); const M = 60000; let failures = 0;
    for (let run = 0; run < 300; run++) {
      const n = 2 + Math.floor(rnd() * 25), span = 600; const now = base + Math.floor(rnd() * span * 1.2) * M;
      const ivs = Array.from({ length: n }, (_, i) => { const s = Math.floor(rnd() * span), len = 1 + Math.floor(rnd() * 120);
        return { id: 'i' + i, areaId: 'a' + i, subAreaId: null, start: new Date(base + s * M).toISOString(), end: new Date(base + (s + len) * M).toISOString(), updatedAt: new Date(base + Math.floor(rnd() * 1e6) * M).toISOString() }; });
      const ranked = [...ivs].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.start.localeCompare(b.start));
      const ref = new Array(span + 130).fill(null);
      for (const iv of ranked) for (let t = (Date.parse(iv.start) - base) / M; t < Math.min(Date.parse(iv.end), now) / M - base / M; t++) ref[t] = iv.areaId;
      const out = normalize(ivs, undefined, now);
      const got = new Array(span + 130).fill(null); let bad = false;
      for (const iv of out.intervals) { if (Date.parse(iv.end) > now) bad = true; for (let t = (Date.parse(iv.start) - base) / M; t < (Date.parse(iv.end) - base) / M; t++) { if (got[t]) bad = true; got[t] = iv.areaId; } }
      if (bad || new Set(out.intervals.map(i => i.id)).size !== out.intervals.length || JSON.stringify(got) !== JSON.stringify(ref)) failures++;
    }
    const clean = Array.from({ length: 2000 }, (_, i) => ({ id: 'c' + i, areaId: 'x', subAreaId: null, start: new Date(base + i * 60 * M).toISOString(), end: new Date(base + (i * 60 + 45) * M).toISOString(), updatedAt: 'z' }));
    const c = normalize(clean, undefined, base + 1e6 * M);
    const messy = Array.from({ length: 12000 }, (_, i) => ({ id: 'm' + i, areaId: 'x', subAreaId: null, start: new Date(base + i * 30 * M).toISOString(), end: new Date(base + (i * 30 + (i % 10 ? 25 : 70)) * M).toISOString(), updatedAt: new Date(base + i).toISOString() }));
    const t1 = performance.now(); normalize(messy, undefined, base + 1e7 * M); const tMessy = performance.now() - t1;
    return { failures, cleanUntouched: c.changed === 0 && c.intervals.every((x, i) => x === clean[i]), tMessy: Math.round(tMessy) };
  });
  lib.report('normalize matches the brute-force reference on 300 random datasets', r.failures === 0, `${r.failures} mismatches`);
  lib.report('valid data passes through untouched', r.cleanUntouched);
  lib.report('12,000 overlapping intervals clean up quickly', r.tMessy < 1000, `${r.tMessy} ms`);
  await b.close();
})();
