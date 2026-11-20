import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir, cacheEnabled, prKey, writeFileAtomic } from './cache';
import type { Mention, MentionedPr, MentionEntry } from './data';
import { partitionSnoozed, type Snooze } from './snooze';

/**
 * Tracks ids alongside the time because editing a text moves its time without making it a new mention.
 */
export interface MentionMark {
  at: number;
  ids: readonly string[];
}

export interface MentionReads {
  seed: MentionMark | null;
  reads: Map<string, MentionMark | null>;
}

/**
 * Keys the read state by lowercase login because GitHub logins are case-insensitive.
 */
export type MentionReadsByUser = Map<string, MentionReads>;

export function emptyMentionReads(): MentionReads {
  return { seed: null, reads: new Map() };
}

export interface MentionItem {
  pr: MentionedPr;
  mentionedAt: number;
  mentions: readonly Mention[];
  ids: readonly string[];
}

export function mentionIdsOf(entry: MentionEntry): string[] {
  return [...(entry.mentions ?? []).map((mention) => mention.id), ...entry.earlier];
}

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

export function markOf(item: MentionItem): MentionMark {
  return { at: item.mentionedAt, ids: item.ids };
}

export function hasNewMention(item: MentionItem, mark: MentionMark): boolean {
  return item.mentions.some((mention) => mention.at.getTime() > mark.at && !mark.ids.includes(mention.id));
}

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

export function seedMentionReads(reads: MentionReads, seed: MentionMark): MentionReads {
  return reads.seed === null ? { ...reads, seed } : reads;
}

export function unseedMentionReads(reads: MentionReads): MentionReads {
  return reads.seed === null ? reads : { ...reads, seed: null };
}

export function markMentionRead(reads: MentionReads, ref: string, mark: MentionMark): MentionReads {
  return { ...reads, reads: new Map(reads.reads).set(ref, mark) };
}

export function markMentionUnread(reads: MentionReads, ref: string): MentionReads {
  return { ...reads, reads: new Map(reads.reads).set(ref, null) };
}

function snoozeMark(snooze: Snooze): MentionMark {
  return { at: snooze.at, ids: snooze.ids ?? [] };
}

export function splitMentions(
  items: readonly MentionItem[],
  reads: MentionReads,
  snoozes: readonly Snooze[],
  now: number,
): { unread: MentionItem[]; snoozed: (MentionItem & { until: number })[]; read: MentionItem[] } {
  const read: MentionItem[] = [];
  const pending: MentionItem[] = [];

  for (const item of items) {
    const bucket = isUnreadMention(reads, item) ? pending : read;

    bucket.push(item);
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

function byNewestMention(a: MentionItem, b: MentionItem): number {
  return b.mentionedAt - a.mentionedAt;
}

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

export function mentionReadsFile(): string {
  return join(cacheDir(), 'mention-reads.json');
}

interface StoredMark {
  at: string;
  ids: string[];
}

interface StoredMentionReads {
  seed: StoredMark | null;
  reads: Record<string, StoredMark | null>;
}

interface StoredMentionReadsFile {
  users: Record<string, StoredMentionReads>;
}

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
