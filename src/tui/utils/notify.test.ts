import { expect, test } from 'bun:test';
import {
  createNotifier,
  notificationCaveat,
  notificationChannel,
  notificationTool,
  type RendererNotificationBoundary,
} from './notify';

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
   * The fallback would spawn osascript on this machine, so the test poses
   * as a platform without a command for the duration of the send. The
   * unsupported-platform report then proves the send took the command
   * path without the terminal ever being asked.
   */
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');

  Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });

  try {
    createNotifier(skipped.renderer, 'auto')('the title', 'the body', (message) => errors.push(message));
  } finally {
    Object.defineProperty(process, 'platform', platform ?? { value: 'darwin', configurable: true });
  }

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
