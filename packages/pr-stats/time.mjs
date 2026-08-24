/**
 * Holds how durations are measured. configureTimeMode() fills this in from
 * the flags before any duration is computed.
 */
export const timeMode = {
  business: true,
  workWindows: [{ startMin: 0, endMin: 24 * 60 }],
  dayHours: 24,
  formatter: undefined,
};

/**
 * Applies the flag values to the time mode. Working hours only matter in
 * business mode, so wall-clock mode keeps the 24-hour day.
 */
export function configureTimeMode({ business, workWindows, tz }) {
  const workMinutesPerDay = workWindows.reduce((sum, window) => sum + (window.endMin - window.startMin), 0);

  timeMode.business = business;
  timeMode.workWindows = workWindows;
  timeMode.dayHours = business ? workMinutesPerDay / 60 : 24;

  timeMode.formatter = new Intl.DateTimeFormat('en-US', {
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
 * Reports whether every hour of a weekday counts, which is the default.
 * When the user sets --work-hours, only the given windows count.
 */
export function isFullDayMode() {
  return timeMode.business && timeMode.dayHours === 24;
}

/**
 * Returns the wall-clock date and time parts of an instant in the
 * configured timezone.
 */
function wallParts(instantMs) {
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
 * Finds the UTC instant whose wall-clock time in the configured timezone
 * equals the given target. The target encodes a wall-clock time as a Date.UTC
 * value. Two refinement rounds are enough to converge, including across DST
 * changes.
 */
function utcFromWall(wallTargetMs) {
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
 * on weekdays in the configured timezone. Walks the interval one local
 * calendar day at a time and adds the overlap with each of that day's
 * working windows.
 */
function businessMsBetween(start, end) {
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

    if (weekday !== 0 && weekday !== 6) {
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

export function durationHours(start, end) {
  if (!timeMode.business) {
    return (end - start) / 36e5;
  }

  return businessMsBetween(start, end) / 36e5;
}
