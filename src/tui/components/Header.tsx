import { parseWorkHours } from '../../flags';
import type { RateLimitWait, RawData } from '../data/load';
import type { OptionsState } from '../state/options';
import { theme } from '../theme';
import { RateLimitWaitStatus } from './RateLimitWait';
import { Spinner } from './Spinner';

/**
 * Renders the header row, the app name with the data context on the left
 * and the load spinner or the textual status on the right. A load that
 * waits out a GitHub rate limit shows the countdown in place of the
 * spinner, so a reload behind data on screen tells why it takes long.
 */
export function Header({
  options,
  raw,
  error,
  rateLimited,
  spinning,
  wait,
  reloadEvery,
}: {
  options: OptionsState;
  raw: RawData | null;
  error: string | null;
  /**
   * Marks the error as a rate limit GitHub kept enforcing through the
   * retries, so the status slot asks for patience instead of an
   * immediate retry.
   */
  rateLimited: boolean;
  spinning: boolean;
  /**
   * Holds the rate-limit pause the running load sits in, or null while
   * its requests flow.
   */
  wait: RateLimitWait | null;
  /**
   * Holds the auto-reload interval while the setting is on, which the
   * status slot shows next to the refresh time so a running TUI tells
   * that it keeps refreshing on its own, or null while it is off.
   */
  reloadEvery: string | null;
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
   * instead of showing a stale refresh time. A reload that GitHub's rate
   * limit defeated keeps the data too and says so, because pressing r
   * right away would only run into the same limit. The startup snapshot
   * never reaches the refreshed branch, because the spinner covers it
   * until fresh data or an error takes over.
   */
  const rightStatus = raw
    ? error !== null
      ? rateLimited
        ? 'GitHub rate limit hit · wait a few minutes, then press r'
        : 'reload failed · press r to retry'
      : `refreshed ${raw.fetchedAt.toLocaleTimeString()}${reloadEvery === null ? '' : ` · every ${reloadEvery}`}`
    : '';

  /**
   * The context gives way before the status slot does, so on a terminal
   * too narrow for both the context gets cut and the slot keeps its full
   * width, because during a reload behind data on screen the countdown
   * in the slot is the only sign that the load waits out a limit, and a
   * countdown without its remaining time says nothing.
   */
  return (
    <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1} justifyContent="space-between">
      <text wrapMode="none" flexShrink={1}>
        <b fg={theme.accent}>pr-stats</b>
        <span fg={theme.muted}> · {context}</span>
      </text>
      <box flexShrink={0}>
        {spinning ? (
          wait === null ? (
            <Spinner />
          ) : (
            <RateLimitWaitStatus wait={wait} />
          )
        ) : (
          <text wrapMode="none" fg={raw !== null && error !== null ? theme.error : theme.muted}>
            {rightStatus}
          </text>
        )}
      </box>
    </box>
  );
}

function timeModeLabel(options: OptionsState): string {
  if (options.wallClock) {
    return 'wall-clock time';
  }

  const tz = options.tz === '' ? Intl.DateTimeFormat().resolvedOptions().timeZone : options.tz;

  if (options.workHours === '0-24') {
    return `${options.workDays} all hours ${tz}`;
  }

  return `${options.workDays} ${options.workHours} (${dailyHoursLabel(options.workHours)}) ${tz}`;
}

/**
 * Sums an already validated work-hours value into the counted hours per
 * working day, like "8 hours" or "7.5 hours".
 */
function dailyHoursLabel(workHours: string): string {
  const minutes = parseWorkHours(workHours).reduce((sum, window) => sum + (window.endMin - window.startMin), 0);
  const hours = Math.round((minutes / 60) * 100) / 100;

  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}
