import { testRender } from '@opentui/react/test-utils';
import { join } from 'node:path';
import { act } from 'react';
import { configureAuth } from '../../github';
import { fetchParamsKey, type OptionsState } from '../state/options';

configureAuth(undefined, join(import.meta.dir, '..', 'testdata'));

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

export function mentionKey(user: string): string {
  return `${fetchParamsKey(initial)} ${user}`;
}

interface Setup {
  renderOnce: () => Promise<void>;
  captureCharFrame: () => string;
  mockInput: { pressEnter: () => void };
}

type AppSetup = Awaited<ReturnType<typeof testRender>>;

function setActEnvironment(on: boolean): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on;
}

/**
 * Turns the act environment off because React would log an act warning on every spinner tick.
 */
export async function renderApp(...args: Parameters<typeof testRender>): Promise<AppSetup> {
  const setup = await testRender(...args);

  setActEnvironment(false);

  return setup;
}

/**
 * The React root unmounts from the renderer's destroy event, so the destroy runs inside act to
 * avoid a warning.
 */
export function destroyApp(setup: AppSetup): void {
  setActEnvironment(true);

  act(() => {
    setup.renderer.destroy();
  });
}

/**
 * Polls on wall-clock time because the data load runs in child processes the render
 * scheduler cannot see.
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

export function clearInput(mockInput: { pressBackspace: () => void }, text: string): void {
  for (let remaining = text.length; remaining > 0; remaining -= 1) {
    mockInput.pressBackspace();
  }
}

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

export function lineWith(frame: string, text: string): string {
  const line = frame.split('\n').find((candidate) => candidate.includes(text));

  if (line === undefined) {
    throw new Error(`no line holds ${JSON.stringify(text)}, last frame:\n${frame}`);
  }

  return line;
}

/**
 * Accepts 12-hour and 24-hour clocks because the locale decides the format.
 */
export function refreshedAt(frame: string): string | null {
  return /refreshed (\d{1,2}:\d{2}:\d{2}(?: [AP]M)?)/.exec(frame)?.[1] ?? null;
}

export async function waitForRefresh(setup: Setup): Promise<string> {
  await waitForText(setup, 'refreshed ');

  const time = refreshedAt(setup.captureCharFrame());

  if (time === null) {
    throw new Error(`the header shows no refresh time, last frame:\n${setup.captureCharFrame()}`);
  }

  return time;
}

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
