import { expect, test } from 'bun:test';
import { describeWait, formatWaitLeft } from './wait';

test('formats the time left in seconds below a minute and in minutes and seconds above', () => {
  expect(formatWaitLeft(0)).toBe('0s');
  expect(formatWaitLeft(-500)).toBe('0s');
  expect(formatWaitLeft(1)).toBe('1s');
  expect(formatWaitLeft(42_000)).toBe('42s');
  expect(formatWaitLeft(60_000)).toBe('1m 00s');
  expect(formatWaitLeft(125_400)).toBe('2m 06s');
});

test('describes a retry wait and a pace wait with the countdown', () => {
  const now = Date.parse('2026-09-08T10:00:00Z');
  const until = new Date(now + 90_000);

  expect(describeWait({ reason: 'retry', until }, now)).toBe('rate limited by GitHub · retrying in 1m 30s');
  expect(describeWait({ reason: 'pace', until }, now)).toBe('pacing search requests · resuming in 1m 30s');
});
