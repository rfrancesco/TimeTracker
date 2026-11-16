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

module.exports = { BASE, DEV, OUT, report };
