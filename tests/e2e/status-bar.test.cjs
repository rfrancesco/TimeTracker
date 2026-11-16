const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
const { parse, formatHex } = require('culori');
(async () => {
  const S = lib.OUT; const b = await chromium.launch();
  for (const scheme of ['dark', 'light']) {
    const p = await (await b.newContext({ ...devices['Pixel 7'], colorScheme: scheme })).newPage();
    await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
    const meta = () => p.evaluate(() => document.querySelector('meta[name=theme-color]').content.toUpperCase());
    // What is actually rendered under the status bar on the visible page
    const under = () => p.evaluate(() => {
      const page = [...document.querySelectorAll('ion-tabs .ion-page')].find(x => !x.classList.contains('ion-page-hidden'));
      const tb = page.querySelector('ion-header ion-toolbar');
      if (tb) return getComputedStyle(tb.shadowRoot.querySelector('.toolbar-background')).backgroundColor;
      const probe = document.createElement('div'); document.body.appendChild(probe);
      probe.style.background = getComputedStyle(page.querySelector('ion-content')).getPropertyValue('--background');
      const c = getComputedStyle(probe).backgroundColor; probe.remove(); return c;
    });
    const hex = c => formatHex(parse(c)).toUpperCase();
    const row = async (label) => { const m = await meta(), u = hex(await under()); lib.report(`${scheme} ${label}: status bar matches the page`, m === u, `${m} vs ${u}`); console.log(`${scheme.padEnd(5)} ${label.padEnd(22)} status ${m}  under ${u}  ${m === u ? 'MATCH' : 'MISMATCH'}`); };
    await row('timer, idle');
    await p.locator('.area-pill-btn[aria-label="Guitar"]').click(); await p.waitForSelector('.area-pill-btn.selected[aria-label="Guitar"]'); await p.waitForTimeout(400);
    await row('timer, Guitar running');
    for (const tab of ['day', 'reports', 'settings', 'timer']) {
      await p.locator(`ion-tab-button[tab="${tab}"]`).click();
      const immediate = await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r(document.querySelector('meta[name=theme-color]').content.toUpperCase()))));
      await p.waitForTimeout(500);
      const settled = await meta();
      await row(`${tab} (running)`);
    }
    await p.screenshot({ path: `${S}/sb-timer-${scheme}.png`, clip: { x: 0, y: 0, width: 412, height: 120 } });
    await p.locator('ion-tab-button[tab="day"]').click(); await p.waitForTimeout(500);
    await p.screenshot({ path: `${S}/sb-day-${scheme}.png`, clip: { x: 0, y: 0, width: 412, height: 120 } });
    await p.locator('.stop-button').count();
  }
  await b.close();
})();
