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

    const frame = setup.captureCharFrame();
    const lines = frame.split('\n');

    expect(lines.some((line) => line.includes('Service level') && line.includes('Time to review'))).toBe(true);
    expect(lines.some((line) => line.includes('Review time trend') && line.includes('When you review'))).toBe(true);

    expect(
      lines.some((line) => line.includes('Reviews completed per week') && line.includes('Review time vs size')),
    ).toBe(true);

    setup.mockInput.pressKey('t');

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

function columnOf(frame: string, needle: string): number {
  const line = frame.split('\n').find((row) => row.includes(needle));

  return line === undefined ? -1 : line.indexOf(needle);
}

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

    const first = setup.captureCharFrame();
    const statsColumn = columnOf(first, 'mean 10.1h');

    expect(statsColumn).toBeGreaterThan(0);
    expect(statsColumn + 'mean 10.1h'.length).toBe(columnOf(first, '3 of 3 reviews') + '3 of 3 reviews'.length);

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

    // the mount layout measures content at twice the viewport height, which can flash the scrollbar for one frame
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
