import { expect, test } from 'bun:test';
import { classifyInstant, configureTimeMode, durationHours } from './time';

/**
 * Configures the Sun-Thu working week with a 9-17 working day in UTC,
 * which makes Friday and Saturday the weekend.
 */
function configureSunThu(): void {
  configureTimeMode({
    business: true,
    workWindows: [{ startMin: 9 * 60, endMin: 17 * 60 }],
    workDays: new Set([0, 1, 2, 3, 4]),
    tz: 'UTC',
  });
}

/**
 * Puts the shared time mode back to the defaults, so the working
 * calendar these tests configure never leaks into tests that run later.
 */
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

    // 2026-07-05 is a Sunday and 2026-07-03 is a Friday
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

    // the span from Thursday 2026-07-02 09:00 to Sunday 2026-07-05 17:00 skips Friday and Saturday
    expect(durationHours(new Date('2026-07-02T09:00:00Z'), new Date('2026-07-05T17:00:00Z'))).toBe(16);
  } finally {
    restoreTimeMode();
  }
});
