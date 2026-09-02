import { expect, setSystemTime, test } from 'bun:test';
import {
  createNotifier,
  notificationCaveat,
  notificationChannel,
  notificationTool,
  notifyCommand,
  sendNotification,
  type NotifyChild,
  type NotifySpawn,
  type RendererNotificationBoundary,
} from './notify';

/**
 * Runs the callback with process.platform posing as the given platform,
 * so the command routing can be checked for macOS and Linux on whatever
 * machine runs the tests, and restores the real value afterwards.
 */
function withPlatform(platform: NodeJS.Platform, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');

  Object.defineProperty(process, 'platform', { value: platform, configurable: true });

  try {
    run();
  } finally {
    Object.defineProperty(process, 'platform', original ?? { value: platform, configurable: true });
  }
}

/**
 * Stands in for a spawned child. The test fires its exit or error by
 * hand, so the exit-code handling runs without a process.
 */
class FakeChild implements NotifyChild {
  private readonly _errorListeners: ((error: Error) => void)[] = [];
  private readonly _exitListeners: ((code: number | null) => void)[] = [];

  on(event: 'error' | 'exit', listener: ((error: Error) => void) | ((code: number | null) => void)): this {
    if (event === 'error') {
      this._errorListeners.push(listener as (error: Error) => void);
    } else {
      this._exitListeners.push(listener as (code: number | null) => void);
    }

    return this;
  }

  unref(): void {
    // nothing to release on a fake
  }

  exit(code: number | null): void {
    for (const listener of this._exitListeners) {
      listener(code);
    }
  }

  fail(message: string): void {
    for (const listener of this._errorListeners) {
      listener(new Error(message));
    }
  }
}

/**
 * Builds a spawn stand-in that records every command and hands out fake
 * children the test controls.
 */
function fakeSpawn(): { calls: { command: string; args: string[] }[]; children: FakeChild[]; spawn: NotifySpawn } {
  const calls: { command: string; args: string[] }[] = [];
  const children: FakeChild[] = [];

  return {
    calls,
    children,
    spawn: (command, args) => {
      const child = new FakeChild();

      calls.push({ command, args });
      children.push(child);

      return child;
    },
  };
}

const HELPER = '/pkg/dist/pr-stats.app/Contents/MacOS/pr-stats-notifier';

/**
 * Builds a renderer stub whose trigger records every call and answers
 * with the given acceptance, standing in for a terminal with or without
 * a notification protocol, and whose writeOut records the raw bytes the
 * bell channel sends. The terminal name feeds the quirk detection, so a
 * test can pose as iTerm2 or Apple Terminal. The command paths stay
 * untested here because they spawn a real process, and the channel
 * routing around them is what this file covers.
 */
function fakeRenderer(
  accepts: boolean,
  name = '',
): {
  renderer: RendererNotificationBoundary;
  calls: { message: string; title?: string }[];
  written: string[];
} {
  const calls: { message: string; title?: string }[] = [];
  const written: string[] = [];

  return {
    calls,
    written,
    renderer: {
      capabilities: { notifications: accepts, terminal: { name } },
      triggerNotification(message: string, title?: string) {
        calls.push({ message, title });
        return accepts;
      },
      writeOut(data: string) {
        written.push(data);
      },
    },
  };
}

test('the auto and terminal channels post through an accepting terminal without errors', () => {
  for (const channel of ['auto', 'terminal'] as const) {
    const { renderer, calls, written } = fakeRenderer(true);
    const errors: string[] = [];

    createNotifier(renderer, channel)('the title', 'the body', (message) => errors.push(message));

    expect(calls).toEqual([{ message: 'the body', title: 'the title' }]);
    expect(written).toEqual([]);
    expect(errors).toEqual([]);
  }
});

test('a forced terminal channel reports a refusing terminal instead of falling back', () => {
  const { renderer, calls } = fakeRenderer(false);
  const errors: string[] = [];

  createNotifier(renderer, 'terminal')('the title', 'the body', (message) => errors.push(message));

  expect(calls.length).toBe(1);
  expect(errors.length).toBe(1);
  expect(errors[0]).toContain('no notification support');
});

test('the bell channel writes the BEL byte and never touches the notification protocol', () => {
  const { renderer, calls, written } = fakeRenderer(true);
  const errors: string[] = [];

  createNotifier(renderer, 'bell')('the title', 'the body', (message) => errors.push(message));

  expect(written).toEqual(['\u0007']);
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});

test('auto skips the terminal on Apple Terminal, which swallows the sequence, while a forced terminal still sends', () => {
  const skipped = fakeRenderer(true, 'Apple_Terminal');
  const errors: string[] = [];

  /**
   * The fallback would spawn a real command on this machine, so the test
   * poses as a platform without one for the duration of the send. The
   * unsupported-platform report then proves the send took the command
   * path without the terminal ever being asked.
   */
  withPlatform('freebsd', () => {
    createNotifier(skipped.renderer, 'auto')('the title', 'the body', (message) => errors.push(message));
  });

  expect(skipped.calls).toEqual([]);
  expect(errors).toEqual(['desktop notifications are not supported on this platform']);
  expect(notificationChannel(skipped.renderer, 'auto')).toBe(notificationTool());

  const forced = fakeRenderer(true, 'Apple_Terminal');

  createNotifier(forced.renderer, 'terminal')('the title', 'the body', () => {});

  expect(forced.calls).toEqual([{ message: 'the body', title: 'the title' }]);

  // iTerm2 keeps the terminal path on auto, because the sequence works once the profile allows it
  expect(notificationChannel(fakeRenderer(true, 'iTerm2').renderer, 'auto')).toBe('terminal');
});

test('names the channel a send would take for each setting', () => {
  const accepting = fakeRenderer(true).renderer;
  const refusing = fakeRenderer(false).renderer;

  expect(notificationChannel(accepting, 'auto')).toBe('terminal');
  expect(notificationChannel(refusing, 'auto')).toBe(notificationTool());

  // the forced channels ignore what the terminal reports
  expect(notificationChannel(refusing, 'terminal')).toBe('terminal');
  expect(notificationChannel(accepting, 'command')).toBe(notificationTool());
  expect(notificationChannel(refusing, 'bell')).toBe('bell');
});

test('explains the terminals that swallow the notification sequence and stays quiet elsewhere', () => {
  const iterm = fakeRenderer(true, 'iTerm.app').renderer;
  const apple = fakeRenderer(true, 'Apple_Terminal').renderer;
  const kitty = fakeRenderer(true, 'kitty').renderer;

  for (const channel of ['auto', 'terminal'] as const) {
    expect(notificationCaveat(iterm, channel)).toContain('Notification Center Alerts');
    expect(notificationCaveat(kitty, channel)).toBeNull();
  }

  // the Apple Terminal caveat reads differently depending on whether auto already routes around it
  expect(notificationCaveat(apple, 'auto')).toContain('takes the platform command');
  expect(notificationCaveat(apple, 'terminal')).toContain('switch the channel');

  // the command and bell channels never send the sequence, so nothing stands in their way
  for (const channel of ['command', 'bell'] as const) {
    expect(notificationCaveat(iterm, channel)).toBeNull();
    expect(notificationCaveat(apple, channel)).toBeNull();
  }
});

test('macOS posts through the bundled helper and falls back to osascript without it', () => {
  withPlatform('darwin', () => {
    expect(notifyCommand('the title', 'the body', HELPER)).toEqual({
      command: HELPER,
      args: ['the title', 'the body'],
      name: 'pr-stats.app',
    });

    expect(notificationTool(HELPER)).toBe('pr-stats.app');

    const fallback = notifyCommand('the title', 'the body', null);

    expect(fallback?.command).toBe('osascript');
    expect(fallback?.name).toBe('osascript');

    // the strings travel as arguments behind the script, never inside it
    expect(fallback?.args.slice(-2)).toEqual(['the title', 'the body']);
    expect(notificationTool(null)).toBe('osascript');
  });

  withPlatform('linux', () => {
    // the helper is a macOS bundle, so Linux ignores it even when a path comes in
    expect(notifyCommand('the title', 'fix <Button> focus', HELPER)).toEqual({
      command: 'notify-send',
      args: ['--app-name=pr-stats', '--', 'the title', 'fix &lt;Button&gt; focus'],
      name: 'notify-send',
    });

    expect(notificationTool(HELPER)).toBe('notify-send');
  });
});

test('the helper exit codes turn into footer messages', () => {
  withPlatform('darwin', () => {
    const { calls, children, spawn } = fakeSpawn();
    const errors: string[] = [];
    const report = (message: string) => errors.push(message);

    sendNotification('the title', 'the body', report, spawn, HELPER);
    sendNotification('the title', 'the body', report, spawn, HELPER);
    sendNotification('the title', 'the body', report, spawn, HELPER);
    sendNotification('the title', 'the body', report, spawn, HELPER);

    expect(calls).toHaveLength(4);
    expect(calls[0]).toEqual({ command: HELPER, args: ['the title', 'the body'] });

    children[0]?.exit(0);
    children[1]?.exit(3);
    children[2]?.exit(1);
    children[3]?.fail('spawn ENOENT');

    expect(errors).toEqual([
      'notifications for pr-stats are turned off, allow them under System Settings › Notifications › pr-stats',
      'could not send the notification (pr-stats.app exited with 1)',
      'could not send the notification (spawn ENOENT)',
    ]);
  });
});

test('a helper stuck on the permission prompt blocks further sends until it exits', () => {
  withPlatform('darwin', () => {
    const { calls, children, spawn } = fakeSpawn();
    const errors: string[] = [];
    const report = (message: string) => errors.push(message);

    try {
      setSystemTime(new Date('2026-09-02T09:00:00Z'));
      sendNotification('the title', 'the body', report, spawn, HELPER);

      // a second send inside the grace period runs, because a healthy helper takes under a second
      setSystemTime(new Date('2026-09-02T09:00:02Z'));
      sendNotification('the title', 'the body', report, spawn, HELPER);

      expect(calls).toHaveLength(2);
      expect(errors).toEqual([]);

      // past the grace period the first helper can only be waiting on the prompt
      setSystemTime(new Date('2026-09-02T09:00:10Z'));
      sendNotification('the title', 'the body', report, spawn, HELPER);

      expect(calls).toHaveLength(2);
      expect(errors).toEqual(['the notification permission prompt for pr-stats is still waiting for an answer']);

      // the user answers, the helpers exit, and sends flow again
      children[0]?.exit(0);
      children[1]?.exit(0);
      sendNotification('the title', 'the body', report, spawn, HELPER);

      expect(calls).toHaveLength(3);
      expect(errors).toHaveLength(1);

      children[2]?.exit(0);
    } finally {
      setSystemTime();
    }
  });
});
