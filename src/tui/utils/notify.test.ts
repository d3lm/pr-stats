import { expect, test } from 'bun:test';
import { createNotifier, notificationChannel, notificationTool, type RendererNotificationBoundary } from './notify';

/**
 * Builds a renderer stub whose trigger records every call and answers
 * with the given acceptance, standing in for a terminal with or without
 * a notification protocol. The command paths stay untested here because
 * they spawn a real process, and the channel routing around them is
 * what this file covers.
 */
function fakeRenderer(accepts: boolean): {
  renderer: RendererNotificationBoundary;
  calls: { message: string; title?: string }[];
} {
  const calls: { message: string; title?: string }[] = [];

  return {
    calls,
    renderer: {
      capabilities: { notifications: accepts },
      triggerNotification(message: string, title?: string) {
        calls.push({ message, title });
        return accepts;
      },
    },
  };
}

test('the auto and terminal channels post through an accepting terminal without errors', () => {
  for (const channel of ['auto', 'terminal'] as const) {
    const { renderer, calls } = fakeRenderer(true);
    const errors: string[] = [];

    createNotifier(renderer, channel)('the title', 'the body', (message) => errors.push(message));

    expect(calls).toEqual([{ message: 'the body', title: 'the title' }]);
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

test('names the channel a send would take for each setting', () => {
  const accepting = fakeRenderer(true).renderer;
  const refusing = fakeRenderer(false).renderer;

  expect(notificationChannel(accepting, 'auto')).toBe('terminal');
  expect(notificationChannel(refusing, 'auto')).toBe(notificationTool());

  // the forced channels ignore what the terminal reports
  expect(notificationChannel(refusing, 'terminal')).toBe('terminal');
  expect(notificationChannel(accepting, 'command')).toBe(notificationTool());
});
