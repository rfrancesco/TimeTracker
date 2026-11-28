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
- `src/timer.ts`: **the timer rules as pure plans** (`planStart/Restart/Switch/Stop/Track`)
  and the DB actions that apply them (track, startAt, restartAt, switchAt, stopAt); the UI
  uses the same plans for hints and the instant preview, so never re-implement a rule
- `src/report.ts`: report periods and aggregation (whole-period split: untracked /
  still to come / before tracking)
- `src/backup.ts`: backup format + full validation before anything is written
- `src/time.ts`: local-day and DST helpers, `MINUTE`/`HOUR`, `formatClock`
- `src/color.ts`: all colour logic (culori); `src/theme.ts`: light/dark/system
- `src/backGesture.ts`: Android back closes the top Ionic dialog (PWA)
- `src/archive.ts`: archive / restore / permanent deletion (destinations: Deleted, plain,
  merge, drop) and time cleanup; `ArchivedPage`, `DeleteDialog`, `CleanupDialog`
- `src/useHold.ts` (tap = now, hold = earlier), `src/useOptimisticActive.ts`,
  `src/toast.ts`, `src/prefs.ts` (localStorage conveniences), `src/usePinchZoom.ts`
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
- Timer display: one structure in every state, a sentence-case caption above one big
  number ("Tap an area to start" / 0:00:00 idle; "Started at 22:45" / elapsed;
  quiet: "Started at" / muted start time). `.timer-display` min-height follows the
  digits' size formula, so idle/ticking/quiet share one height (nothing below moves).
- Native Android/Material feel. Timer page has no title bar; area selector rows come
  from `breakAfter` (row 1: necessities, row 2: hobbies).
- Toasts via `useToast()` (anchored above the tab bar so they never block the tabs).
  One at a time app-wide (`dismissAllToasts()` before presenting).
- Day view: dragging is deliberate. Tap selects; on a selected block a hold of Android's
  long-press delay (`longPressMs()`, `src/longPress.ts`; 400 ms default/browser)
  lifts it (vibration + `.lifted`), only then it follows the finger; moving before
  that scrolls (selected blocks are `touch-action: pan-y`; once lifted, a non-passive
  touchmove listener stops scrolling); a tap opens the editor; a hold released in
  place does nothing. Every Day edit (drag/resize, editor save/add/delete, editing or
  discarding the running timer) goes through `useEditUndo()` (`src/editUndo.ts`): a
  snackbar "<what> · Undo", one step, separate from the Timer's ↶ ↷ but the same
  snapshot-and-verify (`recordEdit`/`undoLastEdit` in `src/undo.ts`); leaving the
  Day view forgets it. While the snackbar is up, the + FAB moves above it.
- Haptics only via `haptic()` (`src/haptics.ts`): the Android app's system haptics
  (`TimeTrackerPlugin.haptic`, no permission; the WebView's own haptics are off so
  there's no stray long-press buzz), `navigator.vibrate` in the browser. Day blocks
  have no long-press callout/selection.
- Tab switches: opacity-only fade (scaling would open a gap at the top). The status
  bar matches the top of the visible page and crossfades with it (MutationObserver +
  underlay of the old page's colours). Keep `PAGE_FADE` in `App.tsx` and the CSS
  animation in sync.
- New dialogs automatically get back-gesture support (Ionic overlay events).
- Stop: a tap stops at once; holding turns it into ⏪ REWIND with a right-to-left fill and
  opens "When did you stop?" (quick times + 🗑 as choices; the tall main button applies
  the selection, so discarding takes two deliberate taps);
  releasing early cancels (never stops).
- Earlier, for areas too (tap = now, hold = earlier): holding an area makes the Stop
  slot the indicator (area colour, ⏪ + area icon, "Start earlier"/"Switch earlier",
  same fill) and opens the same sheet (`StopEarlierSheet`, modes stop/start/switch):
  idle → "When did you start?" (`startAt`, never before the last interval's end; quick
  "After <last area>"); the running area → move its start (`restartAt`); another area
  while running → "When did you switch to X?" (`switchAt`, relabel rule under 1 min). All
  through `recordTimerAction` (undoable). Quick times name their anchor: "5 min ago"
  (from now: stop, switch, idle start) or "5 min earlier" (from the running start, shown
  as "started at"); default = the 5-min chip; chips that don't fit are greyed, never hidden.
  Chips are exact offsets (seconds kept, so the timer moves by exactly 5:00), worked out
  when the main button is tapped; a typed time in the minute of the start/last end snaps to it.
  Sub-areas: start/switch sheets show the target area's sub-areas as a row (running
  area: current one preselected; same start + other sub-area = relabel the whole timer).
  Holding a sub-area chip (not the current one) = "When did you switch to Songs?"
  (switch mode with `subId`; "From the start" first and preselected = relabel).
  The Timer shows a sheet action's (and Stop/discard's) planned result at once
  (`useOptimisticActive`: the phone's undo snapshots + write take ~1 s) until the DB says the same.
- Note while running: a "Note" chip ends the sub-area row (dashed when empty, shows the
  text when set) → `NoteSheet`; stored as `ActiveTimer.note` (`setNote`, undoable), copied
  to the interval by `commitTimerSpan`, kept by relabel/restart and `updateActive` (unless
  the patch has a `note` key); a real switch starts the new timer without one. The Day
  editor edits the running timer's note too.
- Areas and sub-areas are never deleted directly: removing one **archives** it (also while
  running: the sheet offers keep tracking / stop first, or for a sub-area "continue as the
  area"). Archived items drop out of pickers except where they are the current selection
  (running timer; the interval being edited), shown greyed. Settings → "Archived · N" →
  Restore, or ⋮ → Delete permanently, which asks where the time goes: the built-in
  **Deleted** area / an area's Deleted sub-area (`system: 'deleted'`, archived, never
  listed or restored), the area without sub-area, another area/sub-area, or deleted; a
  running timer follows (merge = relabel, Deleted = stop, drop = discard); clears all undo
  history. A new area/sub-area named like an archived one restores it. Settings → Data →
  "Delete tracked time…": before a day / day range (cut at the edges, running timer
  untouched) / time kept as Deleted. Ionic radio groups: ignore bubbled ionChange from
  inputs inside them (`e.target === e.currentTarget`).
- Undo/redo: ↶ ↷ top-right on Timer (fixed slots, each shown only when usable). The
  last 20 timer actions (start, area/sub-area change, stop, rewind, discard,
  notification Stop) are recorded via `recordTimerAction` in `src/undo.ts` as
  before/after snapshots of the running timer + intervals ending after it; ↶ restores
  "before", ↷ "after"; a new action clears redo. Each step verifies the region still
  matches and refuses otherwise. No success toasts on Timer (only "Can't undo/redo").

## Testing
- Test thoroughly before reporting; measure rather than eyeball (contrast, frame
  timing, totals). Run `tests/e2e/run.sh` after changes.
- Playwright notes: `page.clock.install` slows Dexie's timers (don't trust timings
  under it); Ionic sets `value`/`aria-label` as properties or moves them to inner
  inputs; a plain static server has no SPA fallback (load `/`, not `/day`); wait for
  the UI to reflect a DB write before measuring.
- Database access in tests: `lib.seed` (by area/sub-area name), `lib.timeline` ("[Thesis
  16:00–17:30] ▶ Guitar since 18:05"), `lib.read`, `lib.activeStart`, `lib.patchInterval`.
- Tests use a 5 s default timeout (`lib.cjs`); pass a longer one only where a step is
  really slow. Never probe for something optional with a waiting locator plus
  `.catch()` (it silently costs the whole timeout): check `count()` or wait for the
  expected outcome. Toasts: listen for `ionToastWillPresent` (Ionic reuses toast
  elements, and a toast is gone 2.5 s later). `run.sh` prints each suite's duration.
- Things that can only be checked on the phone (real gestures, system pickers,
  status-bar timing, share sheet): say so explicitly.

## Working with the owner
- When asked to analyse or think, **analyse only; don't build** until asked.
- Explain trade-offs and recommend; keep summaries short and concrete.
- Values: deliberate tracking over automation; minimal permissions; data stays on
  the device; consistency over taxonomy perfection ("main activity wins").

## Plans and open questions
- **Android wrapper: rfrancesco/TimeTracker-android** (Capacitor; loads this app
  from Pages; CI builds the APK). Ongoing notification, no actions; tapping opens
  the Timer tab (`openTimer` event). Two separate per-area settings (`src/runningTime.ts`,
  stored on the area, missing = on, migrated in v10 from the old `liveUpdates` flag):
  **Running time** (Settings → Appearance; Off / App only / On; Off = "Started
  at" over the muted start time instead of the ticking digits, and the start time in
  the Timer tab; Today keeps real totals; the PWA offers
  Off / On) and **Live updates** (Settings → Android app;
  on = promoted: status-bar chip at the far left, top of the lock screen, may hide other
  icons; off = plain notification, ranked after messaging apps). The chip and the
  notification share one clock: it ticks only for running time On, else icon only.
  Say "live updates", not "chip".
  No foreground service. Bridge: `src/native.ts` (no-op in browsers): mirrors the
  running timer (`promote` = live update, `showTime` = running time On), still applies Stops from older APKs (which had a
  Stop action) via `stopAt` + undo, exports through the native share sheet. Only add
  plugin methods, never change them (older APKs must keep working).
  Later idea: bundle the web app (submodule) and drop INTERNET.
- **Still being thought about, not decided: area taxonomy.** Areas currently mix
  activity, place and company; possible named groups (Necessities / At home / Out)
  with group totals in reports. Until decided, use "main activity wins" as the
  guideline for where time belongs.
