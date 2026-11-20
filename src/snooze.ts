import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir, cacheEnabled, prKey, writeFileAtomic } from './cache';
import type { ReviewPr, ReviewResult } from './data';
import { CliError } from './utils';

export type SnoozeKind = 'review' | 'mention';

export interface Snooze {
  kind: SnoozeKind;
  ref: string;
  until: number;
  at: number;
  ids?: readonly string[];
}

export interface SnoozeTargetKey {
  kind: SnoozeKind;
  ref: string;
}

export function snoozeMatches(snooze: Snooze, target: SnoozeTargetKey): boolean {
  return snooze.kind === target.kind && snooze.ref === target.ref;
}

export const DEFAULT_SNOOZE_DURATION = '30m';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const MAX_SNOOZE_MS = 4 * WEEK_MS;

const UNIT_MS: Record<string, number> = { m: MINUTE_MS, h: HOUR_MS, d: DAY_MS, w: WEEK_MS };

export function snoozeDurationMs(input: string): number | null {
  const match = /^(\d+)([mhdw])$/.exec(input);

  if (match === null) {
    return null;
  }

  const ms = Number(match[1]) * UNIT_MS[match[2]];

  return ms >= MINUTE_MS && ms <= MAX_SNOOZE_MS ? ms : null;
}

export function parseSnoozeDuration(input: string): number {
  const ms = snoozeDurationMs(input);

  if (ms === null) {
    throw new CliError(`invalid snooze duration "${input}", use a value from 1m to 4w like 30m, 2h, or 1d`);
  }

  return ms;
}

export function formatWakeTime(until: number, now = Date.now()): string {
  const wake = new Date(until);
  const today = new Date(now);
  const time = wake.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const sameDay =
    wake.getFullYear() === today.getFullYear() &&
    wake.getMonth() === today.getMonth() &&
    wake.getDate() === today.getDate();

  return sameDay ? time : `${wake.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

export function snoozesFile(): string {
  return join(cacheDir(), 'snoozes.json');
}

interface StoredSnooze {
  until: string;
  at?: string;
  /**
   * Holds the ask time in files written before mention snoozes existed.
   */
  requestedAt?: string;
  ids?: string[];
}

/**
 * A key without a kind prefix is a review snooze written before mention snoozes existed.
 */
function parseStoredKey(key: string): SnoozeTargetKey {
  for (const kind of ['review', 'mention'] as const) {
    if (key.startsWith(`${kind}:`)) {
      return { kind, ref: key.slice(kind.length + 1) };
    }
  }

  return { kind: 'review', ref: key };
}

function reviveSnooze(key: string, stored: unknown): Snooze | null {
  if (typeof stored !== 'object' || stored === null) {
    return null;
  }

  const { until, at, requestedAt, ids } = stored as { [K in keyof StoredSnooze]?: unknown };
  const askedAt = at ?? requestedAt;

  if (typeof until !== 'string' || typeof askedAt !== 'string') {
    return null;
  }

  const untilMs = Date.parse(until);
  const atMs = Date.parse(askedAt);

  if (Number.isNaN(untilMs) || Number.isNaN(atMs)) {
    return null;
  }

  const snooze: Snooze = { ...parseStoredKey(key), until: untilMs, at: atMs };

  if (Array.isArray(ids)) {
    snooze.ids = ids.filter((id): id is string => typeof id === 'string');
  }

  return snooze;
}

/**
 * Keeps expired snoozes because the TUI still has to wake them up.
 */
export function readSnoozes(): Snooze[] {
  if (!cacheEnabled()) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(snoozesFile(), 'utf8'));
  } catch {
    return [];
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return [];
  }

  const snoozes: Snooze[] = [];

  for (const [key, stored] of Object.entries(parsed)) {
    const snooze = reviveSnooze(key, stored);

    if (snooze !== null) {
      snoozes.push(snooze);
    }
  }

  return snoozes.toSorted((a, b) => a.until - b.until);
}

export function writeSnoozes(snoozes: Snooze[]): boolean {
  if (!cacheEnabled()) {
    return false;
  }

  const stored: Record<string, StoredSnooze> = {};

  for (const snooze of snoozes) {
    stored[`${snooze.kind}:${snooze.ref}`] = {
      until: new Date(snooze.until).toISOString(),
      at: new Date(snooze.at).toISOString(),
      ...(snooze.ids === undefined ? {} : { ids: [...snooze.ids] }),
    };
  }

  writeFileAtomic(snoozesFile(), `${JSON.stringify(stored, null, 2)}\n`);

  return true;
}

function findSnooze(
  snoozes: readonly Snooze[],
  target: SnoozeTargetKey,
  now: number,
  covers: (snooze: Snooze) => boolean,
): Snooze | undefined {
  return snoozes.find((snooze) => snoozeMatches(snooze, target) && snooze.until > now && covers(snooze));
}

export function activeSnooze(
  snoozes: readonly Snooze[],
  target: SnoozeTargetKey,
  askedAt: number,
  now: number,
): Snooze | undefined {
  return findSnooze(snoozes, target, now, (snooze) => askedAt <= snooze.at);
}

export function partitionSnoozed<T extends { pr: { repo: string; number: number } }>(
  kind: SnoozeKind,
  entries: T[],
  snoozes: readonly Snooze[],
  now: number,
  covers: (snooze: Snooze, entry: T) => boolean,
): { awaiting: T[]; snoozed: (T & { until: number })[] } {
  const awaiting: T[] = [];
  const snoozed: (T & { until: number })[] = [];

  for (const entry of entries) {
    const target = { kind, ref: prKey(entry.pr.repo, entry.pr.number) };
    const snooze = findSnooze(snoozes, target, now, (candidate) => covers(candidate, entry));

    if (snooze === undefined) {
      awaiting.push(entry);
    } else {
      snoozed.push({ ...entry, until: snooze.until });
    }
  }

  snoozed.sort((a, b) => a.until - b.until);

  return { awaiting, snoozed };
}

export function splitSnoozed<T extends { pr: ReviewPr; requestedAt: Date }>(
  entries: T[],
  snoozes: readonly Snooze[],
  now: number,
): { awaiting: T[]; snoozed: (T & { until: number })[] } {
  return partitionSnoozed('review', entries, snoozes, now, (snooze, entry) => entry.requestedAt.getTime() <= snooze.at);
}

export function nextWakeUp(snoozes: readonly Snooze[]): number | null {
  if (snoozes.length === 0) {
    return null;
  }

  return Math.min(...snoozes.map((snooze) => snooze.until));
}

export function dueSnoozes(snoozes: readonly Snooze[], now: number): Snooze[] {
  return snoozes.filter((snooze) => snooze.until <= now);
}

export function wokenPrs(due: readonly Snooze[], results: readonly ReviewResult[]): ReviewPr[] {
  const pending = new Map<string, { pr: ReviewPr; requestedAt: number }>();

  for (const result of results) {
    if ((result.kind === 'pending' || result.kind === 'team-pending') && result.pr.state === 'open') {
      pending.set(prKey(result.pr.repo, result.pr.number), {
        pr: result.pr,
        requestedAt: result.requestedAt.getTime(),
      });
    }
  }

  return due.flatMap((snooze) => {
    if (snooze.kind !== 'review') {
      return [];
    }

    const entry = pending.get(snooze.ref);

    return entry !== undefined && entry.requestedAt <= snooze.at ? [entry.pr] : [];
  });
}
