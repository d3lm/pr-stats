import type { RawData } from '../data/load';
import type { OptionsState } from '../state/options';
import { theme } from '../theme';
import { Spinner } from './Spinner';

/**
 * Renders the header row, the app name with the data context on the left
 * and the load spinner or the textual status on the right.
 */
export function Header({
  options,
  raw,
  error,
  spinning,
}: {
  options: OptionsState;
  raw: RawData | null;
  error: string | null;
  spinning: boolean;
}) {
  const context = [
    raw ? `@${raw.user}` : options.user !== '' ? `@${options.user}` : '@...',
    `since ${options.since}`,
    raw && raw.repos.length > 0 ? raw.repos.join(', ') : options.repos !== '' ? options.repos : 'all repos',
    timeModeLabel(options),
  ].join(' · ');

  /**
   * Covers the status slot whenever the spinner does not, which is the
   * idle state plus the deferred window at the start of a reload, where
   * the previous status keeps showing until the spinner earns its slot.
   * A failed reload keeps the old data on screen, where the full error
   * placeholder never renders, so the status slot flags the failure
   * instead of showing a stale refresh time. The startup snapshot never
   * reaches the refreshed branch, because the spinner covers it until
   * fresh data or an error takes over.
   */
  const rightStatus = raw
    ? error !== null
      ? 'reload failed · press r to retry'
      : `refreshed ${raw.fetchedAt.toLocaleTimeString()}`
    : '';

  return (
    <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1} justifyContent="space-between">
      <text wrapMode="none">
        <b fg={theme.accent}>pr-stats</b>
        <span fg={theme.muted}> · {context}</span>
      </text>
      {spinning ? (
        <Spinner />
      ) : (
        <text wrapMode="none" fg={raw !== null && error !== null ? theme.error : theme.muted}>
          {rightStatus}
        </text>
      )}
    </box>
  );
}

function timeModeLabel(options: OptionsState): string {
  if (options.wallClock) {
    return 'wall-clock time';
  }

  const tz = options.tz === '' ? Intl.DateTimeFormat().resolvedOptions().timeZone : options.tz;

  return options.workHours === '0-24' ? `Mon-Fri all hours ${tz}` : `Mon-Fri ${options.workHours} ${tz}`;
}
