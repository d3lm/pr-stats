/**
 * Marks a failure with a message meant for the user, for example a bad flag
 * value or a failed gh call. The bootstrap catches it and exits before the
 * screen flips, and the running TUI catches it and shows the message
 * without tearing down the screen.
 */
export class CliError extends Error {}

/**
 * Prints an error and aborts the process. Only the TUI bootstrap calls
 * this, after catching a CliError from the layers below.
 */
export function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/**
 * Creates a gate that runs async tasks with at most maxConcurrent of them
 * in flight. A finishing task hands its slot to the oldest waiter, so the
 * number of running tasks never overshoots the bound.
 */
export function createLimiter(maxConcurrent: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;

  const waiting: (() => void)[] = [];

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < maxConcurrent) {
      active += 1;
    } else {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }

    try {
      return await task();
    } finally {
      const next = waiting.shift();

      if (next === undefined) {
        active -= 1;
      } else {
        next();
      }
    }
  };
}

/**
 * Resolves after the given number of milliseconds, and right away for a
 * zero or negative delay.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

export function formatMinutesOfDay(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Formats a byte count for display with a binary unit, like 512 B, 3.4 KiB,
 * or 12 MiB. Values below ten of a unit keep one decimal, and larger ones
 * round to a whole number, so the text stays short at every scale. A
 * value that would round up to 1024 moves to the next unit instead.
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

  let value = bytes;
  let unit = 0;

  while (value >= 1023.5 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  if (unit === 0) {
    return `${value} ${units[unit]}`;
  }

  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function percentile(sorted: number[], percent: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);

  return sorted[Math.max(0, index)];
}
