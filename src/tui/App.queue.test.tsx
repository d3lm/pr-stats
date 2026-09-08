import { KeyCodes } from '@opentui/core/testing';
import { expect, test } from 'bun:test';
import { App } from './App';
import {
  destroyApp,
  initial,
  pressEnterToOpen,
  renderApp,
  scrollToText,
  waitForText,
  waitForTextGone,
} from './testing/harness';

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
    expect(pickerFrame).toContain('1 PR awaiting your review');
    expect(pickerFrame).not.toContain('Awaiting your review (n=');

    /**
     * The sub-tab bar dots the awaiting queue, because two PRs wait for
     * a review, and leaves the inbox plain, because every canned mention
     * predates the seed.
     */
    expect(pickerFrame).toContain('* Awaiting review   Reviewed   Mentions  t/T switches');

    /**
     * Enter on All repos opens the aggregate view, the awaiting queue
     * longest wait first, with the scope header naming it. The PRs you
     * reviewed and the mentions live on their own sub-tabs.
     */
    setup.mockInput.pressEnter();

    await waitForText(setup, 'Awaiting your review (n=2)');

    const pendingFrame = setup.captureCharFrame();

    expect(pendingFrame).toContain('▸ All repos');
    expect(pendingFrame).toContain('acme/api#7');
    expect(pendingFrame).toContain('Refactor the billing worker');
    expect(pendingFrame).toContain('acme/web#3');
    expect(pendingFrame).toContain('Add pagination to the list view');
    expect(pendingFrame).not.toContain('Reviewed (n=');
    expect(pendingFrame).not.toContain('acme/api#8');
    expect(pendingFrame).not.toContain('Review time distribution');
    expect(pendingFrame).toContain('t reviewed');

    /**
     * Shift+t cycles the sub-tabs backward, so from the awaiting queue
     * it wraps around to the mentions sub-tab, and a second press steps
     * back to the reviewed sub-tab. Both open on their own pickers,
     * because neither has an opened scope yet.
     */
    setup.mockInput.pressKey('T');

    await waitForText(setup, 'open its mention inbox');

    setup.mockInput.pressKey('T');

    await waitForText(setup, 'list the open PRs you reviewed');

    /**
     * Another shift+t returns to the awaiting queue, which kept its
     * opened scope, and from there the t key cycles the sub-tabs
     * forward. The reviewed sub-tab opens on its own picker, whose
     * details count the open PRs you reviewed per repo, and enter lists
     * them. The mentions sub-tab follows with the inbox, where every
     * canned mention predates the seed and reads as read, and a third
     * press returns to the awaiting queue again.
     */
    setup.mockInput.pressKey('T');

    await waitForText(setup, 'Awaiting your review (n=2)');

    setup.mockInput.pressKey('t');

    await waitForText(setup, 'list the open PRs you reviewed');

    expect(setup.captureCharFrame()).toContain('1 reviewed PR still open');
    expect(setup.captureCharFrame()).toContain('0 reviewed PRs still open');
    expect(setup.captureCharFrame()).toContain('t mentions');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Reviewed (n=1)');

    expect(setup.captureCharFrame()).toContain('acme/api#8');
    expect(setup.captureCharFrame()).toContain('Add caching to the sessions store');
    expect(setup.captureCharFrame()).not.toContain('s snooze');

    setup.mockInput.pressKey('t');

    await waitForText(setup, 'open its mention inbox');

    expect(setup.captureCharFrame()).toContain('0 unread mentions, 2 read');
    expect(setup.captureCharFrame()).toContain('t awaiting review');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Read (n=2)');

    expect(setup.captureCharFrame()).toContain('acme/web#13');
    expect(setup.captureCharFrame()).toContain('d mark unread');

    setup.mockInput.pressKey('t');

    await waitForText(setup, 'Awaiting your review (n=2)');

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
    expect(openFrame).toContain('t/T switches');
    expect(openFrame).toContain('t merged stats');

    /**
     * The t key switches to the merged sub-tab, which opens on its own
     * repo picker. The details split the closed PRs into merged and
     * closed unmerged, and the repo with the most merges sorts first.
     * With only two sub-tabs, shift+t flips back to the open sub-tab
     * and plain t flips to the merged one again.
     */
    setup.mockInput.pressKey('t');

    await waitForText(setup, 'open its charts');

    const pickerFrame = setup.captureCharFrame();

    expect(pickerFrame).toContain('3 merged, 1 closed unmerged');
    expect(pickerFrame).toContain('0 merged, 1 closed unmerged');
    expect(pickerFrame).toContain('t open PRs');

    setup.mockInput.pressKey('T');

    await waitForText(setup, 'list its open PRs');

    setup.mockInput.pressKey('t');

    await waitForText(setup, 'open its charts');

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

test('opens the PR on Linear while the open-in setting names it, and copies the GitHub link regardless', async () => {
  const opened: string[] = [];
  const copied: string[] = [];

  const setup = await renderApp(
    <App
      initial={initial}
      initialOpenIn="linear"
      onQuit={() => {}}
      openUrl={(url) => {
        opened.push(url);
      }}
      copyUrl={(url) => {
        copied.push(url);
      }}
    />,
    { width: 128, height: 44 },
  );

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Awaiting your review (n=2)');

    /**
     * Enter passes the highlighted PR's GitHub link through the Linear
     * rewrite, so the opener receives the linear.review counterpart at
     * the same path.
     */
    expect(await pressEnterToOpen(setup, opened)).toBe('https://linear.review/acme/api/pull/7');

    /**
     * The settings row shows the saved target and cycles back to github,
     * after which the next enter opens the GitHub page again.
     */
    setup.mockInput.pressKey('S');

    await waitForText(setup, 'Disable cache');

    for (let index = 0; index < 8; index += 1) {
      setup.mockInput.pressArrow('down');
    }

    await waitForText(setup, 'github opens the PR page');

    expect(setup.captureCharFrame()).toContain('‹ linear ›');

    setup.mockInput.pressArrow('right');

    await waitForText(setup, '‹ github ›');

    setup.mockInput.pressEscape();

    await waitForText(setup, 'esc back');

    expect(setup.captureCharFrame()).toContain('enter open ·');

    expect(await pressEnterToOpen(setup, opened)).toBe('https://github.com/acme/api/pull/7');

    /**
     * With the target back on linear and copy-links on, enter copies the
     * GitHub link, because a copied link is for sharing and GitHub is
     * the canonical address. The dialog reopens on the open-in row it
     * was closed on, so the cycle needs no walk this time.
     */
    setup.mockInput.pressKey('S');

    await waitForText(setup, '‹ github ›');

    setup.mockInput.pressArrow('right');

    await waitForText(setup, '‹ linear ›');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'clipboard');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, '‹ yes ›');

    setup.mockInput.pressEscape();

    await waitForText(setup, 'enter copy link');

    expect(await pressEnterToOpen(setup, copied)).toBe('https://github.com/acme/api/pull/7');
    expect(opened).toEqual(['https://linear.review/acme/api/pull/7', 'https://github.com/acme/api/pull/7']);
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
    { width: 128, height: 44 },
  );

  try {
    /**
     * The awaiting-review tab opens on its repo picker, and enter on All
     * repos opens the aggregate queue, whose hint names the open action
     * while the setting is off. The frame is just wide enough for the
     * full queue hint, so only a footer notice makes it truncate.
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
     * The copy-links toggle sits below the cache, reload, and
     * notification rows in the settings dialog. Toggling it flips the
     * value right away, and the debug run cannot persist it, which the
     * message slot reports.
     */
    setup.mockInput.pressKey('S');

    await waitForText(setup, 'Disable cache');

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

    await waitForText(setup, 'github opens the PR page');

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
