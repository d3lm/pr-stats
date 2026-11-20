import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureCache } from '../cache';
import { loadSettings } from '../settings';
import { App } from './App';
import {
  clearInput,
  destroyApp,
  initial,
  lineWith,
  refreshedAt,
  renderApp,
  waitForRefresh,
  waitForRefreshAfter,
  waitForText,
} from './testing/harness';

test('reloads in the background on the configured interval while auto reload is on', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-stats-app-'));

  process.env.PR_STATS_CACHE_DIR = dir;

  configureCache(true);
  loadSettings();

  const setup = await renderApp(<App initial={initial} onQuit={() => {}} />, { width: 140, height: 44 });

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    const firstRefresh = await waitForRefresh(setup);

    expect(setup.captureCharFrame()).not.toContain('· every');

    setup.mockInput.pressKey('S');

    await waitForText(setup, 'reloads the data in the background');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'saved to settings.json');

    expect(setup.captureCharFrame()).toContain('‹ yes ›');
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ autoReload: true });

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'time between the background reloads');

    expect(lineWith(setup.captureCharFrame(), 'Reload interval')).toContain('10m');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'enter apply · esc cancel');

    clearInput(setup.mockInput, '10m');

    await setup.mockInput.typeText('1d');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'invalid reload interval "1d"');

    expect(setup.captureCharFrame()).toContain('enter apply · esc cancel');

    clearInput(setup.mockInput, '1d');

    await setup.mockInput.typeText('1s');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'saved to settings.json');

    expect(lineWith(setup.captureCharFrame(), 'Reload interval')).toContain('1s');
    expect(setup.captureCharFrame()).toContain('↑/↓ select · tab/1-5 page · enter apply');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      autoReload: true,
      reloadInterval: '1s',
    });

    setup.mockInput.pressEscape();

    await waitForText(setup, 'r reload');

    const secondRefresh = await waitForRefreshAfter(setup, firstRefresh);

    expect(setup.captureCharFrame()).toContain('· every 1s');

    await waitForRefreshAfter(setup, secondRefresh);

    setup.mockInput.pressKey('S');

    await waitForText(setup, 'time between the background reloads');

    setup.mockInput.pressArrow('up');

    await waitForText(setup, 'reloads the data in the background');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'saved to settings.json');

    expect(setup.captureCharFrame()).toContain('‹ no ›');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      autoReload: false,
      reloadInterval: '1s',
    });

    setup.mockInput.pressEscape();

    await waitForText(setup, 'r reload');

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const settledRefresh = await waitForRefresh(setup);

    expect(setup.captureCharFrame()).not.toContain('· every');

    await new Promise((resolve) => setTimeout(resolve, 2500));
    await setup.renderOnce();

    expect(refreshedAt(setup.captureCharFrame())).toBe(settledRefresh);
  } finally {
    destroyApp(setup);
    configureCache(false);
    delete process.env.PR_STATS_CACHE_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
