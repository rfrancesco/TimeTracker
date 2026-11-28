const lib = require('./lib.cjs');
// The timer rules as pure functions (src/timer.ts): exact boundaries of the 1-minute
// rule, every refusal, notes, and a random sweep checking that no plan can break
// invariant 2 (no overlap, no future time, the running timer after the last interval).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(lib.DEV); await p.waitForTimeout(1500);
  const r = await p.evaluate(async () => {
    const T = await import('/src/timer.ts');
    const out = [];
    const check = (label, ok, extra = '') => out.push([label, !!ok, extra]);
    const M = 60_000, now = Date.UTC(2026, 10, 16, 17, 0), iso = (t) => new Date(t).toISOString();
    const run = (areaId, start, sub = null, note) => ({ key: 'current', areaId, subAreaId: sub, start: iso(start), ...(note ? { note } : {}) });
    const g = run('G', now - 30 * M, 's1', 'barre chords');

    // Start
    check('start while idle', T.planStart(null, 'G', null, now - 5 * M, -Infinity, now).next?.start === iso(now - 5 * M));
    check('start refused while running', T.planStart(g, 'G', null, now, -Infinity, now).error === 'running');
    check('start refused in the future', T.planStart(null, 'G', null, now + 1, -Infinity, now).error === 'future');
    check('start refused before the last interval ends', T.planStart(null, 'G', null, now - 10 * M, now - 5 * M, now).error === 'overlap');
    check('start exactly at the last end is fine', T.planStart(null, 'G', null, now - 5 * M, now - 5 * M, now).ok);

    // Switch: the 1-minute rule, at its exact edge
    const s59 = T.planSwitch(run('G', now - 59_999), 'R', null, now, now);
    const s60 = T.planSwitch(run('G', now - 60_000), 'R', null, now, now);
    check('switch at 59.999 s relabels (same start, nothing saved)', s59.ok && !s59.saved && s59.next.start === iso(now - 59_999) && s59.next.areaId === 'R');
    check('switch at 60 s splits (saves the old, new starts at the moment)', s60.ok && s60.saved?.end === now && s60.next.start === iso(now));
    check('a relabel keeps the note; a split starts without one', T.planSwitch(run('G', now - 10_000, null, 'n'), 'R', null, now, now).next.note === 'n' && !T.planSwitch(g, 'R', null, now, now).next.note);
    check('switch refused before the running start', T.planSwitch(g, 'R', null, now - 31 * M, now).error === 'beforeStart');
    check('switch refused in the future', T.planSwitch(g, 'R', null, now + 1, now).error === 'future');
    check('switch refused while idle', T.planSwitch(null, 'R', null, now, now).error === 'idle');
    check('switching only the sub-area works the same way', T.planSwitch(g, 'G', 's2', now - 10 * M, now).saved?.end === now - 10 * M);

    // Restart (move the running start)
    const rs = T.planRestart(g, now - 45 * M, 's2', -Infinity, now);
    check('restart moves the start, sets the sub-area, keeps the note', rs.next.start === iso(now - 45 * M) && rs.next.subAreaId === 's2' && rs.next.note === 'barre chords');
    check('restart refused before the last interval', T.planRestart(g, now - 45 * M, null, now - 40 * M, now).error === 'overlap');
    check('restart refused in the future / while idle', T.planRestart(g, now + 1, null, -Infinity, now).error === 'future' && T.planRestart(null, now, null, -Infinity, now).error === 'idle');

    // Stop
    check('stop under a minute discards', (() => { const x = T.planStop(run('G', now - 59_999), now, now); return x.ok && !x.next && !x.saved; })());
    check('stop at a minute saves', T.planStop(run('G', now - 60_000), now, now).saved?.start === now - 60_000);
    check('stop is capped at now', T.planStop(g, now + 5 * M, now).saved?.end === now);
    check('stop before the start is refused', T.planStop(g, now - 31 * M, now).error === 'beforeStart');
    check('stop while idle changes nothing', (() => { const x = T.planStop(null, now, now); return x.ok && !x.next && !x.saved; })());

    // Track (tap)
    check('tap the same label: no change', T.sameTimer(T.planTrack(g, 'G', 's1', now).next, g));
    check('tap another sub-area after a minute splits', !!T.planTrack(g, 'G', 's2', now).saved);
    check('tap while idle starts now', T.planTrack(null, 'G', null, now).next.start === iso(now));

    // sameTimer
    check('sameTimer sees a note change', !T.sameTimer(g, { ...g, note: 'x' }) && T.sameTimer(g, { ...g }) && T.sameTimer(null, undefined));
    check('sameTimer ignores ISO formatting of the same instant', T.sameTimer(g, { ...g, start: new Date(g.start).toISOString().replace('.000Z', 'Z') }));

    // Random sweep: whatever is planned, invariant 2 holds afterwards.
    let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let bad = 0, n = 0;
    for (let i = 0; i < 3000; i++) {
      const lastEnd = rnd() < 0.2 ? -Infinity : now - Math.floor(rnd() * 600) * M;
      const a = rnd() < 0.25 ? null : run('A', (Number.isFinite(lastEnd) ? lastEnd : now - 600 * M) + Math.floor(rnd() * 120) * 15_000);
      if (a && Date.parse(a.start) > now) continue;
      const at = now - Math.floor(rnd() * 700) * M + (rnd() < 0.1 ? 120 * M : 0);
      const kind = Math.floor(rnd() * 5);
      const plan = [T.planStart(a, 'B', null, at, lastEnd, now), T.planRestart(a, at, null, lastEnd, now), T.planSwitch(a, 'B', null, at, now), T.planStop(a, at, now), T.planTrack(a, 'B', null, now)][kind];
      if (!plan.ok) continue;
      n++;
      const savedEnd = plan.saved ? plan.saved.end : lastEnd;
      const newLast = Math.max(Number.isFinite(lastEnd) ? lastEnd : -Infinity, savedEnd);
      const ns = plan.next ? Date.parse(plan.next.start) : null;
      if (plan.saved && (plan.saved.end > now || plan.saved.end - plan.saved.start < 60_000 || plan.saved.start !== Date.parse(a.start))) bad++;
      if (ns !== null && (ns > now || ns < newLast)) bad++;
    }
    check(`random sweep: ${n} valid plans keep invariant 2`, bad === 0 && n > 1000, `${bad} bad of ${n}`);
    return out;
  });
  for (const [label, ok, extra] of r) lib.report(label, ok, extra);
  lib.report('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
