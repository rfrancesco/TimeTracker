const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
const { parse, wcagContrast, interpolate, formatHex } = require('culori');
(async () => {
  const b = await chromium.launch();
  for (const scheme of ['dark', 'light']) {
    const p = await (await b.newContext({ ...devices['Pixel 7'], colorScheme: scheme })).newPage();
    await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
    const names = await p.locator('.timer-layout .area-pill-btn').evaluateAll(bs => bs.map(x => x.getAttribute('aria-label')));
    let worst = { c: Infinity }, worstSel = { c: Infinity }, below = 0, total = 0;
    for (const active of names) {
      await p.locator(`.timer-layout .area-pill-btn[aria-label="${active}"]`).click(); await p.waitForSelector(`.timer-layout .area-pill-btn.selected[aria-label="${active}"]`); await p.waitForTimeout(400);
      const d = await p.evaluate(() => { const pr = document.createElement('div'); document.body.appendChild(pr); pr.style.background = getComputedStyle(document.querySelector('.timer-page ion-content')).getPropertyValue('--background'); const page = getComputedStyle(pr).backgroundColor; pr.remove();
        return { page, btns: [...document.querySelectorAll('.timer-layout .area-pill-btn')].map(x => ({ name: x.getAttribute('aria-label'), sel: x.classList.contains('selected'), icon: getComputedStyle(x).color, bg: getComputedStyle(x).backgroundColor })),
          chips: [...document.querySelectorAll('.sub-chips ion-chip.selected')].map(c => ({ fg: getComputedStyle(c).color, bg: getComputedStyle(c).backgroundColor })) }; });
      const surface = formatHex(interpolate([parse(d.page), '#7f7f7f'], 'rgb')(0.12));
      for (const x of d.btns) { total++; const c = wcagContrast(parse(x.icon), parse(x.sel ? x.bg : surface)); if (c < 3) below++; const w = x.sel ? worstSel : worst; if (c < w.c) Object.assign(w, { c, where: `${x.name} while ${active} runs` }); }
    }
    lib.report(`${scheme}: every area icon reaches 3:1 contrast`, below === 0, `${total} checked, worst ${worst.c.toFixed(2)}`);
    console.log(`${scheme}: ${total} icons, ${below} below 3:1 | worst unselected ${worst.c.toFixed(2)} (${worst.where}) | worst selected ${worstSel.c.toFixed(2)} (${worstSel.where})`);
  }
  await b.close();
})();
