import type { CliRenderer } from '@opentui/core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NotifyChannel } from '../../settings';

export type Notifier = (title: string, body: string, onError: (message: string) => void) => void;

export interface RendererNotificationBoundary {
  readonly capabilities: { notifications: boolean; terminal: { name: string } } | null;
  triggerNotification(message: string, title?: string): boolean;
  writeOut(data: string): void;
}

/**
 * A BEL written straight to stdout can land inside a frame from the native output thread and end
 * an OSC 8 hyperlink.
 */
export function notificationBoundary(renderer: CliRenderer): RendererNotificationBoundary {
  const raw = renderer as unknown as { writeOut?: (data: string) => unknown };

  return {
    get capabilities() {
      return renderer.capabilities;
    },
    triggerNotification: (message, title) => renderer.triggerNotification(message, title),
    writeOut: (data) => {
      if (typeof raw.writeOut === 'function') {
        raw.writeOut(data);
      } else {
        process.stdout.write(data);
      }
    },
  };
}

const BELL = '\u0007';

type TerminalQuirk = 'iterm' | 'apple-terminal';

/**
 * The iTerm2 profile drops OSC 9 unless Notification Center Alerts is on, and Apple Terminal never
 * implemented it although OpenTUI selects it there.
 */
function terminalQuirk(renderer: RendererNotificationBoundary): TerminalQuirk | null {
  const name = renderer.capabilities?.terminal.name ?? '';

  if (/iterm/i.test(name)) {
    return 'iterm';
  }

  if (/apple_terminal|terminal\.app/i.test(name)) {
    return 'apple-terminal';
  }

  return null;
}

export function createNotifier(renderer: RendererNotificationBoundary, channel: NotifyChannel): Notifier {
  return (title, body, onError) => {
    if (channel === 'bell') {
      renderer.writeOut(BELL);
      return;
    }

    const tryTerminal = channel === 'terminal' || (channel === 'auto' && terminalQuirk(renderer) !== 'apple-terminal');

    if (tryTerminal && renderer.triggerNotification(body, title)) {
      return;
    }

    if (channel === 'terminal') {
      onError('the terminal has no notification support, switch the channel to auto, the platform command, or bell');
      return;
    }

    sendNotification(title, body, onError);
  };
}

export function notificationChannel(renderer: RendererNotificationBoundary, channel: NotifyChannel): string | null {
  if (channel === 'bell' || channel === 'terminal') {
    return channel;
  }

  if (
    channel === 'auto' &&
    renderer.capabilities?.notifications === true &&
    terminalQuirk(renderer) !== 'apple-terminal'
  ) {
    return 'terminal';
  }

  return notificationTool();
}

export function notificationCaveat(renderer: RendererNotificationBoundary, channel: NotifyChannel): string | null {
  if (channel === 'command' || channel === 'bell') {
    return null;
  }

  switch (terminalQuirk(renderer)) {
    case 'iterm': {
      return 'iTerm2 shows these only once Notification Center Alerts is on under Settings › Profiles › Terminal';
    }
    case 'apple-terminal': {
      return channel === 'auto'
        ? 'Terminal.app ignores terminal notifications, so auto takes the platform command here'
        : 'Terminal.app ignores terminal notifications · switch the channel to auto, command, or bell';
    }
    default: {
      return null;
    }
  }
}

/**
 * The helper runs directly rather than through open, which would lose the exit code.
 */
const HELPER_BINARY = 'pr-stats.app/Contents/MacOS/pr-stats-notifier';

const HELPER_NAME = 'pr-stats.app';

/**
 * Mirrors the denied case of the Outcome enum in native/macos/main.swift.
 */
const HELPER_DENIED_EXIT = 3;

/**
 * A helper running longer than this is waiting on the first-send permission prompt.
 */
const PROMPT_GRACE_MS = 5000;

let helperLookup: string | null | undefined;

export function notificationHelper(): string | null {
  if (helperLookup === undefined) {
    helperLookup = locateHelper();
  }

  return helperLookup;
}

function locateHelper(): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  for (const base of ['./', '../../../dist/']) {
    const path = fileURLToPath(new URL(base + HELPER_BINARY, import.meta.url));

    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

export function notificationTool(helper: string | null = notificationHelper()): string | null {
  switch (process.platform) {
    case 'darwin': {
      return helper === null ? 'osascript' : HELPER_NAME;
    }
    case 'linux': {
      return 'notify-send';
    }
    default: {
      return null;
    }
  }
}

/**
 * Some Linux notification servers, GNOME's among them, render the body as Pango markup.
 */
function escapeMarkup(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export interface NotifyCommand {
  command: string;
  args: string[];
  name: string;
}

/**
 * The strings go in as arguments so nothing is quoted into AppleScript, and the leading title and
 * the -- keep a body starting with a dash from parsing as an option.
 */
export function notifyCommand(
  title: string,
  body: string,
  helper: string | null = notificationHelper(),
): NotifyCommand | null {
  switch (process.platform) {
    case 'darwin': {
      if (helper !== null) {
        return { command: helper, args: [title, body], name: HELPER_NAME };
      }

      return {
        command: 'osascript',
        args: [
          '-e',
          'on run argv',
          '-e',
          'display notification (item 2 of argv) with title (item 1 of argv) sound name "default"',
          '-e',
          'end run',
          title,
          body,
        ],
        name: 'osascript',
      };
    }
    case 'linux': {
      return {
        command: 'notify-send',
        args: ['--app-name=pr-stats', '--', title, escapeMarkup(body)],
        name: 'notify-send',
      };
    }
    default: {
      return null;
    }
  }
}

export interface NotifyChild {
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  unref(): void;
}

export type NotifySpawn = (command: string, args: string[]) => NotifyChild;

const spawnDetached: NotifySpawn = (command, args) => spawn(command, args, { stdio: 'ignore', detached: true });

const runningHelpers = new Set<{ started: number }>();

/**
 * Every helper waiting on the permission prompt posts once the user allows, so a backlog would
 * flood the desktop.
 */
export function sendNotification(
  title: string,
  body: string,
  onError: (message: string) => void,
  spawnProcess: NotifySpawn = spawnDetached,
  helper: string | null = notificationHelper(),
): void {
  const spec = notifyCommand(title, body, helper);

  if (spec === null) {
    onError('desktop notifications are not supported on this platform');
    return;
  }

  const isHelper = spec.name === HELPER_NAME;
  const run = { started: Date.now() };

  if (isHelper && [...runningHelpers].some(({ started }) => run.started - started > PROMPT_GRACE_MS)) {
    onError('the notification permission prompt for pr-stats is still waiting for an answer');
    return;
  }

  const child = spawnProcess(spec.command, spec.args);

  if (isHelper) {
    runningHelpers.add(run);
  }

  child.on('error', (error) => {
    runningHelpers.delete(run);
    onError(`could not send the notification (${error.message})`);
  });

  child.on('exit', (code) => {
    runningHelpers.delete(run);

    if (code === null || code === 0) {
      return;
    }

    if (isHelper && code === HELPER_DENIED_EXIT) {
      onError('notifications for pr-stats are turned off, allow them under System Settings › Notifications › pr-stats');
      return;
    }

    onError(`could not send the notification (${spec.name} exited with ${code})`);
  });

  child.unref();
}
