import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir, cacheEnabled, prKey, writeFileAtomic } from './cache';
import type { ReviewPr, ReviewResult } from './data';
import { CliError } from './utils';

/**
 * Names what a snooze parks. A review snooze parks a pending review
 * request of the awaiting queue, and a mention snooze parks an unread
 * mention of the mention inbox. The two live side by side on the same
 * PR, because a review request and a mention are two separate asks.
 */
export type SnoozeKind = 'review' | 'mention';

/**
 * One snoozed ask. The kind names what the snooze parks, the ref names
 * the PR as repo#number, until holds the wake-up time in milliseconds
 * since the epoch, and at holds the time of the ask the snooze covers,
 * the pending review request for a review snooze and the newest mention
 * for a mention snooze. A mention snooze also holds the ids of the texts
 * that mentioned you when it was made, so an edit to one of them, which
 * moves its time, does not count as a new mention. A newer ask of the
 * same kind on the same PR voids the snooze instead of hiding the
 * re-request or the new mention.
 */
export interface Snooze {
  kind: SnoozeKind;
  ref: string;
  until: number;
  at: number;
  ids?: readonly string[];
}

/**
 * Names the ask a snooze covers, the kind and the PR ref together, which
 * is what tells two snoozes apart.
 */
export interface SnoozeTargetKey {
  kind: SnoozeKind;
  ref: string;
}

/**
 * Reports whether the snooze covers the given kind of ask on the given
 * PR.
 */
export function snoozeMatches(snooze: Snooze, target: SnoozeTargetKey): boolean {
  return snooze.kind === target.kind && snooze.ref === target.ref;
}

/**
 * Duration the snooze dialog starts with until the user picks a default
 * in the settings dialog.
 */
export const DEFAULT_SNOOZE_DURATION = '30m';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * Longest snooze the dialog accepts. Four weeks parks a PR for a month
 * while keeping the wake-up time within a range a review queue can still
 * mean something.
 */
const MAX_SNOOZE_MS = 4 * WEEK_MS;

const UNIT_MS: Record<string, number> = { m: MINUTE_MS, h: HOUR_MS, d: DAY_MS, w: WEEK_MS };

/**
 * Converts a snooze duration like 30m, 2h, 1d, or 1w into milliseconds,
 * or returns null for anything else, including durations shorter than a
 * minute or longer than four weeks.
 */
export function snoozeDurationMs(input: string): number | null {
  const match = /^(\d+)([mhdw])$/.exec(input);

  if (match === null) {
    return null;
  }

  const ms = Number(match[1]) * UNIT_MS[match[2]];

  return ms >= MINUTE_MS && ms <= MAX_SNOOZE_MS ? ms : null;
}

/**
 * Parses a snooze duration into milliseconds, throwing a CliError that
 * names the accepted forms for anything snoozeDurationMs refuses. The
 * snooze dialog and the settings dialog validate their edits with it.
 */
export function parseSnoozeDuration(input: string): number {
  const ms = snoozeDurationMs(input);

  if (ms === null) {
    throw new CliError(`invalid snooze duration "${input}", use a value from 1m to 4w like 30m, 2h, or 1d`);
  }

  return ms;
}

/**
 * Formats a wake-up time for the queue and the footer. A time on the
 * same calendar day as now shows as a clock time alone, and any other
 * day leads with the date, so a snooze into next week never reads like
 * one that ends this afternoon.
 */
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

/**
 * Resolves the path of the snooze file, which lives next to settings.json
 * in the cache directory and stays out of the files a cache clear deletes.
 */
export function snoozesFile(): string {
  return join(cacheDir(), 'snoozes.json');
}

/**
 * On-disk shape of one snooze, keyed by kind and PR ref in the file as
 * kind:ref, with the times as ISO strings so the file reads well when
 * opened by hand. Only mention snoozes carry the ids of the texts they
 * cover. Files written before mention snoozes existed key their entries
 * by the PR ref alone and call the ask time requestedAt, and the reader
 * still takes both forms as review snoozes.
 */
interface StoredSnooze {
  until: string;
  at?: string;
  requestedAt?: string;
  ids?: string[];
}

/**
 * Splits a stored key into the kind and the PR ref. A key without a
 * known kind prefix is a review snooze from before mention snoozes
 * existed, whose whole key is the ref.
 */
function parseStoredKey(key: string): SnoozeTargetKey {
  for (const kind of ['review', 'mention'] as const) {
    if (key.startsWith(`${kind}:`)) {
      return { kind, ref: key.slice(kind.length + 1) };
    }
  }

  return { kind: 'review', ref: key };
}

/**
 * Parses one stored snooze, or returns null when the entry does not hold
 * two valid timestamps, so a damaged entry drops out instead of breaking
 * the whole file.
 */
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
 * Reads the snoozes from the cache directory, soonest wake-up first.
 * Returns an empty list while the cache is disabled, so debug runs and
 * tests never read the real file, and for a missing or unreadable file,
 * because the file is not meant to be edited by hand and a fresh start
 * beats a failed one. Expired snoozes stay in the list, because the TUI
 * still has to wake them up and report the PRs that came back.
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

/**
 * Writes the snoozes to the cache directory, replacing the previous
 * file. Returns false without writing while the cache is disabled, which
 * keeps debug runs from writing snoozes.
 */
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

/**
 * Finds the snooze on the given kind of ask on the given PR whose
 * wake-up time lies ahead at the given time and that the covers
 * predicate accepts, or returns undefined when none does.
 */
function findSnooze(
  snoozes: readonly Snooze[],
  target: SnoozeTargetKey,
  now: number,
  covers: (snooze: Snooze) => boolean,
): Snooze | undefined {
  return snoozes.find((snooze) => snoozeMatches(snooze, target) && snooze.until > now && covers(snooze));
}

/**
 * Finds the snooze that covers an ask of the given kind on the given PR
 * at the given time, or returns undefined when none does. A snooze
 * covers the ask while its wake-up time lies ahead and the ask is not
 * newer than the one the snooze recorded, so a review re-requested after
 * a snooze shows up in the queue right away.
 */
export function activeSnooze(
  snoozes: readonly Snooze[],
  target: SnoozeTargetKey,
  askedAt: number,
  now: number,
): Snooze | undefined {
  return findSnooze(snoozes, target, now, (snooze) => askedAt <= snooze.at);
}

/**
 * Splits entries of one kind of ask into the ones still awaiting
 * attention and the ones a snooze covers at the given time, keeping the
 * order of the awaiting entries and sorting the snoozed ones soonest
 * wake-up first, each carrying its wake-up time. The covers predicate
 * decides whether a snooze on the entry's PR still covers the entry's
 * ask, which it does not once a newer ask arrived.
 */
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

/**
 * Splits pending review entries into the ones still awaiting your review
 * and the ones a review snooze covers at the given time, the way
 * partitionSnoozed does for any kind of ask.
 */
export function splitSnoozed<T extends { pr: ReviewPr; requestedAt: Date }>(
  entries: T[],
  snoozes: readonly Snooze[],
  now: number,
): { awaiting: T[]; snoozed: (T & { until: number })[] } {
  return partitionSnoozed('review', entries, snoozes, now, (snooze, entry) => entry.requestedAt.getTime() <= snooze.at);
}

/**
 * Returns the wake-up time of the snooze that ends next, or null when
 * nothing is snoozed. The wake-up timer arms itself on it.
 */
export function nextWakeUp(snoozes: readonly Snooze[]): number | null {
  if (snoozes.length === 0) {
    return null;
  }

  return Math.min(...snoozes.map((snooze) => snooze.until));
}

/**
 * Lists the snoozes whose wake-up time has passed at the given time.
 */
export function dueSnoozes(snoozes: readonly Snooze[], now: number): Snooze[] {
  return snoozes.filter((snooze) => snooze.until <= now);
}

/**
 * Lists the PRs behind the given review snoozes that still await a
 * review, from you or from a team of yours, in the order of the snoozes.
 * A PR that got reviewed, closed, or re-requested while snoozed is no
 * longer the request the snooze parked, so it stays out and the snooze
 * ends quietly. Mention snoozes among the given ones are skipped,
 * because the mention module answers for them.
 */
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
