import { KeyCodes } from '@opentui/core/testing';
import { expect, test } from 'bun:test';
import { App } from './App';
import { SCROLL_STEP_ROWS } from './hooks/scrollbar';
import { destroyApp, initial, renderApp, waitForText } from './testing/harness';

type AppSetup = Awaited<ReturnType<typeof renderApp>>;

const PAGE_UP = '\u001B[5~';

const PAGE_DOWN = '\u001B[6~';

const ANCHOR = 'Review time trend';

function anchorRow(setup: AppSetup): number {
  return setup
    .captureCharFrame()
    .split('\n')
    .findIndex((line) => line.includes(ANCHOR));
}

async function rowOnceMoved(setup: AppSetup, before: string): Promise<number> {
  const start = Date.now();

  while (Date.now() - start < 1000) {
    await setup.renderOnce();

    if (setup.captureCharFrame() !== before) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return anchorRow(setup);
}

async function rowAfterKey(setup: AppSetup, key: string): Promise<number> {
  const before = setup.captureCharFrame();

  setup.mockInput.pressKey(key);

  return rowOnceMoved(setup, before);
}

async function rowAfterWheel(setup: AppSetup, row: number, direction: 'up' | 'down'): Promise<number> {
  const before = setup.captureCharFrame();

  await setup.mockMouse.scroll(50, row, direction);

  return rowOnceMoved(setup, before);
}

test('every scroll input moves the charts pane once, by the shared step', async () => {
  const setup = await renderApp(<App initial={initial} onQuit={() => {}} />, { width: 110, height: 44 });

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    setup.mockInput.pressKey('3');

    await waitForText(setup, '3 reviewed, 2 pending');

    setup.mockInput.pressEnter();

    await waitForText(setup, ANCHOR);

    const top = anchorRow(setup);

    for (const [down, up] of [
      ['j', 'k'],
      [KeyCodes.ARROW_DOWN, KeyCodes.ARROW_UP],
    ]) {
      expect(await rowAfterKey(setup, down)).toBe(top - SCROLL_STEP_ROWS);
      expect(await rowAfterKey(setup, up)).toBe(top);
    }

    expect(await rowAfterWheel(setup, top, 'down')).toBe(top - SCROLL_STEP_ROWS);
    expect(await rowAfterWheel(setup, top, 'up')).toBe(top);

    // paging back can land a row off because OpenTUI rounds half of an odd viewport height
    const paged = await rowAfterKey(setup, PAGE_DOWN);

    expect(paged).toBeLessThan(top - SCROLL_STEP_ROWS);
    expect(await rowAfterKey(setup, PAGE_UP)).toBeGreaterThan(paged + SCROLL_STEP_ROWS);

    expect(await rowAfterKey(setup, KeyCodes.END)).toBe(-1);
    expect(setup.captureCharFrame()).toContain('Review time by repo');
    expect(await rowAfterKey(setup, KeyCodes.HOME)).toBe(top);
  } finally {
    destroyApp(setup);
  }
});
