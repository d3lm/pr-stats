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
  /**
   * Persisting the reload settings needs an enabled cache, so this test
   * points the cache at a temp directory like the save-state test above
   * and loads the empty settings the way bootstrap would. The wider
   * terminal keeps the header status, which grows by the cadence, clear
   * of the data context on its left.
   */
  const dir = mkdtempSync(join(tmpdir(), 'pr-stats-app-'));

  process.env.PR_STATS_CACHE_DIR = dir;
  configureCache(true);
  loadSettings();

  const setup = await renderApp(<App initial={initial} onQuit={() => {}} />, { width: 140, height: 44 });

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    /**
     * Nothing reloads on its own while the setting is off, so the
     * refresh time of the first load stays put until the toggle flips,
     * and the header names no cadence.
     */
    const firstRefresh = await waitForRefresh(setup);

    expect(setup.captureCharFrame()).not.toContain('· every');

    /**
     * The dialog opens on the auto-reload toggle, which persists right
     * away, and the interval row below it keeps showing the default
     * cadence the toggle starts on.
     */
    setup.mockInput.pressKey('S');

    await waitForText(setup, 'reloads the data in the background');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'saved to settings.json');

    expect(setup.captureCharFrame()).toContain('‹ yes ›');
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ autoReload: true });

    /**
     * Enter edits the interval in place. A value the parser refuses
     * keeps the edit open and shows the error in the hint slot, and a
     * valid one applies, persists, and restarts the timer on the new
     * cadence.
     */
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

    /**
     * Back on the queue, the one-second cadence brings fresh refresh
     * times without any keypress, and the header names the cadence next
     * to the time.
     */
    setup.mockInput.pressEscape();

    await waitForText(setup, 'r reload');

    const secondRefresh = await waitForRefreshAfter(setup, firstRefresh);

    expect(setup.captureCharFrame()).toContain('· every 1s');

    await waitForRefreshAfter(setup, secondRefresh);

    /**
     * Turning the reload off stops the timer and keeps the interval in
     * the file, so turning it back on later resumes the same cadence. A
     * load that was in flight at the toggle still finishes, so the check
     * waits that out before it pins the refresh time and confirms that
     * no later load moves it. The dialog reopens on the interval row it
     * closed on, so one move up lands on the toggle.
     */
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
