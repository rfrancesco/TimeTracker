const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
const { parse, formatHex, interpolate, differenceEuclidean } = require('culori');
const dE = differenceEuclidean('oklab');
(async () => {
  const b = await chromium.launch();
  for (const scheme of ['dark', 'light']) {
    const p = await (await b.newContext({ ...devices['Pixel 7'], colorScheme: scheme })).newPage();
    await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
    await p.locator('.area-pill-btn[aria-label="Guitar"]').click(); await p.waitForSelector('.area-pill-btn.selected[aria-label="Guitar"]'); await p.waitForTimeout(500);
    for (const tab of ['day', 'reports', 'settings', 'timer', 'reports', 'timer']) {
      const frames = await p.evaluate((tab) => new Promise(res => {
        const meta = document.querySelector('meta[name=theme-color]'); const out = []; const t0 = performance.now();
        const topColor = (page) => {
          const tb = page.querySelector('ion-header ion-toolbar');
          if (tb) return getComputedStyle(tb.shadowRoot.querySelector('.toolbar-background')).backgroundColor;
          const pr = document.createElement('div'); document.body.appendChild(pr); pr.style.background = getComputedStyle(page.querySelector('ion-content')).getPropertyValue('--background'); const c = getComputedStyle(pr).backgroundColor; pr.remove(); return c;
        };
        const appBg = (() => { for (let el = document.querySelector('ion-tabs'); el; el = el.parentElement) { const c = getComputedStyle(el).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return 'rgb(255, 255, 255)'; })();
        document.querySelector(`ion-tab-button[tab="${tab}"]`).click();
        const tick = () => {
          const page = [...document.querySelectorAll('ion-tabs .ion-page')].find(x => !x.classList.contains('ion-page-hidden'));
          const under = page.parentElement.style.getPropertyValue('--underlay-top') || appBg;
          out.push({ t: Math.round(performance.now() - t0), op: +getComputedStyle(page).opacity, top: topColor(page), under, meta: meta.content });
          if (performance.now() - t0 < 400) requestAnimationFrame(tick); else res(out);
        };
        requestAnimationFrame(tick);
      }), tab);
      let worst = 0, statusRange = 0, shownRange = 0; const s0 = frames[0].meta;
      const shownList = frames.map(f => formatHex(interpolate([parse(f.under), parse(f.top)], 'rgb')(f.op)));
      frames.forEach((f, i) => { worst = Math.max(worst, 100 * dE(shownList[i], f.meta)); statusRange = Math.max(statusRange, 100 * dE(f.meta, s0)); shownRange = Math.max(shownRange, 100 * dE(shownList[i], shownList[0])); });
      const from = frames[0].meta, to = frames[frames.length - 1].meta;
      lib.report(`${scheme} → ${tab}: status bar tracks the page during the fade`, worst <= 8, `max ΔE ${worst.toFixed(1)}`);
      if (from === to) lib.report(`${scheme} → ${tab}: same-colour switch has no dip`, shownRange < 0.5 && statusRange < 0.5);
      console.log(`${scheme.padEnd(5)} → ${tab.padEnd(8)} status ${from}→${to} | max status-vs-screen ΔE ${worst.toFixed(1)} | page top moved ΔE ${shownRange.toFixed(1)}, status moved ΔE ${statusRange.toFixed(1)}`);
      await p.waitForTimeout(500);
    }
  }
  await b.close();
})();
