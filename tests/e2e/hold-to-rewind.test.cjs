const lib = require('./lib.cjs');
// Stop: a tap stops at once and never changes the label; holding shows ⏪ REWIND with a
// right-to-left fill and opens "Stopped earlier?"; releasing after the label changed cancels.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['Pixel 7'], colorScheme: process.env.SCHEME || 'dark' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  const state = () => p.evaluate(() => { const btn = document.querySelector('.stop-button'); return { fill: getComputedStyle(btn.shadowRoot.querySelector('.button-native')).backgroundSize, label: btn.innerText.trim(), icon: [...btn.querySelectorAll('.stop-labels > span:not(.off) ion-icon')].map(i => i.icon).join(), width: Math.round(btn.getBoundingClientRect().width) }; });
  const start = async () => { await p.locator('.area-pill-btn[aria-label="Guitar"]').click(); await p.waitForSelector('.area-pill-btn.selected[aria-label="Guitar"]'); await p.waitForTimeout(300); };
  const centre = async () => { const r = await p.locator('.stop-button').boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };

  await start();
  await p.evaluate(() => { window.__labels = new Set(); const btn = document.querySelector('.stop-button'); new MutationObserver(() => window.__labels.add(btn.innerText.trim())).observe(btn, { subtree: true, childList: true, characterData: true }); });
  await p.locator('.stop-button').click(); await p.waitForTimeout(500);
  const seen = await p.evaluate(() => [...window.__labels]);
  lib.report('a tap never changes the label', !seen.some(l => /rewind/i.test(l)), JSON.stringify(seen));
  lib.report('a tap stops the timer', (await p.locator('.timer-digits').innerText()) === '0:00:00');

  await start();
  const rest = await state();
  let [x, y] = await centre();
  await p.mouse.move(x, y); await p.mouse.down();
  await p.waitForTimeout(80); const early = await state();
  await p.waitForTimeout(220); const mid = await state();
  await p.screenshot({ path: `${lib.OUT}/hold-to-rewind.png`, clip: { x: 0, y: y - 60, width: 412, height: 120 } });
  await p.waitForTimeout(450); await p.mouse.up(); await p.waitForTimeout(500);
  const sheet = await p.locator('ion-modal.stop-sheet .sheet-title').isVisible().catch(() => false);
  lib.report('at rest: STOP', /^stop$/i.test(rest.label), rest.label);
  lib.report('just after pressing: still STOP', /^stop$/i.test(early.label), early.label);
  lib.report('holding: REWIND with the rewind icon', /^rewind$/i.test(mid.label) && mid.icon !== rest.icon, mid.label);
  const pct = parseFloat(mid.fill);
  lib.report('holding: the background fills progressively', parseFloat(rest.fill) === 0 && pct > 20 && pct < 100, `${rest.fill} → ${mid.fill}`);
  lib.report('button keeps its width', rest.width === mid.width, `${rest.width}px vs ${mid.width}px`);
  lib.report('completing the hold opens “Stopped earlier?”', sheet);
  lib.report('button is back to STOP once the sheet is open', /^stop$/i.test((await state()).label));
  await p.goBack(); await p.waitForTimeout(500);

  [x, y] = await centre();
  await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(300); await p.mouse.up(); await p.waitForTimeout(400);
  const after = await state();
  const open = await p.locator('ion-modal.stop-sheet .sheet-title').isVisible().catch(() => false);
  lib.report('releasing after the label changed cancels (timer keeps running)', /^stop$/i.test(after.label) && !open && (await p.locator('.timer-label').count()) === 1, after.label);
  lib.report('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
