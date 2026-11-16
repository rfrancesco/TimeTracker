const lib = require('./lib.cjs');
const { chromium, devices } = require('playwright');
(async () => {
  const S = lib.OUT; const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const toast = async () => { await p.waitForTimeout(900); return p.evaluate(() => [...document.querySelectorAll('ion-toast')].map(t => t.message).join(' | ') || '(none)'); };
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  lib.report('no update message on first launch', (await toast()) === '(none)');
  await p.evaluate(() => localStorage.setItem('lastBuild', 'older-build'));     // as if a previous version had run
  await p.reload(); await p.waitForSelector('.area-pill-btn');
  lib.report('update message after an update', /updated/.test(await toast()));
  console.log('above tab bar:     ', await p.evaluate(() => { const t = document.querySelector('ion-toast').shadowRoot.querySelector('.toast-wrapper').getBoundingClientRect(); return t.bottom <= document.querySelector('ion-tab-bar').getBoundingClientRect().top + 1; }));
  await p.screenshot({ path: `${S}/update-toast.png` });
  await p.reload(); await p.waitForSelector('.area-pill-btn');
  lib.report('no update message on a normal reopen', (await toast()) === '(none)');
  lib.report('no page errors', errs.length === 0, errs.join('; ')); await b.close();
})();
