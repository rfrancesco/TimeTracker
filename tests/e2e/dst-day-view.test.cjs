const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
const S = lib.OUT;
async function run(b, label, startUtc, wakeHoursReal) {
  const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Europe/Rome' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date(startUtc) });           // 23:00 local the evening before
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  await p.locator('.area-pill-btn[aria-label="Sleep"]').click(); await p.waitForTimeout(200);
  await p.clock.fastForward(wakeHoursReal * 3600e3);              // wake at 08:00 local
  await p.locator('.area-pill-btn[aria-label="Work"]').click(); await p.waitForTimeout(200);
  await p.clock.fastForward(30 * 60e3); await p.waitForTimeout(1200);
  const local = await p.evaluate(() => new Date().toString().slice(0, 33));
  const today = await p.locator('.today-row').allInnerTexts();
  await p.locator('ion-tab-button[tab="day"]').click(); await p.waitForTimeout(1000);
  const r = await p.evaluate(() => {
    const view = document.querySelector('.day-view');
    const marks = [...document.querySelectorAll('.hour-row')].map(h => ({ top: parseFloat(h.style.top), label: h.textContent, dst: h.classList.contains('dst-shift') }));
    const blocks = [...document.querySelectorAll('.day-block')].map(b => ({ top: parseFloat(b.style.top), height: parseFloat(b.style.height), text: b.innerText.replace(/\n/g, ' | ') }));
    return { height: parseFloat(view.style.height), nMarks: marks.length, labels: marks.slice(0, 5).map(m => m.label + (m.dst ? '*' : '')).join(', '), at8: marks.find(m => /^8\s?AM$/.test(m.label))?.top, blocks, title: document.querySelector('.title-button')?.innerText.replace(/\n/g, ' ') };
  });
  console.log(`\n== ${label} | local now: ${local}`);
  console.log('Today totals:', today.map(t => t.replace(/\n/g, ' ')).join(' ; '));
  const hours = { spring: 23, fall: 25, normal: 24 }[label];
  lib.report(`${label}: day is ${hours} h with ${hours} hour lines`, r.height === hours * 60 * 1.2 && r.nMarks === hours, `${r.height}px, ${r.nMarks} lines, ${r.labels}`);
  lib.report(`${label}: blocks line up with the 8 AM line`, Math.abs(r.blocks[r.blocks.length - 1].top - r.at8) < 1);
  console.log(`8 AM line at ${r.at8}px; blocks:`, JSON.stringify(r.blocks));
  console.log('header:', r.title); lib.report(`${label}: no page errors`, errs.length === 0, errs.join('; '));
  // scroll a bit to show the transition and screenshot
  await p.locator('ion-content').last().evaluate(el => el.scrollToPoint(0, 0));
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${S}/dst-${label}.png` });
  await ctx.close();
}
(async () => {
  const b = await chromium.launch();
  // Spring forward: 2026-03-29 02:00 CET -> 03:00 CEST. 23:00 CET Mar 28 = 22:00Z. 08:00 CEST = 06:00Z -> 8h real.
  await run(b, 'spring', '2026-03-28T22:00:00Z', 8);
  // Fall back: 2026-10-25 03:00 CEST -> 02:00 CET. 23:00 CEST Oct 24 = 21:00Z. 08:00 CET = 07:00Z -> 10h real.
  await run(b, 'fall', '2026-10-24T21:00:00Z', 10);
  // A normal day for comparison.
  await run(b, 'normal', '2026-11-14T22:00:00Z', 9);
  await b.close();
})();
