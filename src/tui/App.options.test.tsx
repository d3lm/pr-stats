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
  const dir = mkdtempSync(join(tmpdir(), 'pr-stats-app-'));

  process.env.PR_STATS_CACHE_DIR = dir;

  configureCache(true);

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

    setup.mockInput.pressKey('o');

    await waitForText(setup, 'using saved options · command-line flags override them');

    setup.mockInput.pressArrow('up');

    await waitForText(setup, 'measure raw elapsed time including weekends');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'differs from saved options · press s to update');

    setup.mockInput.pressKey('s');

    await waitForText(setup, '✔ options saved');
    await waitForText(setup, 'using saved options · command-line flags override them');

    expect(readSavedOptions()?.wallClock).toBe(true);

    setup.mockInput.pressEscape();

    await waitForText(setup, 'enter open · t reviewed · ←/→ tabs');

    setup.mockInput.pressKey('S');

    await waitForText(setup, 'reloads the data in the background');

    setup.mockInput.pressKey('5');

    await waitForText(setup, 'refetch everything on every load');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'saved to settings.json');

    expect(setup.captureCharFrame()).toContain('‹ yes ›');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      theme: { accent: '#89b4f0' },
      noCache: true,
    });

    setup.mockInput.pressKey('4');

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

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'background of the selected row');

    setup.mockInput.pressArrow('up');

    await waitForText(setup, 'custom color');

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

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'opens the color list');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Theme colors');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'enter apply · esc cancel');

    clearInput(setup.mockInput, '#a0c8ff');

    setup.mockInput.pressEnter();

    await waitForText(setup, '#89f0ab');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      theme: { preset: 'green' },
      noCache: true,
    });

    setup.mockInput.pressEscape();

    await waitForText(setup, 'opens the color list');

    setup.mockInput.pressKey('5');

    await waitForText(setup, 'refetch everything on every load');

    for (const hint of ['deletes the cached PR data', 'writes the loaded stats', 'deletes the settings file']) {
      setup.mockInput.pressArrow('down');

      await waitForText(setup, hint);
    }

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

    expect(setup.captureCharFrame()).toContain('(every type)');

    for (let press = 0; press < 4; press++) {
      setup.mockInput.pressArrow('down');
    }

    await waitForText(setup, 'enter opens the type list');

    setup.mockInput.pressEnter();

    await waitForText(setup, '[x] approve');

    const dropdownFrame = setup.captureCharFrame();

    expect(dropdownFrame).toContain('[x] comment');
    expect(dropdownFrame).toContain('[x] request-changes');

    setup.mockInput.pressEnter();

    await waitForText(setup, '[ ] approve');

    expect(setup.captureCharFrame()).toContain('comment,request-changes');

    setup.mockInput.pressEscape();

    await waitForTextGone(setup, '[ ] approve');

    expect(setup.captureCharFrame()).toContain('comment,request-changes');

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

    expect(setup.captureCharFrame()).toContain('Mon-Fri all hours Europe/Berlin');

    setup.mockInput.pressKey('o');

    await waitForText(setup, 'Work days');

    for (let press = 0; press < 8; press++) {
      setup.mockInput.pressArrow('down');
    }

    await waitForText(setup, 'enter opens the day list');

    setup.mockInput.pressEnter();

    await waitForText(setup, '[x] Mon');

    const dropdownFrame = setup.captureCharFrame();

    expect(dropdownFrame).toContain('[x] Fri');
    expect(dropdownFrame).toContain('[ ] Sat');
    expect(dropdownFrame).toContain('[ ] Sun');

    for (let press = 0; press < 4; press++) {
      setup.mockInput.pressArrow('down');
    }

    setup.mockInput.pressEnter();

    await waitForText(setup, '[ ] Fri');

    expect(setup.captureCharFrame()).toContain('Mon-Thu');

    setup.mockInput.pressArrow('down');
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressEnter();

    await waitForText(setup, '[x] Sun');

    setup.mockInput.pressEscape();

    await waitForTextGone(setup, '[x] Mon');
    await waitForText(setup, 'Sun-Thu all hours Europe/Berlin');

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
