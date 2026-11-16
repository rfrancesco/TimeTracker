#!/usr/bin/env bash
# End-to-end suites (Playwright, headless Chromium).
#   tests/e2e/run.sh                 # all suites
#   tests/e2e/run.sh backup overlap  # only suites whose file name contains these words
# Builds the app, serves it (preview :4173, dev :5174), runs each *.test.cjs and
# prints a summary. Screenshots and scratch files go to tests/e2e/out/ (ignored by git).
set -u
cd "$(dirname "$0")/../.."
npm run build >/dev/null || { echo "build failed"; exit 1; }
npx vite preview --port 4173 --strictPort >/dev/null 2>&1 & PREVIEW=$!
npx vite --port 5174 --strictPort >/dev/null 2>&1 & DEV=$!
trap 'kill $PREVIEW $DEV 2>/dev/null' EXIT
sleep 4
export NODE_PATH="$PWD/node_modules:$(npm root -g)"
export OUT="$PWD/tests/e2e/out"; mkdir -p "$OUT"

suites=()
for f in tests/e2e/*.test.cjs; do
  if [ $# -eq 0 ]; then suites+=("$f"); else for w in "$@"; do [[ "$f" == *"$w"* ]] && suites+=("$f"); done; fi
done

failed=()
for f in "${suites[@]}"; do
  name=$(basename "$f" .test.cjs)
  echo "── $name"
  for scheme in ${SCHEMES:-dark}; do
    SCHEME=$scheme timeout 600 node "$f" 2>&1 | sed 's/^/   /'
    rc=${PIPESTATUS[0]}
    [ "$rc" -eq 0 ] || failed+=("$name")
  done
done
echo
if [ ${#failed[@]} -eq 0 ]; then echo "All ${#suites[@]} suites passed."; else echo "FAILED: ${failed[*]}"; exit 1; fi
