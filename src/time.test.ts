import { expect, test } from 'bun:test';
import { classifyInstant, configureTimeMode, durationHours } from './time';

function configureSunThu(): void {
  configureTimeMode({
    business: true,
    workWindows: [{ startMin: 9 * 60, endMin: 17 * 60 }],
    workDays: new Set([0, 1, 2, 3, 4]),
    tz: 'UTC',
  });
}

function restoreTimeMode(): void {
  configureTimeMode({
    business: true,
    workWindows: [{ startMin: 0, endMin: 24 * 60 }],
    workDays: new Set([1, 2, 3, 4, 5]),
    tz: 'UTC',
  });
}

test('classifies days outside the configured working days as weekend', () => {
  try {
    configureSunThu();

    expect(classifyInstant(new Date('2026-07-05T10:00:00Z'))).toBe('work');
    expect(classifyInstant(new Date('2026-07-05T20:00:00Z'))).toBe('after');
    expect(classifyInstant(new Date('2026-07-03T10:00:00Z'))).toBe('weekend');
    expect(classifyInstant(new Date('2026-07-04T10:00:00Z'))).toBe('weekend');
  } finally {
    restoreTimeMode();
  }
});

test('sums working time only over the configured working days', () => {
  try {
    configureSunThu();

    expect(durationHours(new Date('2026-07-02T09:00:00Z'), new Date('2026-07-05T17:00:00Z'))).toBe(16);
  } finally {
    restoreTimeMode();
  }
});
