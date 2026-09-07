import { testRender } from '@opentui/react/test-utils';
import { join } from 'node:path';
import { act } from 'react';
import { configureAuth } from '../../github';
import { fetchParamsKey, type OptionsState } from '../state/options';

/**
 * Shared harness for the App tests, which live in the App.*.test.tsx files
 * next to the component. Importing this module points gh at the fake in
 * testdata and exports the option defaults and frame-polling helpers the
 * tests drive the rendered App with.
 */

/**
 * The fake gh in testdata serves canned search results and GraphQL
 * responses, so the whole pipeline runs without network access. The debug
 * path routes every gh call through it and ignores any ambient tokens,
 * exactly like passing --debug on the command line.
 */
configureAuth(undefined, join(import.meta.dir, '..', 'testdata'));

/**
 * Holds the options every App test starts from unless it overrides them.
 */
export const initial: OptionsState = {
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

/**
 * Builds the key the App stores the mention baseline under for the
 * initial options and the given resolved login.
 */
export function mentionKey(user: string): string {
  return `${fetchParamsKey(initial)} ${user}`;
}

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
export async function renderApp(...args: Parameters<typeof testRender>): Promise<AppSetup> {
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
export function destroyApp(setup: AppSetup): void {
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
export async function waitForText(setup: Setup, text: string, timeoutMs = 15_000): Promise<void> {
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
export async function waitForTextGone(setup: Setup, text: string, timeoutMs = 15_000): Promise<void> {
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
export function clearInput(mockInput: { pressBackspace: () => void }, text: string): void {
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
export async function scrollToText(setup: AppSetup, text: string, maxPresses = 120): Promise<void> {
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
 * Returns the frame line that holds the given text, so an assertion can
 * check a row's value without matching the same text elsewhere on the
 * screen, like a chart label behind a dialog.
 */
export function lineWith(frame: string, text: string): string {
  const line = frame.split('\n').find((candidate) => candidate.includes(text));

  if (line === undefined) {
    throw new Error(`no line holds ${JSON.stringify(text)}, last frame:\n${frame}`);
  }

  return line;
}

/**
 * Reads the refresh time the header shows, or null while the spinner or
 * an error covers the status slot. The locale decides between a 12-hour
 * and a 24-hour clock, so the pattern accepts both.
 */
export function refreshedAt(frame: string): string | null {
  return /refreshed (\d{1,2}:\d{2}:\d{2}(?: [AP]M)?)/.exec(frame)?.[1] ?? null;
}

/**
 * Waits for the header to show a refresh time and returns it. The
 * spinner covers the slot while a load runs, so this settles on an idle
 * header.
 */
export async function waitForRefresh(setup: Setup): Promise<string> {
  await waitForText(setup, 'refreshed ');

  const time = refreshedAt(setup.captureCharFrame());

  if (time === null) {
    throw new Error(`the header shows no refresh time, last frame:\n${setup.captureCharFrame()}`);
  }

  return time;
}

/**
 * Polls the frame until the header shows a refresh time other than the
 * given one, which proves a load finished in the meantime.
 */
export async function waitForRefreshAfter(setup: Setup, previous: string, timeoutMs = 15_000): Promise<string> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await setup.renderOnce();

    const current = refreshedAt(setup.captureCharFrame());

    if (current !== null && current !== previous) {
      return current;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`timed out waiting for a refresh after ${previous}, last frame:\n${setup.captureCharFrame()}`);
}

/**
 * Presses enter once and returns the URL the injected opener recorded
 * for it, polling render passes until the record lands.
 */
export async function pressEnterToOpen(setup: Setup, opened: string[]): Promise<string> {
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
