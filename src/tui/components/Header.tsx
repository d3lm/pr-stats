import { parseWorkHours } from '../../flags';
import type { RateLimitWait, RawData } from '../data/load';
import type { OptionsState } from '../state/options';
import { theme } from '../theme';
import { RateLimitWaitStatus } from './RateLimitWait';
import { Spinner } from './Spinner';

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
  rateLimited: boolean;
  spinning: boolean;
  wait: RateLimitWait | null;
  reloadEvery: string | null;
}) {
  const context = [
    raw ? `@${raw.user}` : options.user !== '' ? `@${options.user}` : '@...',
    `since ${options.since}`,
    raw && raw.repos.length > 0 ? raw.repos.join(', ') : options.repos !== '' ? options.repos : 'all repos',
    timeModeLabel(options),
  ].join(' · ');

  const rightStatus = raw
    ? error !== null
      ? rateLimited
        ? 'GitHub rate limit hit · wait a few minutes, then press r'
        : 'reload failed · press r to retry'
      : `refreshed ${raw.fetchedAt.toLocaleTimeString()}${reloadEvery === null ? '' : ` · every ${reloadEvery}`}`
    : '';

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

function dailyHoursLabel(workHours: string): string {
  const minutes = parseWorkHours(workHours).reduce((sum, window) => sum + (window.endMin - window.startMin), 0);
  const hours = Math.round((minutes / 60) * 100) / 100;

  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}
