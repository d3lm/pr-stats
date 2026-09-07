import { expect, test } from 'bun:test';
import { App } from './App';
import { destroyApp, initial, renderApp, waitForText } from './testing/harness';

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
