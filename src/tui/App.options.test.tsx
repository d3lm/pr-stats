import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureCache } from '../cache';
import { loadSettings } from '../settings';
import { App } from './App';
import { readSavedOptions } from './state/options';
import { clearInput, destroyApp, initial, renderApp, waitForText, waitForTextGone } from './testing/harness';
import { applyThemeState, defaultThemeState } from './theme';

test('labels the save state in the options modal and saves with s', async () => {
  /**
   * Saving needs an enabled cache, so this test points the cache at a
   * temp directory, unlike the other tests, which keep it disabled the
   * way every debug run does.
   */
  const dir = mkdtempSync(join(tmpdir(), 'pr-stats-app-'));

  process.env.PR_STATS_CACHE_DIR = dir;
  configureCache(true);

  /**
   * A hand-written settings file with a theme stands in for a user's
   * customization, loaded the way bootstrap loads it. The disable-cache
   * toggle later rewrites the file and must keep the theme, and the App
   * gets the parsed theme state the way bootstrap would seed it.
   */
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: { accent: '#89b4f0' } }));
  loadSettings();

  const setup = await renderApp(
    <App
      initial={initial}
      initialSaved={initial}
      initialTheme={{ preset: 'custom', base: 'default', overrides: { accent: '#89b4f0' } }}
      onQuit={() => {}}
    />,
    {
      width: 110,
      height: 44,
    },
  );

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    /**
     * The live options equal the saved ones at startup, which is exactly
     * the pulled-from-save case the modal labels.
     */
    setup.mockInput.pressKey('o');

    await waitForText(setup, 'using saved options · command-line flags override them');

    /**
     * Moving up from the first field wraps to the wall clock toggle, and
     * flipping it drifts the live options away from the save.
     */
    setup.mockInput.pressArrow('up');

    await waitForText(setup, 'measure raw elapsed time including weekends');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'differs from saved options · press s to update');

    /**
     * Saving writes the live options to disk, the label flips back,
     * and the footer confirms the save with the checkmark notice.
     */
    setup.mockInput.pressKey('s');

    await waitForText(setup, '✔ options saved');
    await waitForText(setup, 'using saved options · command-line flags override them');

    expect(readSavedOptions()?.wallClock).toBe(true);

    /**
     * With an enabled cache, toggling disable cache in the settings
     * dialog persists to settings.json right away and keeps the theme
     * the file already held.
     */
    setup.mockInput.pressEscape();

    await waitForText(setup, 'enter open · t reviewed · ←/→ tabs');

    setup.mockInput.pressKey('S');

    await waitForText(setup, 'Disable cache');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'saved to settings.json');

    expect(setup.captureCharFrame()).toContain('‹ yes ›');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      theme: { accent: '#89b4f0' },
      noCache: true,
    });

    /**
     * The hand-written accent forms a custom theme, which the Theme row
     * shows as the active choice. Cycling right wraps from custom to the
     * built-ins, and the file keeps the custom colors next to the new
     * preset, so switching themes never wipes them.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'deletes the cached PR data');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'reloads the data in the background');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'time between the background reloads');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'notifies you when a load finds');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'also notifies you when someone @-mentions you');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'auto tries the terminal');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'sends a sample notification');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'clipboard');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'searches the PRs that @-mention you');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'the duration the snooze dialog starts with');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'built-in color theme');

    expect(setup.captureCharFrame()).toContain('‹ custom ›');

    setup.mockInput.pressArrow('right');

    await waitForText(setup, '‹ default ›');

    setup.mockInput.pressArrow('right');

    await waitForText(setup, '‹ green ›');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      theme: { preset: 'green', accent: '#89b4f0' },
      noCache: true,
    });

    /**
     * The theme dialog edits one color at a time. The active green theme
     * renders pure, so the accent row shows the preset's own color
     * without a custom marker, and a committed value seeds a fresh
     * custom theme from green and switches to it.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'opens the color list');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Theme colors');

    for (const hint of ['borders, rules', 'primary text', 'secondary text', 'faint text', 'highlights like medians']) {
      setup.mockInput.pressArrow('down');

      await waitForText(setup, hint);
    }

    expect(setup.captureCharFrame()).toContain('#89f0ab');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'enter apply · esc cancel');

    clearInput(setup.mockInput, '#89f0ab');

    await setup.mockInput.typeText('#a0c8ff');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'saved to settings.json');

    expect(setup.captureCharFrame()).toContain('#a0c8ff');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      theme: { preset: 'custom', base: 'green', accent: '#a0c8ff' },
      noCache: true,
    });

    // the fresh custom marker shows once the selection moves again
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'background of the selected row');

    setup.mockInput.pressArrow('up');

    await waitForText(setup, 'custom color');

    /**
     * The Theme row now sits on custom. Cycling left lands on yellow,
     * which renders pure while the file keeps the custom theme, and
     * cycling back to custom restores the edited accent.
     */
    setup.mockInput.pressEscape();

    await waitForText(setup, 'opens the color list');

    setup.mockInput.pressArrow('up');

    await waitForText(setup, 'built-in color theme');

    expect(setup.captureCharFrame()).toContain('‹ custom ›');

    setup.mockInput.pressArrow('left');

    await waitForText(setup, '‹ yellow ›');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      theme: { preset: 'yellow', base: 'green', accent: '#a0c8ff' },
      noCache: true,
    });

    setup.mockInput.pressArrow('right');

    await waitForText(setup, '‹ custom ›');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      theme: { preset: 'custom', base: 'green', accent: '#a0c8ff' },
      noCache: true,
    });

    /**
     * Clearing the custom accent drops the last custom color, which
     * dissolves the custom theme back into the green base it started
     * from.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'opens the color list');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Theme colors');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'enter apply · esc cancel');

    clearInput(setup.mockInput, '#a0c8ff');

    setup.mockInput.pressEnter();

    // the cleared accent falls back to the green base's accent
    await waitForText(setup, '#89f0ab');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      theme: { preset: 'green' },
      noCache: true,
    });

    setup.mockInput.pressEscape();

    await waitForText(setup, 'Disable cache');

    /**
     * Resetting the settings deletes the file after a confirmation, so
     * the toggle and the theme are gone for future runs.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'deletes the settings file');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'press enter again to delete settings.json');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'settings.json deleted');

    expect(existsSync(join(dir, 'settings.json'))).toBe(false);
  } finally {
    destroyApp(setup);
    applyThemeState(defaultThemeState());
    configureCache(false);
    delete process.env.PR_STATS_CACHE_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test('the review types row opens a checklist dropdown that toggles what counts as a review', async () => {
  const setup = await renderApp(<App initial={initial} onQuit={() => {}} />, { width: 110, height: 44 });

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    setup.mockInput.pressKey('o');

    await waitForText(setup, 'Review types');

    // the empty value shows the every-type placeholder
    expect(setup.captureCharFrame()).toContain('(every type)');

    /**
     * The selection starts on Since, and four moves land on the review
     * types row, whose hint names the dropdown. The reducer applies
     * each move in order, so the presses need no waits in between.
     */
    for (let press = 0; press < 4; press++) {
      setup.mockInput.pressArrow('down');
    }

    await waitForText(setup, 'enter opens the type list');

    setup.mockInput.pressEnter();

    // the empty value expands to a fully checked list
    await waitForText(setup, '[x] approve');

    const dropdownFrame = setup.captureCharFrame();

    expect(dropdownFrame).toContain('[x] comment');
    expect(dropdownFrame).toContain('[x] request-changes');

    /**
     * Enter on the highlighted approve row unchecks it, which narrows
     * the value to the remaining two types and keeps the list open for
     * more toggles.
     */
    setup.mockInput.pressEnter();

    await waitForText(setup, '[ ] approve');

    expect(setup.captureCharFrame()).toContain('comment,request-changes');

    // escape closes the list, and the narrowed value stays on the row
    setup.mockInput.pressEscape();

    await waitForTextGone(setup, '[ ] approve');

    expect(setup.captureCharFrame()).toContain('comment,request-changes');

    /**
     * Reopening the list and checking approve again completes the set,
     * which collapses back to the every-type placeholder.
     */
    setup.mockInput.pressEnter();

    await waitForText(setup, '[ ] approve');

    setup.mockInput.pressEnter();

    await waitForText(setup, '[x] approve');

    setup.mockInput.pressEscape();

    await waitForTextGone(setup, '[x] approve');

    expect(setup.captureCharFrame()).toContain('(every type)');
  } finally {
    destroyApp(setup);
  }
}, 30_000);

test('the work days checklist toggles the working week and the header counts the working hours', async () => {
  const setup = await renderApp(<App initial={initial} onQuit={() => {}} />, { width: 140, height: 44 });

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    // the default calendar renders without an hours count
    expect(setup.captureCharFrame()).toContain('Mon-Fri all hours Europe/Berlin');

    setup.mockInput.pressKey('o');

    await waitForText(setup, 'Work days');

    /**
     * The selection starts on Since, and eight moves land on the work
     * days row, whose hint names the checklist. The reducer applies each
     * move in order, so the presses need no waits in between.
     */
    for (let press = 0; press < 8; press++) {
      setup.mockInput.pressArrow('down');
    }

    await waitForText(setup, 'enter opens the day list');

    setup.mockInput.pressEnter();

    // the compact Mon-Fri value expands into one checkbox per day
    await waitForText(setup, '[x] Mon');

    const dropdownFrame = setup.captureCharFrame();

    expect(dropdownFrame).toContain('[x] Fri');
    expect(dropdownFrame).toContain('[ ] Sat');
    expect(dropdownFrame).toContain('[ ] Sun');

    /**
     * Four moves down highlight Friday, and enter unchecks it, which
     * narrows the week to Mon-Thu and keeps the list open.
     */
    for (let press = 0; press < 4; press++) {
      setup.mockInput.pressArrow('down');
    }

    setup.mockInput.pressEnter();

    await waitForText(setup, '[ ] Fri');

    expect(setup.captureCharFrame()).toContain('Mon-Thu');

    /**
     * Two more moves highlight Sunday, and checking it wraps the week
     * around its end, which compacts the value to Sun-Thu.
     */
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressEnter();

    await waitForText(setup, '[x] Sun');

    // escape closes the list, and the header shows the new week
    setup.mockInput.pressEscape();

    await waitForTextGone(setup, '[x] Mon');
    await waitForText(setup, 'Sun-Thu all hours Europe/Berlin');

    /**
     * Setting working hours adds the counted hours per day to the
     * header, the three morning hours plus the five afternoon hours.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'ranges like 9-17');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'enter apply · esc cancel');

    clearInput(setup.mockInput, '0-24');

    await setup.mockInput.typeText('9-12,13-18');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Sun-Thu 9-12,13-18 (8 hours) Europe/Berlin');
  } finally {
    destroyApp(setup);
  }
}, 30_000);
