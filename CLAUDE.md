# Time Tracker — notes for Claude

Personal, local-first time-tracking PWA for the owner's Android phone (Pixel 6a,
Android 17). Ionic 9 + React 19 + Vite, data in IndexedDB via Dexie, offline via
vite-plugin-pwa. Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every
push to `main` (https://rfrancesco.github.io/TimeTracker/). The app updates itself
on launch/resume and shows an "App updated" toast.

## Commands
- `npm run dev` / `npm run build` (type-checks first) / `npm run preview`
- `tests/e2e/run.sh [words…]`: builds, serves, runs the Playwright suites (all,
  or those whose file name contains a word). `SCHEMES="dark light"` runs both themes.

## Map
- `src/db.ts`: schema, defaults, **versioned migrations**, backup import/export,
  `intervalsOverlapping()`
- `src/constraints.ts`: **the only place that changes interval times** (see invariant)
- `src/timer.ts`: track / stop / stopAt / undoStop, relabel rule, `formatDuration`
- `src/report.ts`: report periods and aggregation (whole-period split: untracked /
  still to come / before tracking)
- `src/backup.ts`: backup format + full validation before anything is written
- `src/time.ts`: local-day and DST helpers
- `src/color.ts`: all colour logic (culori); `src/theme.ts`: light/dark/system
- `src/backGesture.ts`: Android back closes the top Ionic dialog (PWA)
- `src/App.tsx`: tabs, tab-bar tint, status-bar sync + crossfade, update toast
- `src/pages/*`, `src/components/*`: UI

## Invariants (never break these)
1. **Times are stored as UTC ISO strings**; local time only decides day boundaries.
   Local days are 23/25 h on DST days; use the helpers in `time.ts`, never `24 * 60`.
2. **No overlapping intervals, no future time, a running timer starts after the last
   interval.** Every write that changes start/end goes through `constraints.ts`
   (`saveInterval`, `updateActive`, `commitTimerSpan`; `normalize()` for old data and
   imports). Drags in the day view are clamped to free space; the editor asks before
   replacing overlapping time. `intervalsOverlapping()` relies on this invariant.
3. **Timer rules:** switching within 1 min relabels; stopping within 1 min discards.
   The running timer is a start timestamp, so reloads/updates/reboots never reset it.
4. **Schema changes = a new Dexie version with an upgrade** that respects user
   customisations (only touch values still equal to the old defaults; respect custom
   order). Test migrations by building the previous commit (git worktree) and opening
   the new build on the same origin.
5. **Backups:** exports carry `app`/`format`; imports are fully validated first and
   written in one transaction; older exports must keep restoring.

## Colours
- Areas store exactly the colour the user chose. `displayColor()` only adjusts
  extremes (lifts very dark colours in dark mode, darkens very light ones in light).
- Icon/text readability is computed, never hard-coded: `readableOn()` keeps the hue
  and adjusts lightness to ≥3:1 against the real background; `onColor()` picks
  white/near-black for marks on a filled colour. **No per-area or per-colour rules.**
- Use culori for colour maths; CSS `color-mix()` for tints. No hand-written conversions.
- When proposing palette colours, validate them with the dataviz skill's
  `validate_palette.js` in both themes (neighbours in area order must pass CVD checks;
  that order is also the stacking order in reports).

## UI conventions
- Native Android/Material feel. Timer page has no title bar; area selector rows come
  from `breakAfter` (row 1: necessities, row 2: hobbies).
- Toasts via `useToast()` (anchored above the tab bar so they never block the tabs).
- Tab switches: opacity-only fade (scaling would open a gap at the top). The status
  bar matches the top of the visible page and crossfades with it (MutationObserver +
  underlay of the old page's colours). Keep `PAGE_FADE` in `App.tsx` and the CSS
  animation in sync.
- New dialogs automatically get back-gesture support (Ionic overlay events).
- Stop: a tap stops at once; holding turns it into ⏪ REWIND with a right-to-left fill and
  opens "Stopped earlier?"; releasing early cancels (never stops). Every stop offers Undo.

## Testing
- Test thoroughly before reporting; measure rather than eyeball (contrast, frame
  timing, totals). Run `tests/e2e/run.sh` after changes.
- Playwright notes: `page.clock.install` slows Dexie's timers (don't trust timings
  under it); Ionic sets `value`/`aria-label` as properties or moves them to inner
  inputs; a plain static server has no SPA fallback (load `/`, not `/day`); wait for
  the UI to reflect a DB write before measuring.
- Things that can only be checked on the phone (real gestures, system pickers,
  status-bar timing, share sheet): say so explicitly.

## Working with the owner
- When asked to analyse or think, **analyse only; don't build** until asked.
- Explain trade-offs and recommend; keep summaries short and concrete.
- Values: deliberate tracking over automation; minimal permissions; data stays on
  the device; consistency over taxonomy perfection ("main activity wins").

## Plans and open questions
- **Planned, not built: Capacitor wrapper with the status-bar chip only.** Separate
  repo; loads the web app; one small plugin posting a promoted ongoing notification
  (Android 16+ Live Update chip, system chronometer, no Stop button, no foreground
  service).
- **Still being thought about, not decided: area taxonomy.** Areas currently mix
  activity, place and company; possible named groups (Necessities / At home / Out)
  with group totals in reports. Until decided, use "main activity wins" as the
  guideline for where time belongs.
