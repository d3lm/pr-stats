import { KeyCodes } from '@opentui/core/testing';
import { expect, test } from 'bun:test';
import { App } from './App';
import {
  destroyApp,
  initial,
  lineWith,
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
    await waitForText(setup, '2 PRs awaiting your review');

    const pickerFrame = setup.captureCharFrame();

    expect(pickerFrame).toContain('▸  All repos');
    expect(pickerFrame).toContain('acme/api');
    expect(pickerFrame).toContain('acme/web');
    expect(pickerFrame).toContain('1 PR awaiting your review');
    expect(pickerFrame).not.toContain('Awaiting your review (n=');

    expect(pickerFrame).toContain('* Awaiting review   Reviewed   Mentions  t/T switches');

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

    setup.mockInput.pressKey('T');

    await waitForText(setup, 'open its mention inbox');

    setup.mockInput.pressKey('T');

    await waitForText(setup, 'list the open PRs you reviewed');

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

    setup.mockInput.pressKey('g');

    await waitForText(setup, 'All repos · grouped by repo');

    const groupedFrame = setup.captureCharFrame();

    expect(groupedFrame).toContain('Awaiting your review (n=2)');
    expect(groupedFrame).toContain('acme/api (n=1)');
    expect(groupedFrame).toContain('acme/web (n=1)');

    setup.mockInput.pressKey('g');

    await waitForTextGone(setup, 'acme/api (n=1)');

    expect(await pressEnterToOpen(setup, opened)).toBe('https://github.com/acme/api/pull/7');

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

    setup.mockInput.pressKey('2');

    await waitForText(setup, 'list its open PRs');

    const openPickerFrame = setup.captureCharFrame();

    expect(openPickerFrame).toContain('1 open PR');
    expect(openPickerFrame).toContain('0 open PRs');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Your open authored PRs (n=1)');

    const openFrame = setup.captureCharFrame();

    expect(openFrame).toContain('▸ All repos');
    expect(openFrame).toContain('acme/web#13');
    expect(openFrame).toContain('Redesign the dashboard');
    expect(openFrame).toContain('+2500/-400, 48 files');
    expect(openFrame).not.toContain('acme/api#10');

    expect(await pressEnterToOpen(setup, opened)).toBe('https://github.com/acme/web/pull/13');

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

test('lists the requests of your teams below the awaiting queue and hides them when the setting goes off', async () => {
  const setup = await renderApp(<App initial={initial} onQuit={() => {}} />, { width: 110, height: 44 });

  try {
    await waitForText(setup, '2 PRs awaiting your review, 1 requested of your team');

    expect(setup.captureCharFrame()).toContain('1 PR awaiting your review, 1 requested of your team');
    expect(setup.captureCharFrame()).not.toContain('acme/web#16');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Requested of your team (n=1)');

    const queueFrame = setup.captureCharFrame();

    expect(queueFrame).toContain('Awaiting your review (n=2)');
    expect(lineWith(queueFrame, 'acme/api#9')).toContain('Migrate the queue consumers · acme/backend');
    expect(queueFrame).not.toContain('acme/web#16');

    setup.mockInput.pressArrow('down');
    setup.mockInput.pressArrow('down');

    const moved = Date.now();

    while (Date.now() - moved < 15_000 && !lineWith(setup.captureCharFrame(), 'acme/api#9').includes('▸')) {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    setup.mockInput.pressKey('s');

    await waitForText(setup, 'Snooze for');

    expect(lineWith(setup.captureCharFrame(), 'acme/api#9 Migrate the queue consumers')).not.toContain('acme/backend');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Snoozed (n=1)');

    const snoozedFrame = setup.captureCharFrame();

    expect(snoozedFrame).not.toContain('Requested of your team (n=');
    expect(lineWith(snoozedFrame, 'acme/api#9')).toContain('until ');
    expect(lineWith(snoozedFrame, 'acme/api#9')).toContain('· acme/backend');

    setup.mockInput.pressKey('s');

    await waitForText(setup, 'Requested of your team (n=1)');

    expect(setup.captureCharFrame()).not.toContain('Snoozed (n=');

    setup.mockInput.pressKey('S');

    await waitForText(setup, 'reloads the data in the background');

    setup.mockInput.pressKey('2');

    await waitForText(setup, 'searches the PRs that @-mention you');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'only a team of yours is asked');

    expect(lineWith(setup.captureCharFrame(), 'Team requests')).toContain('‹ yes ›');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'setting not saved');

    expect(lineWith(setup.captureCharFrame(), 'Team requests')).toContain('‹ no ›');

    setup.mockInput.pressEscape();

    await waitForTextGone(setup, 'Track mentions');

    expect(setup.captureCharFrame()).toContain('Awaiting your review (n=2)');
    expect(setup.captureCharFrame()).not.toContain('Requested of your team (n=');
    expect(setup.captureCharFrame()).not.toContain('acme/api#9');

    setup.mockInput.pressEscape();

    await waitForText(setup, 'Select a repository');

    expect(setup.captureCharFrame()).toContain('2 PRs awaiting your review');
    expect(setup.captureCharFrame()).not.toContain('requested of your team');
  } finally {
    destroyApp(setup);
  }
}, 30_000);

test('toggles the Your PRs tab between the open queue and the merged stats', async () => {
  const setup = await renderApp(<App initial={initial} onQuit={() => {}} />, { width: 110, height: 44 });

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    setup.mockInput.pressKey('2');

    await waitForText(setup, 'list its open PRs');

    const openFrame = setup.captureCharFrame();

    expect(openFrame).toContain('Merged & closed');
    expect(openFrame).toContain('t/T switches');
    expect(openFrame).toContain('t merged stats');

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

    setup.mockInput.pressEscape();

    await waitForText(setup, 'open its charts');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, '▸  acme/api');

    setup.mockInput.pressEnter();

    await waitForText(setup, '3 of 3 PRs merged');

    expect(setup.captureCharFrame()).toContain('▸ acme/api');
    expect(setup.captureCharFrame()).toContain('3 PRs created');

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

    expect(await pressEnterToOpen(setup, opened)).toBe('https://linear.review/acme/api/pull/7');

    setup.mockInput.pressKey('S');

    await waitForText(setup, 'reloads the data in the background');

    for (const hint of ['time between the background reloads', 'github opens the PR page']) {
      setup.mockInput.pressArrow('down');
      await waitForText(setup, hint);
    }

    expect(setup.captureCharFrame()).toContain('Open PRs in');
    expect(setup.captureCharFrame()).toContain('‹ linear ›');

    setup.mockInput.pressArrow('right');

    await waitForText(setup, '‹ github ›');

    setup.mockInput.pressEscape();

    await waitForText(setup, 'esc back');

    expect(setup.captureCharFrame()).toContain('enter open ·');

    expect(await pressEnterToOpen(setup, opened)).toBe('https://github.com/acme/api/pull/7');

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
    await waitForText(setup, '2 PRs awaiting your review');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Awaiting your review (n=2)');

    expect(setup.captureCharFrame()).toContain('enter open');

    const offFrame = setup.captureCharFrame();
    const offLines = offFrame.split('\n');
    const offRow = offLines.findIndex((line) => line.includes('acme/api#7'));

    await setup.mockMouse.click(offLines[offRow].indexOf('acme/api#7'), offRow);
    await setup.renderOnce();

    expect(copied).toEqual([]);

    setup.mockInput.pressKey('S');

    await waitForText(setup, 'reloads the data in the background');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'time between the background reloads');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'github opens the PR page');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'clipboard');

    expect(setup.captureCharFrame()).toContain('Copy instead of open');
    expect(setup.captureCharFrame()).toContain('‹ no ›');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'setting not saved');

    expect(setup.captureCharFrame()).toContain('‹ yes ›');

    setup.mockInput.pressEscape();

    await waitForText(setup, 'enter copy link');

    expect(await pressEnterToOpen(setup, copied)).toBe('https://github.com/acme/api/pull/7');

    await waitForText(setup, '✔ copied acme/api#7 to the clipboard');

    expect(setup.captureCharFrame()).toContain('…');
    expect(opened).toEqual([]);

    setup.mockInput.pressKey('g');

    await waitForText(setup, 'All repos · grouped by repo');

    expect(setup.captureCharFrame()).not.toContain('copied acme/api#7');

    setup.mockInput.pressKey('g');

    await waitForTextGone(setup, 'acme/api (n=1)');

    const frame = setup.captureCharFrame();
    const lines = frame.split('\n');
    const rowIndex = lines.findIndex((line) => line.includes('acme/web#3'));

    await setup.mockMouse.click(lines[rowIndex].indexOf('acme/web#3'), rowIndex);

    await waitForText(setup, '✔ copied acme/web#3 to the clipboard');

    expect(copied).toEqual(['https://github.com/acme/api/pull/7', 'https://github.com/acme/web/pull/3']);
    expect(opened).toEqual([]);

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
    await waitForText(setup, '2 PRs awaiting your review');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Awaiting your review (n=2)');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'could not open the browser');

    setup.mockInput.pressKey('2');

    await waitForText(setup, 'list its open PRs');

    expect(setup.captureCharFrame()).not.toContain('could not open the browser');
  } finally {
    destroyApp(setup);
  }
}, 30_000);
