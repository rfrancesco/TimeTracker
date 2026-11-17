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

module.exports = { BASE, DEV, OUT, report, DEFAULT_TIMEOUT };
