import type { RateLimitWait } from '../data/load';

export function formatWaitLeft(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function describeWait(wait: RateLimitWait, now = Date.now()): string {
  const left = formatWaitLeft(wait.until.getTime() - now);

  return wait.reason === 'retry'
    ? `rate limited by GitHub · retrying in ${left}`
    : `pacing search requests · resuming in ${left}`;
}
