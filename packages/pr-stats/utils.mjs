/**
 * Prints an error and aborts the process. Exiting here is intentional
 * because every caller treats a bad flag or a failed gh call as fatal.
 */
export function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

export function formatMinutesOfDay(minutes) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

export function percentile(sorted, percent) {
  const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);

  return sorted[Math.max(0, index)];
}

/**
 * Wraps text in an OSC 8 escape sequence so terminals render it as a
 * clickable hyperlink. Falls back to plain text when the output is not a
 * terminal, for example when piped to a file.
 */
export function link(text, url) {
  if (!process.stdout.isTTY) {
    return text;
  }

  return `\u001B]8;;${url}\u001B\\${text}\u001B]8;;\u001B\\`;
}
