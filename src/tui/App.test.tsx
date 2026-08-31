import { KeyCodes } from '@opentui/core/testing';
import { testRender } from '@opentui/react/test-utils';
import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { configureCache } from '../cache';
import { configureAuth } from '../github';
import { loadSettings } from '../settings';
import { App } from './App';
import { readSavedOptions, type OptionsState } from './state/options';
import { applyThemeState, defaultThemeState } from './theme';

/**
 * The fake gh in testdata serves canned search results and GraphQL
 * responses, so the whole pipeline runs without network access. The debug
 * path routes every gh call through it and ignores any ambient tokens,
 * exactly like passing --debug on the command line.
 */
configureAuth(undefined, `${import.meta.dir}/testdata`);

const initial: OptionsState = {
  since: '2026-06-01',
  repos: '',
  user: '',
  target: '1d',
  targetPercentile: '',
  sizeTarget: '400l,20f',
  workDays: 'Mon-Fri',
  workHours: '0-24',
  tz: 'Europe/Berlin',
  wallClock: false,
  includeDrafts: false,
  reviewTypes: '',
};

interface Setup {
  renderOnce: () => Promise<void>;
  captureCharFrame: () => string;
  mockInput: { pressEnter: () => void };
}

type AppSetup = Awaited<ReturnType<typeof testRender>>;

/**
 * Toggles React's act environment flag, which controls whether React
 * warns about state updates that commit outside act.
 */
function setActEnvironment(on: boolean): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on;
}

/**
 * Renders the App through testRender and turns the act environment off
 * for the test body. These tests deliberately poll real frames while
 * timers and child processes drive the updates, which is the setup the
 * act warning exists to flag, so leaving the flag on would bury the test
 * output under one warning block per spinner tick.
 */
async function renderApp(...args: Parameters<typeof testRender>): Promise<AppSetup> {
  const setup = await testRender(...args);

  setActEnvironment(false);

  return setup;
}

/**
 * Destroys the renderer with the act environment back on and the whole
 * teardown inside act. The React root cleans itself up from the
 * renderer's destroy event outside the act call testRender wraps around
 * the unmount, so only an act around the destroy itself covers that
 * update without a warning.
 */
function destroyApp(setup: AppSetup): void {
  setActEnvironment(true);

  act(() => {
    setup.renderer.destroy();
  });
}

/**
 * Polls the frame until the text appears. The data load runs through child
 * processes, which the render scheduler knows nothing about, so this waits
 * on wall-clock time instead of scheduler passes. Keypresses reach the
 * handler with the latest committed state, so a single press before this
 * wait is always enough.
 */
async function waitForText(setup: Setup, text: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await setup.renderOnce();

    if (setup.captureCharFrame().includes(text)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`timed out waiting for ${JSON.stringify(text)}, last frame:\n${setup.captureCharFrame()}`);
}

/**
 * Polls the frame until the text disappears, the inverse of waitForText,
 * for transitions that remove content, like ungrouping a queue whose
 * flat frame shows no text of its own.
 */
async function waitForTextGone(setup: Setup, text: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await setup.renderOnce();

    if (!setup.captureCharFrame().includes(text)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    `timed out waiting for ${JSON.stringify(text)} to disappear, last frame:\n${setup.captureCharFrame()}`,
  );
}

/**
 * Backspaces over every character of the given text, clearing an input
 * that currently holds it before a fresh value gets typed.
 */
function clearInput(mockInput: { pressBackspace: () => void }, text: string): void {
  for (let remaining = text.length; remaining > 0; remaining -= 1) {
    mockInput.pressBackspace();
  }
}

/**
 * Scrolls the focused charts pane down with j until the text enters the
 * frame, for cards that sit between the top and the end of a pane taller
 * than the viewport. Charts already above the target stay above it, so
 * consecutive calls must follow the pane's card order.
 */
async function scrollToText(setup: AppSetup, text: string, maxPresses = 120): Promise<void> {
  for (let press = 0; press < maxPresses; press++) {
    await setup.renderOnce();

    if (setup.captureCharFrame().includes(text)) {
      return;
    }

    setup.mockInput.pressKey('j');
    await new Promise((resolve) => setTimeout(resolve, 15));
  }

  throw new Error(
    `scrolled to the end without finding ${JSON.stringify(text)}, last frame:\n${setup.captureCharFrame()}`,
  );
}

/**
 * Presses enter once and returns the URL the injected opener recorded
 * for it, polling render passes until the record lands.
 */
async function pressEnterToOpen(setup: Setup, opened: string[]): Promise<string> {
  const before = opened.length;
  const start = Date.now();

  setup.mockInput.pressEnter();

  while (Date.now() - start < 15_000) {
    const recorded = opened.at(-1);

    if (recorded !== undefined && opened.length > before) {
      return recorded;
    }

    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`enter never opened a PR, last frame:\n${setup.captureCharFrame()}`);
}

test('loads canned data and renders both tabs, the options modal, and the settings and theme dialogs', async () => {
  const setup = await renderApp(<App initial={initial} onQuit={() => {}} />, { width: 110, height: 44 });

  try {
    /**
     * The app opens on the awaiting-review tab, whose queue spans two
     * repos in the canned data, so the load is done once its repo picker
     * renders. The review tab opens on its own picker the same way.
     */
    await waitForText(setup, '2 PRs awaiting your review');

    setup.mockInput.pressKey('3');

    await waitForText(setup, '3 reviewed, 2 pending');

    const listFrame = setup.captureCharFrame();

    expect(listFrame).toContain('All repos');
    expect(listFrame).toContain('acme/api');
    expect(listFrame).toContain('acme/web');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Time to review');

    const reviewFrame = setup.captureCharFrame();

    expect(reviewFrame).toContain('▸ All repos');
    expect(reviewFrame).toContain('@testuser');

    /**
     * The pinned strip above the charts summarizes how the PRs classified,
     * and the scope row carries the headline percentiles. The canned p90
     * of 24 hours lands exactly on the one-day target, so the headline
     * reports the target as met.
     */
    expect(reviewFrame).toContain('3 reviewed on request');
    expect(reviewFrame).toContain('2 awaiting you');
    expect(reviewFrame).toContain('1 closed unreviewed');
    expect(reviewFrame).toContain('2 reviewed unasked (excluded)');
    expect(reviewFrame).toContain('p50 6h');
    expect(reviewFrame).toContain('p90 24h');
    expect(reviewFrame).toContain('at the 1d target');
    expect(reviewFrame).toContain('3 of 3 reviews');

    /**
     * The scroll area opens with the full-width distribution strip, and
     * the service-level gauge leads the chart cards because a target is
     * configured. The pending review on acme/web has waited past the
     * one-day target, so the gauge counts it as a guaranteed miss next
     * to the completed reviews. The pending queue lives on its own tab,
     * so the review tab never repeats it as a list. The terminal is too
     * narrow for two chart columns here, so the cards stack and the
     * histogram marks the bucket that holds the median.
     */
    expect(reviewFrame).toContain('Review time distribution');
    expect(reviewFrame).toContain('mean 10.1h');
    expect(reviewFrame).not.toContain('Awaiting your review (n=');
    expect(reviewFrame).toContain('Service level');
    expect(reviewFrame).toContain('inside 1d');
    expect(reviewFrame).toContain('awaiting and already over');
    expect(reviewFrame).toContain('← p50 6h');

    /**
     * The remaining charts sit below the fold, so scroll the review pane
     * down card by card in the grid's fill order. The scatter plots the
     * three completed reviews against their PR sizes, the cycles
     * histogram counts every canned PR as one-and-done, and the verdict
     * gauge splits the three completed reviews into two approvals and
     * one change request.
     */
    await scrollToText(setup, 'Review time trend');
    await scrollToText(setup, 'When you review');
    await scrollToText(setup, 'reviews in that hour');
    await scrollToText(setup, '3 weeks · 3 total');

    expect(setup.captureCharFrame()).toContain('Reviews completed per week');

    await scrollToText(setup, 'Review time vs size');
    await scrollToText(setup, 'Review cycles per PR');
    await scrollToText(setup, '← p50 1 ');
    await scrollToText(setup, 'PR age at request');
    await scrollToText(setup, 'Review verdicts');
    await scrollToText(setup, 'changes requested');

    expect(setup.captureCharFrame()).toContain('approved');

    await scrollToText(setup, 'Pending request age');

    /**
     * The end of the pane holds the by-repo comparison, which the
     * aggregate view renders because the data spans two repos, with the
     * off-hours gauge above it.
     */
    setup.mockInput.pressKey(KeyCodes.END);

    await waitForText(setup, 'Review time by repo');

    const reviewEndFrame = setup.captureCharFrame();

    expect(reviewEndFrame).toContain('Off-hours share');
    expect(reviewEndFrame).toContain('weekday');
    expect(reviewEndFrame).toContain('weekend');
    expect(reviewEndFrame).toContain('n=2');

    /**
     * Escape returns to the picker, and the row below All repos drills
     * into acme/api alone.
     */
    setup.mockInput.pressEscape();

    await waitForText(setup, 'Select a repository');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, '▸  acme/api');

    setup.mockInput.pressEnter();

    await waitForText(setup, '2 of 3 reviews');

    /**
     * The scope header above the charts names the opened repo, so it stays
     * clear which repo the stats cover.
     */
    expect(setup.captureCharFrame()).toContain('▸ acme/api');
    expect(setup.captureCharFrame()).toContain('2 reviewed on request');

    setup.mockInput.pressKey('4');

    await waitForText(setup, '5 authored PRs');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'PR size distribution');

    const sizeFrame = setup.captureCharFrame();

    /**
     * The size tab mirrors the review tab layout, with its own pinned
     * strip, headline percentiles, over-target list, distribution strip,
     * and the lines-total histogram marking the median bucket.
     */
    expect(sizeFrame).toContain('▸ All repos');
    expect(sizeFrame).toContain('5 PRs analyzed');
    expect(sizeFrame).toContain('1 open');
    expect(sizeFrame).toContain('4 merged or closed');
    expect(sizeFrame).toContain('0 inaccessible (excluded)');
    expect(sizeFrame).toContain('p50 400 lines');
    expect(sizeFrame).toContain('5 of 5 PRs');
    expect(sizeFrame).toContain('mean 899');
    expect(sizeFrame).toContain('Authored PRs over the size target');
    expect(sizeFrame).toContain('← p50 400');

    /**
     * The remaining size charts sit below the fold, so scroll the pane
     * down card by card in the grid's fill order. The net lines trend
     * sums additions minus deletions per week, so its line ends on the
     * +200 of the last merged PR.
     */
    await scrollToText(setup, 'PR size trend');
    await scrollToText(setup, 'Files touched');
    await scrollToText(setup, 'weekly net lines');

    expect(setup.captureCharFrame()).toContain('Net lines trend');

    await scrollToText(setup, '+200');
    await scrollToText(setup, '9 weeks · 5 total');

    expect(setup.captureCharFrame()).toContain('PRs opened per week');

    await scrollToText(setup, 'authored within <= 400 lines, <= 20 files');

    expect(setup.captureCharFrame()).toContain('Size target');

    setup.mockInput.pressKey(KeyCodes.END);

    await waitForText(setup, 'Size spread');

    expect(setup.captureCharFrame()).toContain('inside target');

    /**
     * The size picker keeps its own cursor, so it starts back at All
     * repos and two moves land on acme/web.
     */
    setup.mockInput.pressEscape();

    await waitForText(setup, '2 authored PRs');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, '▸  acme/api');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, '▸  acme/web');

    setup.mockInput.pressEnter();

    await waitForText(setup, '2 of 5 PRs');

    expect(setup.captureCharFrame()).toContain('▸ acme/web');
    expect(setup.captureCharFrame()).toContain('p50 45 lines');

    /**
     * The comments tab opens on its own picker, whose details count the
     * comments per repo, most commented first.
     */
    setup.mockInput.pressKey('5');

    await waitForText(setup, '30 comments on 5 PRs');

    const commentListFrame = setup.captureCharFrame();

    expect(commentListFrame).toContain('22 comments on 3 PRs');
    expect(commentListFrame).toContain('8 comments on 2 PRs');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Comments per PR distribution');

    const commentFrame = setup.captureCharFrame();

    /**
     * The comments tab mirrors the stats tab layout, with its own pinned
     * strip, headline percentiles, most-commented list, distribution
     * strip, the comments histogram marking the median bucket, and the
     * scatter of comments against PR size.
     */
    expect(commentFrame).toContain('▸ All repos');
    expect(commentFrame).toContain('5 PRs analyzed');
    expect(commentFrame).toContain('30 comments received');
    expect(commentFrame).toContain('1 without comments');
    expect(commentFrame).toContain('0 inaccessible (excluded)');
    expect(commentFrame).toContain('p50 3 comments');
    expect(commentFrame).toContain('p90 16 comments');
    expect(commentFrame).toContain('mean 6');
    expect(commentFrame).toContain('Most commented PRs');
    expect(commentFrame).toContain('16 comments (4 discussion, 12 review)');
    expect(commentFrame).toContain('← p50 3');

    /**
     * The remaining comment charts sit below the fold, so scroll the pane
     * down card by card in the grid's fill order. The volume chart sums
     * the comment counts per week instead of counting PRs, so its total
     * says 30 over the same nine weeks the size tab spans.
     */
    await scrollToText(setup, 'Comment trend');
    await scrollToText(setup, 'Comments vs size');
    await scrollToText(setup, '9 weeks · 30 total');

    expect(setup.captureCharFrame()).toContain('Comments received per week');

    setup.mockInput.pressKey(KeyCodes.END);

    await waitForText(setup, 'Feedback rate');

    const commentEndFrame = setup.captureCharFrame();

    expect(commentEndFrame).toContain('Comment spread');
    expect(commentEndFrame).toContain('no comments');

    setup.mockInput.pressKey('o');

    await waitForText(setup, 'Repositories');

    const optionsFrame = setup.captureCharFrame();

    expect(optionsFrame).toContain('Options');
    expect(optionsFrame).toContain('Since');
    expect(optionsFrame).toContain('2026-06-01');
    expect(optionsFrame).toContain('Work hours');
    expect(optionsFrame).not.toContain('Clear cache');
    expect(optionsFrame).not.toContain('applies on reload');

    // nothing is saved, so the save-state line offers the save
    expect(optionsFrame).toContain('press s to save these options for future runs');

    /**
     * Debug runs keep the cache disabled, so saving from the modal stores
     * nothing and says so in the error slot. The next navigation clears
     * the message again.
     */
    setup.mockInput.pressKey('s');

    await waitForText(setup, 'cache is disabled for this session · options not saved');

    /**
     * Toggle wall clock with space. Moving up from the first field wraps
     * to the wall clock toggle at the bottom, and the toggle flips the
     * time-mode label in the header. Wall clock is an analysis option, so
     * the reload notice stays away.
     */
    setup.mockInput.pressArrow('up');

    await waitForText(setup, 'measure raw elapsed time including weekends');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'wall-clock time');

    expect(setup.captureCharFrame()).not.toContain('options changed');

    /**
     * Toggling a data option marks the loaded data stale, which lights up
     * the reload notice in the app footer. The waits between the key
     * presses let React commit each selection change first.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'ISO date or a relative value');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'comma-separated owner/name');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'GitHub login');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'include PRs that are currently drafts');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'options changed · press r to reload');

    /**
     * Escape closes the modal, which brings back the stats hints and
     * removes the option fields from the frame.
     */
    setup.mockInput.pressEscape();

    await waitForText(setup, 'esc back');

    expect(setup.captureCharFrame()).not.toContain('Work hours');

    /**
     * The settings dialog opens with s, with the disable-cache toggle
     * selected first. Toggling it flips the value right away, and the
     * debug run cannot persist it, which the message slot reports.
     */
    setup.mockInput.pressKey('s');

    await waitForText(setup, 'Disable cache');

    const settingsFrame = setup.captureCharFrame();

    expect(settingsFrame).toContain('Settings');
    expect(settingsFrame).toContain('Clear cache');
    expect(settingsFrame).toContain('refetch everything on every load');
    expect(settingsFrame).toContain('‹ no ›');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'setting not saved');

    expect(setup.captureCharFrame()).toContain('‹ yes ›');

    /**
     * The clear-cache action sits below the toggle. The first enter arms
     * the confirmation, escape backs out without closing the dialog, and
     * a confirmed clear reports that the cache is disabled, because debug
     * runs never touch it.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'deletes the cached PR data');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'press enter again to clear the cache');

    setup.mockInput.pressEscape();

    await waitForText(setup, 'deletes the cached PR data');

    expect(setup.captureCharFrame()).not.toContain('press enter again');
    expect(setup.captureCharFrame()).toContain('Settings');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'press enter again to clear the cache');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'nothing to clear');

    // the copy-links toggle sits between the cache rows and the theme rows
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'clipboard');

    /**
     * The theme rows sit between the copy-links toggle and the reset
     * action. Left and right cycle the built-in themes and apply them
     * right away, and the debug run cannot persist the choice.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'built-in color theme');

    expect(setup.captureCharFrame()).toContain('‹ default ›');

    setup.mockInput.pressArrow('right');

    await waitForText(setup, '‹ green ›');

    expect(setup.captureCharFrame()).toContain('setting not saved');

    setup.mockInput.pressArrow('left');

    await waitForText(setup, '‹ default ›');

    /**
     * The edit-colors row opens the theme dialog, which lists every
     * theme color with its hex value. A bad value keeps the edit open
     * and shows the error, and escape backs out to the settings dialog.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'opens the color list');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Theme colors');

    const themeFrame = setup.captureCharFrame();

    expect(themeFrame).toContain('accent');
    expect(themeFrame).toContain('#f0b689');
    expect(themeFrame).toContain('background of the screen');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'enter apply · esc cancel');

    await setup.mockInput.typeText('zz');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'must be a hex color');

    setup.mockInput.pressEscape();

    await waitForText(setup, 'background of the screen');

    setup.mockInput.pressEscape();

    await waitForText(setup, 'Disable cache');

    /**
     * The reset-settings action mirrors the clear-cache confirm flow,
     * and the debug run has no settings file to delete.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'deletes the settings file');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'press enter again to delete settings.json');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'nothing to reset');

    /**
     * The export row sits last and shows the file it would write, next
     * to the same-report hint. The enter press stays untested here
     * because it would write pr-stats.json into the repo, and the export
     * itself is covered by the export tests.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'writes the loaded stats to this file');

    expect(setup.captureCharFrame()).toContain('Export stats as JSON');
    expect(setup.captureCharFrame()).toContain('pr-stats.json');

    setup.mockInput.pressEscape();

    await waitForText(setup, 'esc back');

    expect(setup.captureCharFrame()).not.toContain('Clear cache');
  } finally {
    destroyApp(setup);
    applyThemeState(defaultThemeState());
  }
}, 30_000);

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

    await waitForText(setup, 'enter open · ←/→ tabs');

    setup.mockInput.pressKey('s');

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

    await waitForText(setup, 'clipboard');

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

test('drives the queue tabs through the repo picker, the grouping toggle, and the browser opener', async () => {
  const opened: string[] = [];

  const setup = await renderApp(
    <App
      initial={initial}
      onQuit={() => {}}
      openUrl={(url) => {
        opened.push(url);
      }}
    />,
    { width: 110, height: 44 },
  );

  try {
    /**
     * The canned pending queue spans two repos, so the awaiting-review
     * tab opens on its repo picker, whose details count the waiting PRs
     * per repo.
     */
    await waitForText(setup, '2 PRs awaiting your review');

    const pickerFrame = setup.captureCharFrame();

    expect(pickerFrame).toContain('▸  All repos');
    expect(pickerFrame).toContain('acme/api');
    expect(pickerFrame).toContain('acme/web');
    expect(pickerFrame).toContain('1 PR awaiting your review, 1 reviewing');
    expect(pickerFrame).not.toContain('Awaiting your review (n=');

    /**
     * Enter on All repos opens the aggregate view, the awaiting queue
     * longest wait first and the reviewing queue with the open PR you
     * already reviewed, with the scope header naming it.
     */
    setup.mockInput.pressEnter();

    await waitForText(setup, 'Awaiting your review (n=2)');

    const pendingFrame = setup.captureCharFrame();

    expect(pendingFrame).toContain('▸ All repos');
    expect(pendingFrame).toContain('acme/api#7');
    expect(pendingFrame).toContain('Refactor the billing worker');
    expect(pendingFrame).toContain('acme/web#3');
    expect(pendingFrame).toContain('Add pagination to the list view');
    expect(pendingFrame).toContain('Reviewing (n=1)');
    expect(pendingFrame).toContain('acme/api#8');
    expect(pendingFrame).toContain('Add caching to the sessions store');
    expect(pendingFrame).not.toContain('Review time distribution');

    /**
     * The g key splits each section into indented per-repo sub-lists
     * under its title and marks the grouped state in the header. A
     * second press restores the flat lists, which only the vanished
     * sub-list headers tell apart, because the section titles stay.
     */
    setup.mockInput.pressKey('g');

    await waitForText(setup, 'All repos · grouped by repo');

    const groupedFrame = setup.captureCharFrame();

    expect(groupedFrame).toContain('Awaiting your review (n=2)');
    expect(groupedFrame).toContain('acme/api (n=1)');
    expect(groupedFrame).toContain('acme/web (n=1)');
    expect(groupedFrame).toContain('Reviewing (n=1)');

    setup.mockInput.pressKey('g');

    await waitForTextGone(setup, 'acme/api (n=1)');

    /**
     * Enter opens the highlighted PR through the injected opener instead
     * of a real browser. The cursor sits on the longest-waiting PR, the
     * request on acme/api#7.
     */
    expect(await pressEnterToOpen(setup, opened)).toBe('https://github.com/acme/api/pull/7');

    /**
     * Escape returns to the picker, and the last row drills into the
     * acme/web queue alone.
     */
    setup.mockInput.pressEscape();

    await waitForText(setup, 'Select a repository');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, '▸  acme/api');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, '▸  acme/web');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Awaiting your review (n=1)');

    const webFrame = setup.captureCharFrame();

    expect(webFrame).toContain('▸ acme/web');
    expect(webFrame).toContain('acme/web#3');
    expect(webFrame).not.toContain('acme/api#7');
    expect(webFrame).not.toContain('acme/api#8');

    /**
     * The open-PRs tab lists every repo with an analyzed authored PR,
     * like the size tab, and its details count the still-open PRs per
     * repo, which can be zero.
     */
    setup.mockInput.pressKey('2');

    await waitForText(setup, 'list its open PRs');

    const openPickerFrame = setup.captureCharFrame();

    expect(openPickerFrame).toContain('1 open PR');
    expect(openPickerFrame).toContain('0 open PRs');

    /**
     * Enter on All repos opens the aggregate list, which holds
     * acme/web#13 alone, with its age and size in the lead column.
     */
    setup.mockInput.pressEnter();

    await waitForText(setup, 'Your open authored PRs (n=1)');

    const openFrame = setup.captureCharFrame();

    expect(openFrame).toContain('▸ All repos');
    expect(openFrame).toContain('acme/web#13');
    expect(openFrame).toContain('Redesign the dashboard');
    expect(openFrame).toContain('+2500/-400, 48 files');
    expect(openFrame).not.toContain('acme/api#10');

    /**
     * The open-PRs tab keeps its own cursor, and enter opens its
     * highlighted PR the same way.
     */
    expect(await pressEnterToOpen(setup, opened)).toBe('https://github.com/acme/web/pull/13');

    /**
     * A repo without open PRs can still be opened from the picker and
     * shows the empty message under its scope header.
     */
    setup.mockInput.pressEscape();

    await waitForText(setup, 'list its open PRs');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, '▸  acme/web');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, '▸  acme/api');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'No open authored PRs found.');

    expect(setup.captureCharFrame()).toContain('▸ acme/api');
  } finally {
    destroyApp(setup);
  }
}, 30_000);

test('toggles the Your PRs tab between the open queue and the merged stats', async () => {
  const setup = await renderApp(<App initial={initial} onQuit={() => {}} />, { width: 110, height: 44 });

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    /**
     * The Your PRs tab opens on the open sub-tab with its repo picker,
     * and the sub-tab bar names both sub-tabs with the key that switches
     * them.
     */
    setup.mockInput.pressKey('2');

    await waitForText(setup, 'list its open PRs');

    const openFrame = setup.captureCharFrame();

    expect(openFrame).toContain('Merged & closed');
    expect(openFrame).toContain('t switches');
    expect(openFrame).toContain('t merged stats');

    /**
     * The t key switches to the merged sub-tab, which opens on its own
     * repo picker. The details split the closed PRs into merged and
     * closed unmerged, and the repo with the most merges sorts first.
     */
    setup.mockInput.pressKey('t');

    await waitForText(setup, 'open its charts');

    const pickerFrame = setup.captureCharFrame();

    expect(pickerFrame).toContain('3 merged, 1 closed unmerged');
    expect(pickerFrame).toContain('0 merged, 1 closed unmerged');
    expect(pickerFrame).toContain('t open PRs');

    /**
     * Enter on All repos opens the merged stats, with the outcome counts
     * in the pinned strip, the time-to-merge percentiles in the headline,
     * and the merged and closed lists above the distribution strip.
     */
    setup.mockInput.pressEnter();

    await waitForText(setup, 'Time to merge distribution');

    const mergedFrame = setup.captureCharFrame();

    expect(mergedFrame).toContain('▸ All repos');
    expect(mergedFrame).toContain('5 PRs created');
    expect(mergedFrame).toContain('3 merged');
    expect(mergedFrame).toContain('1 closed unmerged');
    expect(mergedFrame).toContain('1 still open');
    expect(mergedFrame).toContain('0 inaccessible (excluded)');
    expect(mergedFrame).toContain('3 of 5 PRs merged');
    expect(mergedFrame).toContain('Recently merged PRs');
    expect(mergedFrame).toContain('to merge');
    expect(mergedFrame).toContain('acme/api#14');
    expect(mergedFrame).toContain('Closed without merging');
    expect(mergedFrame).toContain('to close');
    expect(mergedFrame).toContain('acme/web#12');

    /**
     * The remaining charts sit below the fold, so scroll the pane down
     * card by card in the grid's fill order. The first-review pair
     * covers the three canned PRs that got a review from someone else,
     * where api#14's author-only replies never count, and no open PR is
     * still waiting, so the awaiting histogram stays away. The scatter
     * plots merge time against lines changed over the three merged PRs.
     */
    await scrollToText(setup, 'Time to merge trend');
    await scrollToText(setup, 'Time to first review');

    expect(setup.captureCharFrame()).toContain('created → first review received');

    await scrollToText(setup, 'First review time trend');

    expect(setup.captureCharFrame()).not.toContain('Awaiting first review');

    await scrollToText(setup, 'Merge rate trend');

    expect(setup.captureCharFrame()).toContain('weekly merge rate');

    await scrollToText(setup, 'Merge time vs size');
    await scrollToText(setup, 'cumulative PRs by week');

    expect(setup.captureCharFrame()).toContain('Created vs merged');

    await scrollToText(setup, 'PRs created per week');
    await scrollToText(setup, 'PRs merged per week');

    /**
     * The end of the pane holds the merged volume, the outcome and
     * review-coverage gauges, and the reviewer leaderboard. The canned
     * data has alice on three PRs and bob on one, and api#14 merged with
     * only the author's own replies, so it counts as merged unreviewed.
     */
    setup.mockInput.pressKey(KeyCodes.END);

    await waitForText(setup, 'where your authored PRs ended up');

    const endFrame = setup.captureCharFrame();

    expect(endFrame).toContain('merged PRs that received a review');
    expect(endFrame).toContain('merged unreviewed');
    expect(endFrame).toContain('Who reviews your PRs');
    expect(endFrame).toContain('alice');
    expect(endFrame).toContain('3 reviews');
    expect(endFrame).toContain('bob');
    expect(endFrame).toContain('1 review');

    /**
     * The nine canned reviewers overflow the leaderboard's eight-row cap
     * by one, so ivan hides behind the overflow line and the x key lifts
     * the cap in place and restores it. The footer hint flips between
     * expand and collapse along the way.
     */
    expect(endFrame).toContain('x expand');
    expect(endFrame).toContain('+ 1 more · x expands');
    expect(endFrame).not.toContain('ivan');

    setup.mockInput.pressKey('x');

    await waitForText(setup, 'ivan');

    const expandedFrame = setup.captureCharFrame();

    expect(expandedFrame).not.toContain('+ 1 more');
    expect(expandedFrame).toContain('x collapse');

    setup.mockInput.pressKey('x');

    await waitForText(setup, '+ 1 more');

    /**
     * Escape returns to the picker, and the row below All repos drills
     * into acme/api, where every authored PR got merged.
     */
    setup.mockInput.pressEscape();

    await waitForText(setup, 'open its charts');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, '▸  acme/api');

    setup.mockInput.pressEnter();

    await waitForText(setup, '3 of 3 PRs merged');

    expect(setup.captureCharFrame()).toContain('▸ acme/api');
    expect(setup.captureCharFrame()).toContain('3 PRs created');

    /**
     * The t key switches back to the open queue, which kept its own
     * picker scope.
     */
    setup.mockInput.pressKey('t');

    await waitForText(setup, 'list its open PRs');
  } finally {
    destroyApp(setup);
  }
}, 30_000);

test('copies the PR link instead of opening it while the copy-links setting is on', async () => {
  const opened: string[] = [];
  const copied: string[] = [];

  const setup = await renderApp(
    <App
      initial={initial}
      onQuit={() => {}}
      openUrl={(url) => {
        opened.push(url);
      }}
      copyUrl={(url) => {
        copied.push(url);
      }}
    />,
    { width: 110, height: 44 },
  );

  try {
    /**
     * The awaiting-review tab opens on its repo picker, and enter on All
     * repos opens the aggregate queue, whose hint names the open action
     * while the setting is off.
     */
    await waitForText(setup, '2 PRs awaiting your review');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Awaiting your review (n=2)');

    expect(setup.captureCharFrame()).toContain('enter open');

    /**
     * While the setting is off, a click on a PR reference stays with the
     * terminal hyperlink and never reaches the app.
     */
    const offFrame = setup.captureCharFrame();
    const offLines = offFrame.split('\n');
    const offRow = offLines.findIndex((line) => line.includes('acme/api#7'));

    await setup.mockMouse.click(offLines[offRow].indexOf('acme/api#7'), offRow);
    await setup.renderOnce();

    expect(copied).toEqual([]);

    /**
     * The copy-links toggle sits below the cache rows in the settings
     * dialog. Toggling it flips the value right away, and the debug run
     * cannot persist it, which the message slot reports.
     */
    setup.mockInput.pressKey('s');

    await waitForText(setup, 'Disable cache');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'deletes the cached PR data');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'clipboard');

    expect(setup.captureCharFrame()).toContain('Copy instead of open');
    expect(setup.captureCharFrame()).toContain('‹ no ›');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'setting not saved');

    expect(setup.captureCharFrame()).toContain('‹ yes ›');

    // closing the dialog brings back the queue hint, now naming the copy
    setup.mockInput.pressEscape();

    await waitForText(setup, 'enter copy link');

    /**
     * Enter copies the highlighted PR's link through the injected copier
     * instead of opening anything, and the footer reports the copy with
     * the checkmark. The notice keeps its full width next to the long
     * queue hint, which truncates with an ellipsis instead of colliding.
     */
    expect(await pressEnterToOpen(setup, copied)).toBe('https://github.com/acme/api/pull/7');

    await waitForText(setup, '✔ copied acme/api#7 to the clipboard');

    expect(setup.captureCharFrame()).toContain('…');
    expect(opened).toEqual([]);

    /**
     * The next keypress dismisses the notice. Grouping the list commits
     * a visible frame change, so the check waits on that instead of a
     * frame that looks the same either way.
     */
    setup.mockInput.pressKey('g');

    await waitForText(setup, 'All repos · grouped by repo');

    expect(setup.captureCharFrame()).not.toContain('copied acme/api#7');

    setup.mockInput.pressKey('g');

    await waitForTextGone(setup, 'acme/api (n=1)');

    /**
     * A click on a PR reference copies that PR's link, without moving
     * the cursor onto its row first.
     */
    const frame = setup.captureCharFrame();
    const lines = frame.split('\n');
    const rowIndex = lines.findIndex((line) => line.includes('acme/web#3'));

    await setup.mockMouse.click(lines[rowIndex].indexOf('acme/web#3'), rowIndex);

    await waitForText(setup, '✔ copied acme/web#3 to the clipboard');

    expect(copied).toEqual(['https://github.com/acme/api/pull/7', 'https://github.com/acme/web/pull/3']);
    expect(opened).toEqual([]);

    /**
     * The notice expires on its own after a short dwell, so it clears
     * without any keypress and the full hints come back.
     */
    const expiry = Date.now();

    while (Date.now() - expiry < 10_000 && setup.captureCharFrame().includes('copied acme/web#3')) {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(setup.captureCharFrame()).not.toContain('copied acme/web#3');
    expect(setup.captureCharFrame()).not.toContain('…');
  } finally {
    destroyApp(setup);
  }
}, 30_000);

test('surfaces a failed browser open in the footer and clears it on the next keypress', async () => {
  const setup = await renderApp(
    <App
      initial={initial}
      onQuit={() => {}}
      openUrl={(_url, onError) => {
        onError('could not open the browser (spawn open ENOENT)');
      }}
    />,
    { width: 110, height: 44 },
  );

  try {
    /**
     * The awaiting-review tab opens on its repo picker, and enter on All
     * repos opens the aggregate queue.
     */
    await waitForText(setup, '2 PRs awaiting your review');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Awaiting your review (n=2)');

    /**
     * Enter runs the injected opener, which reports a failure instead of
     * opening anything, and the footer shows the message.
     */
    setup.mockInput.pressEnter();

    await waitForText(setup, 'could not open the browser');

    /**
     * The next keypress dismisses the notice. The tab switch commits in
     * the same render as the clear, so the new frame is already free of
     * the message.
     */
    setup.mockInput.pressKey('2');

    await waitForText(setup, 'list its open PRs');

    expect(setup.captureCharFrame()).not.toContain('could not open the browser');
  } finally {
    destroyApp(setup);
  }
}, 30_000);

test('lays the review charts out in two columns on wide terminals', async () => {
  const setup = await renderApp(<App initial={initial} onQuit={() => {}} />, { width: 150, height: 52 });

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    setup.mockInput.pressKey('3');

    await waitForText(setup, '3 reviewed, 2 pending');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Time to review');

    /**
     * The two card columns fit side by side at this width, so the card
     * titles of a row share a frame line. The service-level gauge leads
     * the grid because the canned options set a review target, so the
     * first row pairs it with the time-to-review histogram, and the
     * following rows pair the trend with the heatmap and the volume
     * chart with the review-time scatter.
     */
    const frame = setup.captureCharFrame();
    const lines = frame.split('\n');

    expect(lines.some((line) => line.includes('Service level') && line.includes('Time to review'))).toBe(true);
    expect(lines.some((line) => line.includes('Review time trend') && line.includes('When you review'))).toBe(true);

    expect(
      lines.some((line) => line.includes('Reviews completed per week') && line.includes('Review time vs size')),
    ).toBe(true);

    /**
     * The size tab gets the same two-column treatment. The left column's
     * histogram subtitle and the right column's trend title share the
     * first grid row, and the second row pairs the files histogram with
     * the net lines trend.
     */
    setup.mockInput.pressKey('4');

    await waitForText(setup, '5 authored PRs');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'PR size distribution');

    const sizeFrame = setup.captureCharFrame();
    const sizeLines = sizeFrame.split('\n');

    expect(
      sizeLines.some((line) => line.includes('total lines changed per authored PR') && line.includes('PR size trend')),
    ).toBe(true);

    expect(sizeLines.some((line) => line.includes('Files touched') && line.includes('Net lines trend'))).toBe(true);
    expect(sizeFrame).toContain('PRs opened per week');
  } finally {
    destroyApp(setup);
  }
}, 30_000);

/**
 * Returns the column where the needle starts on its frame line, or -1
 * when no line contains it.
 */
function columnOf(frame: string, needle: string): number {
  const line = frame.split('\n').find((row) => row.includes(needle));

  return line === undefined ? -1 : line.indexOf(needle);
}

/**
 * Reports whether the frame draws the overlaid scrollbar. Only the
 * full-width section rules and the scrollbar reach the outermost column,
 * so any glyph there besides a rule cell is the scrollbar thumb or track.
 */
function barSeen(frame: string): boolean {
  return frame.split('\n').some((row) => row.length >= 110 && row[109] !== ' ' && row[109] !== '─');
}

test('shows the scrollbar promptly and keeps the stats line still while the charts mount', async () => {
  const setup = await renderApp(<App initial={initial} onQuit={() => {}} />, { width: 110, height: 44 });

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    setup.mockInput.pressKey('3');

    await waitForText(setup, '3 reviewed, 2 pending');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'mean 10.1h');

    /**
     * The pinned headline and the distribution stats share the same right
     * padding, so their right-aligned ends land on the same column.
     */
    const first = setup.captureCharFrame();
    const statsColumn = columnOf(first, 'mean 10.1h');

    expect(statsColumn).toBeGreaterThan(0);
    expect(statsColumn + 'mean 10.1h'.length).toBe(columnOf(first, '3 of 3 reviews') + '3 of 3 reviews'.length);

    /**
     * The stats line must hold its column while the mount settles, and
     * the scrollbar must arrive within the first frames rather than after
     * a settle timer. The frames below span well past the old 100ms
     * window, where the arriving scrollbar used to push the line one
     * column left.
     */
    let barFrame = -1;

    for (let frame = 0; frame < 8; frame++) {
      const captured = setup.captureCharFrame();

      expect(columnOf(captured, 'mean 10.1h')).toBe(statsColumn);

      if (barFrame < 0 && barSeen(captured)) {
        barFrame = frame;
      }

      await new Promise((resolve) => setTimeout(resolve, 30));
      await setup.renderOnce();
    }

    expect(barFrame).toBeGreaterThanOrEqual(0);
    expect(barFrame).toBeLessThanOrEqual(2);
  } finally {
    destroyApp(setup);
  }
}, 30_000);

test('never flashes the scrollbar when a list fits the viewport', async () => {
  const setup = await renderApp(<App initial={initial} onQuit={() => {}} />, { width: 110, height: 44 });

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    /**
     * Switching tabs mounts the open-PRs picker, and enter on All repos
     * mounts a fresh queue panel. Its single row fits the viewport with
     * room to spare, so the scrollbar must stay hidden on every frame,
     * including the very frame that first paints the list. The mount
     * layout measures the content at twice the viewport height, which
     * used to flash the scrollbar on that frame before the corrected
     * pass hid it again. The loop samples each frame right after it
     * renders so that flash frame cannot slip through.
     */
    setup.mockInput.pressKey('2');

    await waitForText(setup, 'list its open PRs');

    setup.mockInput.pressEnter();

    let framesAfterSwitch = 0;

    for (let frame = 0; frame < 80 && framesAfterSwitch < 8; frame++) {
      await setup.renderOnce();

      const captured = setup.captureCharFrame();

      expect(barSeen(captured)).toBe(false);

      if (captured.includes('Your open authored PRs (n=1)')) {
        framesAfterSwitch += 1;
      }

      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    expect(framesAfterSwitch).toBe(8);
  } finally {
    destroyApp(setup);
  }
}, 30_000);
