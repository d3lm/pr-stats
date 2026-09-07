import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir, cacheEnabled, prKey, writeFileAtomic } from './cache';
import type { Mention, MentionedPr, MentionEntry } from './data';
import { partitionSnoozed, type Snooze } from './snooze';

/**
 * One point up to which the mentions of a PR count as handled. The time
 * is in milliseconds since the epoch, and the ids name the texts that
 * mentioned you when the mark was made. A mention counts as new against
 * the mark when it is newer than the time and its text is not among the
 * ids, because the time of a text moves when its author edits it, and an
 * edit to a text you already handled is not a new mention, while a text
 * the mark never knew is one, whether it was written after the mark or
 * edited to name you after it.
 */
export interface MentionMark {
  at: number;
  ids: readonly string[];
}

/**
 * Read state of the mention inbox for one login. The seed is the mark
 * the inbox started from, and every mention it covers counts as read
 * unless a per-PR entry says otherwise, so the inbox starts empty
 * instead of listing every mention of the window. It stays null until
 * the first load with mention data seeds it. The reads map holds one
 * entry per PR ref that was marked by hand, the mark up to which its
 * mentions count as read, or null for a PR marked unread, whose every
 * mention counts as unread until the next mark.
 */
export interface MentionReads {
  seed: MentionMark | null;
  reads: Map<string, MentionMark | null>;
}

/**
 * Read state of every login that used this machine, keyed by the login
 * in lower case the way GitHub compares logins. What one account read
 * says nothing about another, so switching the account switches the
 * state along with the data.
 */
export type MentionReadsByUser = Map<string, MentionReads>;

/**
 * Builds the read state of a login without a persisted one, which
 * treats every mention as read until the first load seeds it.
 */
export function emptyMentionReads(): MentionReads {
  return { seed: null, reads: new Map() };
}

/**
 * One PR of the mention inbox, with every text on it that mentions you
 * within the window and the time of the newest one in milliseconds since
 * the epoch. The inbox sorts and labels the item by that time, and the
 * read state and the snoozes compare the texts against their marks, so a
 * fresh mention on a PR you already handled brings it back while an edit
 * to one you handled does not. The ids name every text that mentions you
 * on the PR, the ones in the window and the earlier ones the window cut,
 * which is what a mark made on the item records.
 */
export interface MentionItem {
  pr: MentionedPr;
  mentionedAt: number;
  mentions: readonly Mention[];
  ids: readonly string[];
}

/**
 * Lists the ids of every text that mentions you on the PR of the entry,
 * the mentions in the window followed by the earlier ones the window
 * cut. An entry the load could not read lists nothing.
 */
export function mentionIdsOf(entry: MentionEntry): string[] {
  return [...(entry.mentions ?? []).map((mention) => mention.id), ...entry.earlier];
}

/**
 * Maps the mention entries of a load onto inbox items, one per PR with
 * its mentions. Entries the load could not read carry no mentions and
 * stay out, because the inbox cannot tell whether they hold anything
 * new, and the next load that reads them brings them in.
 */
export function mentionItems(entries: readonly MentionEntry[]): MentionItem[] {
  const items: MentionItem[] = [];

  for (const entry of entries) {
    if (entry.mentions === null || entry.mentions.length === 0) {
      continue;
    }

    items.push({
      pr: entry.pr,
      mentionedAt: Math.max(...entry.mentions.map((mention) => mention.at.getTime())),
      mentions: entry.mentions,
      ids: mentionIdsOf(entry),
    });
  }

  return items;
}

/**
 * Builds the mark a read or a snooze records for an item, the time of
 * its newest mention together with the ids of every text that mentions
 * you on it, the earlier ones included, so a text the window cut before
 * the mark was made still counts as handled when an edit brings it back.
 */
export function markOf(item: MentionItem): MentionMark {
  return { at: item.mentionedAt, ids: item.ids };
}

/**
 * Reports whether the item carries a mention the mark does not cover,
 * one newer than the mark whose text the mark did not know.
 */
export function hasNewMention(item: MentionItem, mark: MentionMark): boolean {
  return item.mentions.some((mention) => mention.at.getTime() > mark.at && !mark.ids.includes(mention.id));
}

/**
 * Reports whether the item holds a mention that counts as unread. A PR
 * marked by hand answers against its own mark, where a PR marked unread
 * reads every mention as unread, and every other PR answers against the
 * seed. Before the seed lands every mention reads as read, so the inbox
 * never flashes full in the moment between the first data and the seed.
 */
export function isUnreadMention(reads: MentionReads, item: MentionItem): boolean {
  const mark = reads.reads.get(prKey(item.pr.repo, item.pr.number));

  if (mark === null) {
    return true;
  }

  if (mark !== undefined) {
    return hasNewMention(item, mark);
  }

  return reads.seed !== null && hasNewMention(item, reads.seed);
}

/**
 * Seeds the inbox at the given mark when it has no seed yet, and returns
 * the state unchanged otherwise, so the first data of a session decides
 * where the inbox starts and every later load leaves it alone.
 */
export function seedMentionReads(reads: MentionReads, seed: MentionMark): MentionReads {
  return reads.seed === null ? { ...reads, seed } : reads;
}

/**
 * Drops the seed, which a load without mention data does, so the next
 * load with mention data seeds the inbox afresh instead of listing
 * everything since the old seed as unread. The marks made by hand stay.
 */
export function unseedMentionReads(reads: MentionReads): MentionReads {
  return reads.seed === null ? reads : { ...reads, seed: null };
}

/**
 * Marks the mentions of the given PR up to the given mark as read.
 */
export function markMentionRead(reads: MentionReads, ref: string, mark: MentionMark): MentionReads {
  return { ...reads, reads: new Map(reads.reads).set(ref, mark) };
}

/**
 * Marks every mention of the given PR as unread, which overrides the
 * seed as well, so a PR whose mentions predate the inbox can still be
 * pulled into it.
 */
export function markMentionUnread(reads: MentionReads, ref: string): MentionReads {
  return { ...reads, reads: new Map(reads.reads).set(ref, null) };
}

/**
 * Reads a mention snooze as the mark it recorded. Snoozes written before
 * the mark carried ids know no text, so any mention newer than their
 * time counts as new against them.
 */
function snoozeMark(snooze: Snooze): MentionMark {
  return { at: snooze.at, ids: snooze.ids ?? [] };
}

/**
 * Splits the inbox items into the unread ones, the ones a mention snooze
 * covers at the given time, and the read ones. The unread and the read
 * lists sort newest mention first, the way an inbox reads, and the
 * snoozed list sorts soonest wake-up first with each item carrying its
 * wake-up time. A snooze only covers an item while no mention it did not
 * know arrived, so a PR that mentions you again while snoozed comes back
 * unread.
 */
export function splitMentions(
  items: readonly MentionItem[],
  reads: MentionReads,
  snoozes: readonly Snooze[],
  now: number,
): { unread: MentionItem[]; snoozed: (MentionItem & { until: number })[]; read: MentionItem[] } {
  const read: MentionItem[] = [];
  const pending: MentionItem[] = [];

  for (const item of items) {
    (isUnreadMention(reads, item) ? pending : read).push(item);
  }

  const { awaiting, snoozed } = partitionSnoozed(
    'mention',
    pending,
    snoozes,
    now,
    (snooze, item) => !hasNewMention(item, snoozeMark(snooze)),
  );

  return { unread: awaiting.toSorted(byNewestMention), snoozed, read: read.toSorted(byNewestMention) };
}

/**
 * Orders inbox items newest mention first.
 */
function byNewestMention(a: MentionItem, b: MentionItem): number {
  return b.mentionedAt - a.mentionedAt;
}

/**
 * Lists the PRs behind the given mention snoozes whose mention still
 * awaits you, in the order of the snoozes. A PR that got marked read or
 * mentioned you again while snoozed is no longer the mention the snooze
 * parked, so it stays out and the snooze ends quietly. Review snoozes
 * among the given ones are skipped, because the snooze module answers
 * for them.
 */
export function wokenMentions(
  due: readonly Snooze[],
  entries: readonly MentionEntry[],
  reads: MentionReads,
): MentionedPr[] {
  const items = new Map<string, MentionItem>();

  for (const item of mentionItems(entries)) {
    items.set(prKey(item.pr.repo, item.pr.number), item);
  }

  return due.flatMap((snooze) => {
    if (snooze.kind !== 'mention') {
      return [];
    }

    const item = items.get(snooze.ref);

    return item !== undefined && !hasNewMention(item, snoozeMark(snooze)) && isUnreadMention(reads, item)
      ? [item.pr]
      : [];
  });
}

/**
 * Resolves the path of the mention read state, which lives next to
 * snoozes.json in the cache directory and stays out of the files a cache
 * clear deletes, because what you read is a preference and not cached
 * data.
 */
export function mentionReadsFile(): string {
  return join(cacheDir(), 'mention-reads.json');
}

/**
 * On-disk shape of one mark, with the time as an ISO string so the file
 * reads well when opened by hand.
 */
interface StoredMark {
  at: string;
  ids: string[];
}

/**
 * On-disk shape of the read state of one login. A null seed means the
 * inbox waits for its first mention data, and a null mark means the PR
 * was marked unread.
 */
interface StoredMentionReads {
  seed: StoredMark | null;
  reads: Record<string, StoredMark | null>;
}

/**
 * On-disk shape of the read state file, one entry per login in lower
 * case.
 */
interface StoredMentionReadsFile {
  users: Record<string, StoredMentionReads>;
}

/**
 * Parses one stored mark, or returns undefined for anything that is not
 * a valid time with a list of ids, so a damaged entry drops out instead
 * of breaking the whole file.
 */
function reviveMark(stored: unknown): MentionMark | undefined {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return undefined;
  }

  const { at, ids } = stored as { at?: unknown; ids?: unknown };

  if (typeof at !== 'string' || !Array.isArray(ids)) {
    return undefined;
  }

  const ms = Date.parse(at);

  return Number.isNaN(ms) ? undefined : { at: ms, ids: ids.filter((id): id is string => typeof id === 'string') };
}

/**
 * Parses the stored read state of one login, dropping the marks that
 * do not parse. Returns undefined when the entry is not an object at
 * all, so a damaged login entry drops out.
 */
function reviveReads(stored: unknown): MentionReads | undefined {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return undefined;
  }

  const { seed, reads: marks } = stored as { seed?: unknown; reads?: unknown };
  const reads = new Map<string, MentionMark | null>();

  if (typeof marks === 'object' && marks !== null && !Array.isArray(marks)) {
    for (const [ref, mark] of Object.entries(marks as Record<string, unknown>)) {
      if (mark === null) {
        reads.set(ref, null);
      } else {
        const revived = reviveMark(mark);

        if (revived !== undefined) {
          reads.set(ref, revived);
        }
      }
    }
  }

  return { seed: reviveMark(seed) ?? null, reads };
}

/**
 * Reads the read state of every login from the cache directory. Returns
 * an empty map while the cache is disabled, so debug runs and tests
 * never read the real file, and for a missing or unreadable file,
 * because the file is not meant to be edited by hand and a fresh start
 * beats a failed one.
 */
export function readMentionReads(): MentionReadsByUser {
  const all: MentionReadsByUser = new Map();

  if (!cacheEnabled()) {
    return all;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(mentionReadsFile(), 'utf8'));
  } catch {
    return all;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return all;
  }

  /**
   * The file is typed loosely here, because a hand-edited or damaged
   * file can hold anything, and every field gets checked before it
   * counts.
   */
  const { users } = parsed as { users?: unknown };

  if (typeof users !== 'object' || users === null || Array.isArray(users)) {
    return all;
  }

  for (const [login, stored] of Object.entries(users as Record<string, unknown>)) {
    const reads = reviveReads(stored);

    if (reads !== undefined) {
      all.set(login.toLowerCase(), reads);
    }
  }

  return all;
}

function storeMark(mark: MentionMark): StoredMark {
  return { at: new Date(mark.at).toISOString(), ids: [...mark.ids] };
}

/**
 * Writes the read state of every login to the cache directory, replacing
 * the previous file. Returns false without writing while the cache is
 * disabled, which keeps debug runs from writing it.
 */
export function writeMentionReads(all: MentionReadsByUser): boolean {
  if (!cacheEnabled()) {
    return false;
  }

  const stored: StoredMentionReadsFile = { users: {} };

  for (const [login, reads] of all) {
    const marks: Record<string, StoredMark | null> = {};

    for (const [ref, mark] of reads.reads) {
      marks[ref] = mark === null ? null : storeMark(mark);
    }

    stored.users[login] = { seed: reads.seed === null ? null : storeMark(reads.seed), reads: marks };
  }

  writeFileAtomic(mentionReadsFile(), `${JSON.stringify(stored, null, 2)}\n`);

  return true;
}
