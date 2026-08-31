export interface WorkWindow {
  startMin: number;
  endMin: number;
}

export interface TimeMode {
  business: boolean;
  workWindows: WorkWindow[];
  /**
   * Holds the weekday numbers that count as working days, matching what
   * Date#getUTCDay returns. Every other day counts as weekend.
   */
  workDays: Set<number>;
  dayHours: number;
  formatter: Intl.DateTimeFormat;
}

/**
 * Builds the formatter that wallParts() uses to read wall-clock parts of an
 * instant in the given timezone.
 */
function wallFormatter(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Holds how durations are measured. configureTimeMode() fills this in from
 * the flags before any duration is computed. The defaults measure wall-clock
 * weekday hours in UTC.
 */
export const timeMode: TimeMode = {
  business: true,
  workWindows: [{ startMin: 0, endMin: 24 * 60 }],
  workDays: new Set([1, 2, 3, 4, 5]),
  dayHours: 24,
  formatter: wallFormatter('UTC'),
};

/**
 * Applies the flag values to the time mode. Working hours only matter in
 * business mode, so wall-clock mode keeps the 24-hour day.
 */
export function configureTimeMode({
  business,
  workWindows,
  workDays,
  tz,
}: {
  business: boolean;
  workWindows: WorkWindow[];
  workDays: Set<number>;
  tz: string;
}): void {
  const workMinutesPerDay = workWindows.reduce((sum, window) => sum + (window.endMin - window.startMin), 0);

  timeMode.business = business;
  timeMode.workWindows = workWindows;
  timeMode.workDays = workDays;
  timeMode.dayHours = business ? workMinutesPerDay / 60 : 24;

  timeMode.formatter = wallFormatter(tz);
}

/**
 * Reports whether every hour of a working day counts, which is the
 * default. When the user sets --work-hours, only the given windows count.
 */
export function isFullDayMode(): boolean {
  return timeMode.business && timeMode.dayHours === 24;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Returns the wall-clock date and time parts of an instant in the
 * configured timezone.
 */
function wallParts(instantMs: number): WallParts {
  const parts = Object.fromEntries(timeMode.formatter.formatToParts(instantMs).map((part) => [part.type, part.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * Returns the local calendar day of an instant in the configured timezone,
 * encoded as a UTC timestamp, together with the local weekday, hour, and
 * minute. The encoded day's UTC weekday matches the local weekday, so day
 * and week arithmetic on it stays exact across DST changes.
 */
export function zonedStamp(date: Date): { dayUtcMs: number; weekday: number; hour: number; minute: number } {
  const parts = wallParts(date.getTime());

  const dayUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day);

  return { dayUtcMs, weekday: new Date(dayUtcMs).getUTCDay(), hour: parts.hour, minute: parts.minute };
}

/**
 * Reports whether the configured working windows leave gaps in the day,
 * which is the case once the user sets --work-hours. Only then can an
 * instant classify as after hours.
 */
export function hasWorkWindows(): boolean {
  const covered = timeMode.workWindows.reduce((sum, window) => sum + (window.endMin - window.startMin), 0);

  return covered < 24 * 60;
}

/**
 * Classifies an instant by the configured working calendar into the
 * weekend, inside the working windows, or after hours. Days outside the
 * configured working days count as weekend. With full-day windows every
 * working-day instant counts as work time, so after hours can only
 * appear once the user sets --work-hours.
 */
export function classifyInstant(date: Date): 'work' | 'after' | 'weekend' {
  const { weekday, hour, minute } = zonedStamp(date);

  if (!timeMode.workDays.has(weekday)) {
    return 'weekend';
  }

  const minuteOfDay = hour * 60 + minute;

  return timeMode.workWindows.some((window) => minuteOfDay >= window.startMin && minuteOfDay < window.endMin)
    ? 'work'
    : 'after';
}

/**
 * Finds the UTC instant whose wall-clock time in the configured timezone
 * equals the given target. The target encodes a wall-clock time as a Date.UTC
 * value. Two refinement rounds are enough to converge, including across DST
 * changes.
 */
function utcFromWall(wallTargetMs: number): number {
  let guess = wallTargetMs;

  for (let i = 0; i < 2; i++) {
    const parts = wallParts(guess);

    const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

    guess = wallTargetMs - (wall - guess);
  }

  return guess;
}

/**
 * Sums the milliseconds between two instants that fall inside working hours
 * on working days in the configured timezone. Walks the interval one local
 * calendar day at a time and adds the overlap with each of that day's
 * working windows.
 */
function businessMsBetween(start: Date, end: Date): number {
  const startMs = start.getTime();
  const endMs = end.getTime();

  if (endMs <= startMs) {
    return 0;
  }

  let total = 0;

  const parts = wallParts(startMs);

  let localDay = Date.UTC(parts.year, parts.month - 1, parts.day);

  while (utcFromWall(localDay) <= endMs) {
    /**
     * LocalDay encodes the local calendar date as a UTC timestamp,
     * so its UTC weekday matches the local weekday.
     */
    const weekday = new Date(localDay).getUTCDay();

    if (timeMode.workDays.has(weekday)) {
      for (const window of timeMode.workWindows) {
        const windowStart = utcFromWall(localDay + window.startMin * 60_000);
        const windowEnd = utcFromWall(localDay + window.endMin * 60_000);
        const overlapStart = Math.max(windowStart, startMs);
        const overlapEnd = Math.min(windowEnd, endMs);

        if (overlapEnd > overlapStart) {
          total += overlapEnd - overlapStart;
        }
      }
    }

    localDay += 86_400_000;
  }

  return total;
}

export function durationHours(start: Date, end: Date): number {
  if (!timeMode.business) {
    return (end.getTime() - start.getTime()) / 36e5;
  }

  return businessMsBetween(start, end) / 36e5;
}
