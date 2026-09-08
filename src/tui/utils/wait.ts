import type { RateLimitWait } from '../data/load';

/**
 * Formats the time left in a wait as seconds, or as minutes and seconds
 * from a minute upwards, and never below zero, because a countdown can
 * render a tick after the wait ended and before the load moved on.
 */
export function formatWaitLeft(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * Describes a rate-limit wait in one line with the time left. A retry
 * wait follows a request GitHub refused, and a pace wait holds the search
 * requests under GitHub's per-minute search limit before any refusal.
 */
export function describeWait(wait: RateLimitWait, now = Date.now()): string {
  const left = formatWaitLeft(wait.until.getTime() - now);

  return wait.reason === 'retry'
    ? `rate limited by GitHub · retrying in ${left}`
    : `pacing search requests · resuming in ${left}`;
}
