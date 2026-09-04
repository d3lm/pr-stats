import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureCache } from './cache';
import type { ReviewResult } from './data';
import {
  activeSnooze,
  dueSnoozes,
  formatWakeTime,
  nextWakeUp,
  parseSnoozeDuration,
  readSnoozes,
  snoozeDurationMs,
  splitSnoozed,
  wokenPrs,
  writeSnoozes,
  type Snooze,
} from './snooze';
import { CliError } from './utils';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pr-stats-snooze-'));
  process.env.PR_STATS_CACHE_DIR = dir;
  configureCache(true);
});

afterEach(() => {
  configureCache(false);
  delete process.env.PR_STATS_CACHE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function pr(repo: string, number: number, state = 'open') {
  return {
    repo,
    number,
    title: `pr ${number}`,
    url: `https://example.com/${repo}/${number}`,
    state,
    createdAt: new Date('2026-07-01T00:00:00Z'),
  };
}

function pendingResult(repo: string, number: number, requestedAt: string, state = 'open'): ReviewResult {
  return { kind: 'pending', pr: pr(repo, number, state), requestedAt: new Date(requestedAt) };
}

const NOW = Date.parse('2026-08-01T12:00:00Z');

function snooze(ref: string, until: string, requestedAt = '2026-07-20T09:00:00Z'): Snooze {
  return { ref, until: Date.parse(until), requestedAt: Date.parse(requestedAt) };
}

test('parses snooze durations in minutes, hours, days, and weeks up to four weeks', () => {
  expect(snoozeDurationMs('1m')).toBe(60_000);
  expect(snoozeDurationMs('30m')).toBe(1_800_000);
  expect(snoozeDurationMs('2h')).toBe(7_200_000);
  expect(snoozeDurationMs('1d')).toBe(86_400_000);
  expect(snoozeDurationMs('1w')).toBe(604_800_000);
  expect(snoozeDurationMs('4w')).toBe(2_419_200_000);
  expect(snoozeDurationMs('28d')).toBe(2_419_200_000);

  // anything outside 1m to 4w or not in the amount-unit form is refused
  for (const input of ['', '0m', '5w', '29d', '673h', '10', 'h', '30s', '1.5h', ' 1h', '1h ', '1H', '-1h']) {
    expect(snoozeDurationMs(input)).toBeNull();
  }

  expect(parseSnoozeDuration('2h')).toBe(7_200_000);

  expect(() => {
    parseSnoozeDuration('30s');
  }).toThrow(CliError);

  expect(() => {
    parseSnoozeDuration('30s');
  }).toThrow('invalid snooze duration "30s"');
});

test('formats a wake-up time as a clock time today and with the date on any other day', () => {
  const now = new Date(2026, 7, 1, 12, 0).getTime();
  const later = new Date(2026, 7, 1, 15, 30).getTime();
  const tomorrow = new Date(2026, 7, 2, 9, 0).getTime();

  const time = new Date(later).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  expect(formatWakeTime(later, now)).toBe(time);

  const date = new Date(tomorrow).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const tomorrowTime = new Date(tomorrow).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  expect(formatWakeTime(tomorrow, now)).toBe(`${date} ${tomorrowTime}`);
});

test('writes and reads the snoozes as a file keyed by PR ref, soonest wake-up first', () => {
  const snoozes = [
    snooze('acme/web#3', '2026-08-02T09:00:00Z', '2026-07-25T09:00:00Z'),
    snooze('acme/api#7', '2026-08-01T15:00:00Z'),
  ];

  expect(writeSnoozes(snoozes)).toBe(true);

  expect(JSON.parse(readFileSync(join(dir, 'snoozes.json'), 'utf8'))).toEqual({
    'acme/web#3': { until: '2026-08-02T09:00:00.000Z', requestedAt: '2026-07-25T09:00:00.000Z' },
    'acme/api#7': { until: '2026-08-01T15:00:00.000Z', requestedAt: '2026-07-20T09:00:00.000Z' },
  });

  expect(readSnoozes()).toEqual([snoozes[1], snoozes[0]]);

  // an empty list leaves an empty object behind, so a later read finds nothing
  expect(writeSnoozes([])).toBe(true);
  expect(readSnoozes()).toEqual([]);

  // a disabled cache reads nothing and stores nothing, the way debug runs stay isolated
  configureCache(false);

  expect(writeSnoozes(snoozes)).toBe(false);
  expect(readSnoozes()).toEqual([]);
  expect(JSON.parse(readFileSync(join(dir, 'snoozes.json'), 'utf8'))).toEqual({});
});

test('reads nothing from a missing or damaged file and drops damaged entries', () => {
  expect(readSnoozes()).toEqual([]);

  writeFileSync(join(dir, 'snoozes.json'), 'not json');

  expect(readSnoozes()).toEqual([]);

  writeFileSync(join(dir, 'snoozes.json'), '[]');

  expect(readSnoozes()).toEqual([]);

  writeFileSync(
    join(dir, 'snoozes.json'),
    JSON.stringify({
      'acme/api#7': { until: '2026-08-01T15:00:00Z', requestedAt: '2026-07-20T09:00:00Z' },
      'acme/web#3': { until: 'soon', requestedAt: '2026-07-20T09:00:00Z' },
      'acme/web#4': { until: '2026-08-01T15:00:00Z' },
      'acme/web#5': 'tomorrow',
    }),
  );

  expect(readSnoozes()).toEqual([snooze('acme/api#7', '2026-08-01T15:00:00Z')]);
});

test('a snooze covers a request until it wakes up and only while the request is not newer', () => {
  const snoozes = [snooze('acme/api#7', '2026-08-01T15:00:00Z', '2026-07-20T09:00:00Z')];
  const requestedAt = new Date('2026-07-20T09:00:00Z');

  expect(activeSnooze(snoozes, 'acme/api#7', requestedAt, NOW)).toEqual(snoozes[0]);

  // the wake-up time itself counts as woken
  expect(activeSnooze(snoozes, 'acme/api#7', requestedAt, Date.parse('2026-08-01T15:00:00Z'))).toBeUndefined();

  // a re-request after the snooze voids it, an older request time still matches
  expect(activeSnooze(snoozes, 'acme/api#7', new Date('2026-07-30T09:00:00Z'), NOW)).toBeUndefined();
  expect(activeSnooze(snoozes, 'acme/api#7', new Date('2026-07-10T09:00:00Z'), NOW)).toEqual(snoozes[0]);

  expect(activeSnooze(snoozes, 'acme/api#8', requestedAt, NOW)).toBeUndefined();
});

test('splitSnoozed keeps the awaiting order and sorts the snoozed entries by wake-up time', () => {
  const entries = [
    { pr: pr('acme/api', 1), requestedAt: new Date('2026-07-10T09:00:00Z') },
    { pr: pr('acme/web', 2), requestedAt: new Date('2026-07-11T09:00:00Z') },
    { pr: pr('acme/api', 3), requestedAt: new Date('2026-07-12T09:00:00Z') },
    { pr: pr('acme/web', 4), requestedAt: new Date('2026-07-13T09:00:00Z') },
  ];

  const snoozes = [
    snooze('acme/api#1', '2026-08-03T09:00:00Z', '2026-07-10T09:00:00Z'),
    snooze('acme/api#3', '2026-08-02T09:00:00Z', '2026-07-12T09:00:00Z'),
    // this snooze already woke up, so web#4 stays in the awaiting list
    snooze('acme/web#4', '2026-08-01T09:00:00Z', '2026-07-13T09:00:00Z'),
  ];

  const split = splitSnoozed(entries, snoozes, NOW);

  expect(split.awaiting.map((entry) => entry.pr.number)).toEqual([2, 4]);

  expect(split.snoozed.map((entry) => [entry.pr.number, entry.until])).toEqual([
    [3, Date.parse('2026-08-02T09:00:00Z')],
    [1, Date.parse('2026-08-03T09:00:00Z')],
  ]);

  expect(splitSnoozed(entries, [], NOW)).toEqual({ awaiting: entries, snoozed: [] });
});

test('nextWakeUp and dueSnoozes read the wake-up times', () => {
  const snoozes = [
    snooze('acme/api#1', '2026-08-03T09:00:00Z'),
    snooze('acme/api#2', '2026-08-01T09:00:00Z'),
    snooze('acme/api#3', '2026-08-01T12:00:00Z'),
  ];

  expect(nextWakeUp([])).toBeNull();
  expect(nextWakeUp(snoozes)).toBe(Date.parse('2026-08-01T09:00:00Z'));

  expect(dueSnoozes(snoozes, NOW).map((snooze) => snooze.ref)).toEqual(['acme/api#2', 'acme/api#3']);
  expect(dueSnoozes(snoozes, Date.parse('2026-08-01T00:00:00Z'))).toEqual([]);
});

test('wokenPrs lists the PRs that still await the snoozed request', () => {
  const due = [
    snooze('acme/api#1', '2026-08-01T09:00:00Z', '2026-07-10T09:00:00Z'),
    snooze('acme/api#2', '2026-08-01T09:00:00Z', '2026-07-10T09:00:00Z'),
    snooze('acme/api#3', '2026-08-01T09:00:00Z', '2026-07-10T09:00:00Z'),
    snooze('acme/api#4', '2026-08-01T09:00:00Z', '2026-07-10T09:00:00Z'),
  ];

  const results: ReviewResult[] = [
    // still pending on the same request, so it comes back
    pendingResult('acme/api', 1, '2026-07-10T09:00:00Z'),
    // closed with the request still open, so nothing comes back
    pendingResult('acme/api', 2, '2026-07-10T09:00:00Z', 'closed'),
    // re-requested while snoozed, which the queue already shows on its own
    pendingResult('acme/api', 3, '2026-07-20T09:00:00Z'),
    // api#4 got reviewed and left the pending results altogether
  ];

  expect(wokenPrs(due, results).map((woken) => woken.number)).toEqual([1]);
  expect(wokenPrs([], results)).toEqual([]);
});
