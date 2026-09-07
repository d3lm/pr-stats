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
