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

export function percentile(sorted: number[], percent: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);

  return sorted[Math.max(0, index)];
}
