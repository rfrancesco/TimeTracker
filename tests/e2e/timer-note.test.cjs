const lib = require('./lib.cjs');
// The running timer's note: the Note chip at the end of the sub-area row opens a sheet;
// the note shows on the chip, is saved with the interval, survives a relabel, is
// undoable, and the Day editor edits the same note.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome', colorScheme: process.env.SCHEME || 'dark' })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-16T18:00:00+01:00') });
  await p.goto(lib.BASE); await p.waitForSelector('.area-pill-btn');
  const pill = (name) => p.locator(`.timer-layout .area-pill-btn[aria-label="${name}"]`);
  const chip = p.locator('.timer-layout .note-chip');
  const sheet = 'ion-modal.note-sheet';
  const save = p.locator(`${sheet} .sheet-apply`);
  const activeNote = () => lib.read(p, ({ active }) => active?.note ?? null);
  const notes = () => lib.read(p, ({ intervals, areas }) => intervals.map((i) => `${areas.find((a) => a.id === i.areaId).name}:${i.note ?? '-'}`).join(' '));
  const openNote = async () => { await chip.click(); await p.waitForSelector(`${sheet} .sheet-title`); await p.waitForTimeout(500); };
  const type = async (text) => { await p.locator(`${sheet} textarea:not(.cloned-input)`).fill(text); await p.waitForTimeout(200); };
  const sheetGone = () => p.waitForSelector(`${sheet} .sheet-title`, { state: 'detached' });

  lib.report('idle: no Note chip', (await chip.count()) === 0);
  await pill('Guitar').click(); await p.waitForTimeout(500);
  lib.report('running Guitar: a dashed “Note” chip after the sub-areas', (await chip.innerText()).trim() === 'Note' && !(await chip.evaluate((e) => e.classList.contains('has'))) && (await p.locator('.timer-layout .sub-chips ion-chip').last().evaluate((e) => e.classList.contains('note-chip'))));

  await openNote();
  lib.report('the sheet opens with an empty note and focuses it', (await p.locator(`${sheet} textarea:not(.cloned-input)`).inputValue()) === '' && (await p.evaluate(() => document.activeElement?.tagName)) === 'TEXTAREA', await p.evaluate(() => document.activeElement?.tagName));
  lib.report('…“Save note” is disabled until something is typed', await save.evaluate((e) => e.disabled));
  await type('  Barre chords, Wonderwall  ');
  await p.screenshot({ path: `${lib.OUT}/note-sheet.png` });
  await save.click(); await sheetGone(); await p.waitForTimeout(400);
  lib.report('saved (trimmed) on the running timer', (await activeNote()) === 'Barre chords, Wonderwall', await activeNote());
  lib.report('…and shown on the chip', (await chip.innerText()).trim() === 'Barre chords, Wonderwall' && (await chip.evaluate((e) => e.classList.contains('has'))));
  await p.screenshot({ path: `${lib.OUT}/note-chip.png` });

  await p.locator('.undo-button').click(); await p.waitForTimeout(500);
  lib.report('undo removes it', (await activeNote()) === null && (await chip.innerText()).trim() === 'Note', String(await activeNote()));
  await p.locator('.redo-button').click(); await p.waitForTimeout(500);
  lib.report('redo brings it back', (await activeNote()) === 'Barre chords, Wonderwall');

  // A relabel (switching within a minute of the start) keeps the note.
  await p.clock.fastForward(20_000); await p.waitForTimeout(200);
  await pill('Music').click(); await p.waitForTimeout(500);
  lib.report('relabel to Music keeps the note', (await activeNote()) === 'Barre chords, Wonderwall' && (await lib.timeline(p)).includes('▶ Music'), await lib.timeline(p));
  lib.report('Music has no sub-areas: the row shows only the Note chip (no “None”)', (await p.locator('.timer-layout .sub-chips ion-chip').count()) === 1);

  // A real switch saves the note with the interval; the new timer starts without one.
  await p.clock.fastForward(10 * 60_000); await p.waitForTimeout(300);
  await pill('Reading').click(); await p.waitForTimeout(600);
  lib.report('switching saves the note with Music’s interval; Reading starts empty', (await notes()) === 'Music:Barre chords, Wonderwall' && (await activeNote()) === null, `${await notes()} | ${await activeNote()}`);

  // The Day editor for the running timer edits the same note.
  await openNote(); await type('Dune'); await save.click(); await sheetGone(); await p.waitForTimeout(300);
  await p.clock.fastForward(30 * 60_000); await p.waitForTimeout(300);
  await p.locator('ion-tab-button[tab="day"]').click(); await p.waitForTimeout(900);
  const runBlock = p.locator('.day-block', { hasText: 'Reading' }).last();
  await runBlock.click(); await p.waitForTimeout(300);
  if (!(await p.locator('ion-modal ion-title', { hasText: 'Running timer' }).count())) { await runBlock.click(); }
  await p.waitForSelector('ion-modal ion-title'); await p.waitForTimeout(400);
  const editorNote = p.locator('ion-modal ion-textarea textarea:not(.cloned-input)').last();
  lib.report('Day editor of the running timer shows its note', (await editorNote.inputValue()) === 'Dune', await editorNote.inputValue());
  await editorNote.fill('Dune, part 2'); await p.waitForTimeout(200);
  await p.locator('ion-modal ion-button', { hasText: /save/i }).click(); await p.waitForTimeout(800);
  lib.report('…and saving it changes the running timer’s note', (await activeNote()) === 'Dune, part 2', String(await activeNote()));
  await p.locator('ion-tab-button[tab="timer"]').click(); await p.waitForTimeout(800);
  lib.report('the Timer chip shows the edited note', (await chip.innerText()).trim() === 'Dune, part 2');

  // Clearing it: the button becomes “Remove note”.
  await openNote(); await type('');
  lib.report('cleared: “Remove note”', /remove note/i.test(await save.innerText()) && !(await save.evaluate((e) => e.disabled)), await save.innerText());
  await save.click(); await sheetGone(); await p.waitForTimeout(400);
  lib.report('→ no note', (await activeNote()) === null && (await chip.innerText()).trim() === 'Note');

  // Moving the start (hold the running area) keeps the note.
  await openNote(); await type('Chapter 3'); await save.click(); await sheetGone(); await p.waitForTimeout(300);
  const r = await pill('Reading').boundingBox(); await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await p.mouse.down(); await p.waitForTimeout(800); await p.mouse.up();
  await p.waitForSelector('ion-modal.stop-sheet .sheet-title'); await p.waitForTimeout(400);
  // (Reading started right as Music ended, so nothing earlier is possible: move it later instead.)
  await p.locator('ion-modal.stop-sheet .time-input input').fill('18:20'); await p.waitForTimeout(300);
  await p.locator('ion-modal.stop-sheet .sheet-apply').click(); await p.waitForTimeout(800);
  lib.report('moving the start keeps the note', (await activeNote()) === 'Chapter 3' && (await lib.timeline(p)).endsWith('▶ Reading since 18:20'), `${await activeNote()} | ${await lib.timeline(p)}`);

  lib.report('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
