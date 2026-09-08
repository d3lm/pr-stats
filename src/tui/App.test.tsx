import { KeyCodes } from '@opentui/core/testing';
import { expect, test } from 'bun:test';
import { cacheSize } from '../cache';
import { formatBytes } from '../utils';
import { App } from './App';
import { destroyApp, initial, lineWith, renderApp, scrollToText, waitForText } from './testing/harness';
import { applyThemeState, defaultThemeState } from './theme';

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
     * and the scope row carries the headline percentiles. Every canned PR
     * took a single review round, so the PR count and the round count agree.
     * The canned p90 of 24 hours lands exactly on the one-day target, so the
     * headline reports the target as met.
     */
    expect(reviewFrame).toContain('3 PRs reviewed');
    expect(reviewFrame).toContain('3 review rounds');
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
    expect(setup.captureCharFrame()).toContain('2 PRs reviewed');
    expect(setup.captureCharFrame()).toContain('2 review rounds');

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
     * The settings dialog opens with shift+s on its General page, with
     * the auto-reload toggle selected first. The tab strip names every
     * page, only the rows of the shown page render, and the footer names
     * the keys that switch pages. Auto reload starts off, and the
     * interval row below it shows the default cadence a toggle would
     * start with.
     */
    setup.mockInput.pressKey('S');

    await waitForText(setup, 'reloads the data in the background');

    const settingsFrame = setup.captureCharFrame();

    expect(settingsFrame).toContain('Settings');
    expect(settingsFrame).toContain('tab/1-5 page');

    for (const page of ['General', 'Awaiting you', 'Notifications', 'Appearance', 'Data']) {
      expect(settingsFrame).toContain(page);
    }

    expect(settingsFrame).toContain('Auto reload');
    expect(settingsFrame).toContain('‹ no ›');
    expect(settingsFrame).toContain('Copy instead of open');
    expect(settingsFrame).not.toContain('Disable cache');
    expect(settingsFrame).not.toContain('Track mentions');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'time between the background reloads');

    expect(lineWith(setup.captureCharFrame(), 'Reload interval')).toContain('10m');

    /**
     * The link rows follow on the same page. The open-in row starts on
     * github and cycles to linear and back, and the copy-links toggle
     * closes the page.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'github opens the PR page');

    expect(setup.captureCharFrame()).toContain('Open PRs in');
    expect(setup.captureCharFrame()).toContain('‹ github ›');

    setup.mockInput.pressArrow('right');

    await waitForText(setup, '‹ linear ›');

    setup.mockInput.pressArrow('left');

    await waitForText(setup, '‹ github ›');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'clipboard');

    /**
     * Down past the last row of a page walks onto the first row of the
     * next page, and the dialog follows to that page. The awaiting-you
     * page starts with the mention tracking and the team requests on,
     * the team review count off, and the default-snooze row shows the
     * duration the snooze dialog starts with.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'searches the PRs that @-mention you');

    expect(setup.captureCharFrame()).toContain('Track mentions');
    expect(setup.captureCharFrame()).toContain('‹ yes ›');
    expect(setup.captureCharFrame()).not.toContain('Auto reload');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'only a team of yours is asked');

    expect(setup.captureCharFrame()).toContain('Team requests');
    expect(setup.captureCharFrame()).toContain('‹ yes ›');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'counts the team requests you reviewed');

    expect(setup.captureCharFrame()).toContain('Count team reviews');
    expect(setup.captureCharFrame()).toContain('‹ no ›');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'the duration the snooze dialog starts with');

    expect(lineWith(setup.captureCharFrame(), 'Default snooze')).toContain('30m');

    /**
     * Tab switches to the next page and lands on its first row. The
     * notifications toggle starts off, the mention and team request
     * toggles below it too, the channel row starts on auto, and the
     * test row below them names the channel the notification goes
     * through.
     */
    setup.mockInput.pressTab();

    await waitForText(setup, 'notifies you when a load finds');

    expect(setup.captureCharFrame()).toContain('Desktop notifications');
    expect(setup.captureCharFrame()).toContain('‹ no ›');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'also notifies you when someone @-mentions you');

    expect(setup.captureCharFrame()).toContain('Mention notifications');
    expect(setup.captureCharFrame()).toContain('‹ no ›');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'also notifies you when a PR gets requested');

    expect(setup.captureCharFrame()).toContain('Team request notifications');
    expect(setup.captureCharFrame()).toContain('‹ no ›');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'auto tries the terminal');

    expect(setup.captureCharFrame()).toContain('Notification channel');
    expect(setup.captureCharFrame()).toContain('‹ auto ›');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'sends a sample notification');

    expect(setup.captureCharFrame()).toContain('Send test notification');

    /**
     * Shift+tab goes back one page, and a digit jumps straight to the
     * page at that position. The appearance page holds the theme rows,
     * where left and right cycle the built-in themes and apply them
     * right away, and the debug run cannot persist the choice.
     */
    setup.mockInput.pressTab({ shift: true });

    await waitForText(setup, 'searches the PRs that @-mention you');

    setup.mockInput.pressKey('4');

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
     * and shows the error, and escape backs out to the settings dialog
     * on the page it left.
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

    await waitForText(setup, 'opens the color list');

    expect(setup.captureCharFrame()).toContain('Edit colors');

    /**
     * The data page opens on the disable-cache toggle. Toggling it flips
     * the value right away, and the debug run cannot persist it, which
     * the message slot reports.
     */
    setup.mockInput.pressKey('5');

    await waitForText(setup, 'refetch everything on every load');

    const dataFrame = setup.captureCharFrame();

    expect(dataFrame).toContain('Disable cache');
    expect(dataFrame).toContain('‹ no ›');
    expect(dataFrame).toContain('Clear cache');

    // the clear-cache row shows the size of the cache directory after its path
    expect(dataFrame).toContain(`pr-stats · ${formatBytes(cacheSize())}`);

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

    /**
     * The export row shows the file it would write, next to the
     * same-report hint. The enter press stays untested here because it
     * would write pr-stats.json into the repo, and the export itself is
     * covered by the export tests.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'writes the loaded stats to this file');

    expect(setup.captureCharFrame()).toContain('Export stats as JSON');
    expect(setup.captureCharFrame()).toContain('pr-stats.json');

    /**
     * The reset-settings action closes the page and mirrors the
     * clear-cache confirm flow, and the debug run has no settings file
     * to delete.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'deletes the settings file');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'press enter again to delete settings.json');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'nothing to reset');

    /**
     * Down from the last row of the last page wraps around to the first
     * row of the first page.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'reloads the data in the background');

    expect(setup.captureCharFrame()).toContain('Auto reload');

    setup.mockInput.pressEscape();

    await waitForText(setup, 'esc back');

    expect(setup.captureCharFrame()).not.toContain('Reload interval');
  } finally {
    destroyApp(setup);
    applyThemeState(defaultThemeState());
  }
}, 30_000);
