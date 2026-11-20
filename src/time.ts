export interface WorkWindow {
  startMin: number;
  endMin: number;
}

export interface TimeMode {
  business: boolean;
  workWindows: WorkWindow[];
  /**
   * Holds the working weekdays as Date#getUTCDay numbers.
   */
  workDays: Set<number>;
  dayHours: number;
  formatter: Intl.DateTimeFormat;
}

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

export const timeMode: TimeMode = {
  business: true,
  workWindows: [{ startMin: 0, endMin: 24 * 60 }],
  workDays: new Set([1, 2, 3, 4, 5]),
  dayHours: 24,
  formatter: wallFormatter('UTC'),
};

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
 * Encodes the local day as a UTC midnight so day and week arithmetic stays exact across DST changes.
 */
export function zonedStamp(date: Date): { dayUtcMs: number; weekday: number; hour: number; minute: number } {
  const parts = wallParts(date.getTime());

  const dayUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day);

  return { dayUtcMs, weekday: new Date(dayUtcMs).getUTCDay(), hour: parts.hour, minute: parts.minute };
}

export function hasWorkWindows(): boolean {
  const covered = timeMode.workWindows.reduce((sum, window) => sum + (window.endMin - window.startMin), 0);

  return covered < 24 * 60;
}

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
 * Two refinement rounds converge on the instant for a Date.UTC-encoded wall time,
 * even across DST changes.
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
