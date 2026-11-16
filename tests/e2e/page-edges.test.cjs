const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' })).newPage();
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  await p.locator('.area-pill-btn[aria-label="Guitar"]').click(); await p.waitForTimeout(400);
  for (const tab of ['day', 'timer', 'settings']) {
    const r = await p.evaluate((tab) => new Promise(res => {
      document.querySelector(`ion-tab-button[tab="${tab}"]`).click(); const t0 = performance.now(); let maxGap = 0, frames = 0;
      const tick = () => {
        const page = [...document.querySelectorAll('ion-tabs .ion-page')].find(x => !x.classList.contains('ion-page-hidden'));
        const r = page.getBoundingClientRect(); frames++;
        maxGap = Math.max(maxGap, r.top, r.left, window.innerWidth - r.right);
        if (performance.now() - t0 < 350) requestAnimationFrame(tick); else res({ frames, maxGap: +maxGap.toFixed(2) });
      };
      requestAnimationFrame(tick);
    }), tab);
    lib.report(`→ ${tab}: page stays flush with the screen edges while fading in`, r.maxGap === 0, `${r.maxGap}px`);
    await p.waitForTimeout(400);
  }
  await b.close();
})();
