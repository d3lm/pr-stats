import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureCache } from './cache';
import type { MentionEntry } from './data';
import {
  emptyMentionReads,
  hasNewMention,
  isUnreadMention,
  markMentionRead,
  markMentionUnread,
  markOf,
  mentionItems,
  readMentionReads,
  seedMentionReads,
  splitMentions,
  unseedMentionReads,
  wokenMentions,
  writeMentionReads,
  type MentionMark,
  type MentionReads,
} from './mentions';
import type { Snooze } from './snooze';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pr-stats-mentions-'));
  process.env.PR_STATS_CACHE_DIR = dir;

  configureCache(true);
});

afterEach(() => {
  configureCache(false);
  delete process.env.PR_STATS_CACHE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function entry(repo: string, number: number, times: string[] | null, earlier: string[] = []): MentionEntry {
  return {
    earlier,
    pr: {
      repo,
      number,
      title: `pr ${number}`,
      url: `https://example.com/${repo}/${number}`,
      state: 'open',
      createdAt: new Date('2026-07-01T00:00:00Z'),
      updatedAt: new Date('2026-07-30T00:00:00Z'),
    },
    mentions:
      times === null
        ? null
        : times.map((at, i) => {
            return { id: `${repo}#${number}-${i}`, at: new Date(at) };
          }),
  };
}

const NOW = Date.parse('2026-08-01T12:00:00Z');
const SEED = Date.parse('2026-07-20T00:00:00Z');

function mark(at: string | number, ids: string[] = []): MentionMark {
  return { at: typeof at === 'string' ? Date.parse(at) : at, ids };
}

function seeded(reads: [string, MentionMark | null][] = [], seed: MentionMark = mark(SEED)): MentionReads {
  return { seed, reads: new Map(reads) };
}

function mentionSnooze(ref: string, until: string, at: string, ids?: string[]): Snooze {
  return { kind: 'mention', ref, until: Date.parse(until), at: Date.parse(at), ...(ids === undefined ? {} : { ids }) };
}

test('mentionItems keeps one item per readable PR with its mentions and the time of the newest one', () => {
  const items = mentionItems([
    entry('acme/api', 1, ['2026-07-10T09:00:00Z', '2026-07-25T09:00:00Z', '2026-07-15T09:00:00Z']),
    entry('acme/api', 2, null),
    entry('acme/web', 3, ['2026-07-22T09:00:00Z']),
  ]);

  expect(items.map((item) => [item.pr.number, item.mentionedAt, item.mentions.length])).toEqual([
    [1, Date.parse('2026-07-25T09:00:00Z'), 3],
    [3, Date.parse('2026-07-22T09:00:00Z'), 1],
  ]);

  expect(markOf(items[0])).toEqual({
    at: Date.parse('2026-07-25T09:00:00Z'),
    ids: ['acme/api#1-0', 'acme/api#1-1', 'acme/api#1-2'],
  });

  const [cut] = mentionItems([entry('acme/web', 3, ['2026-07-22T09:00:00Z'], ['acme/web#3-old'])]);

  expect(cut.ids).toEqual(['acme/web#3-0', 'acme/web#3-old']);
  expect(markOf(cut)).toEqual({ at: Date.parse('2026-07-22T09:00:00Z'), ids: ['acme/web#3-0', 'acme/web#3-old'] });
});

test('a mark made after the window cut a handled text still covers an edit to that text', () => {
  const texts = (mentions: [id: string, at: string][], earlier: string[] = []): MentionEntry => {
    return {
      ...entry('acme/api', 1, []),
      mentions: mentions.map(([id, at]) => {
        return { id, at: new Date(at) };
      }),
      earlier,
    };
  };

  const [withA] = mentionItems([texts([['A', '2026-07-10T09:00:00Z']])]);
  const readA = markMentionRead(seeded(), 'acme/api#1', markOf(withA));

  const [withB] = mentionItems([texts([['B', '2026-07-25T09:00:00Z']], ['A'])]);

  expect(isUnreadMention(readA, withB)).toBe(true);

  const readB = markMentionRead(readA, 'acme/api#1', markOf(withB));

  expect(readB.reads.get('acme/api#1')).toEqual(mark('2026-07-25T09:00:00Z', ['B', 'A']));

  const [edited] = mentionItems([
    texts([
      ['A', '2026-07-28T09:00:00Z'],
      ['B', '2026-07-25T09:00:00Z'],
    ]),
  ]);

  expect(isUnreadMention(readB, edited)).toBe(false);

  const snoozedB = mentionSnooze('acme/api#1', '2026-08-04T09:00:00Z', '2026-07-25T09:00:00Z', [...markOf(withB).ids]);

  const split = splitMentions([edited], readA, [snoozedB], NOW);

  expect(split.unread).toEqual([]);
  expect(split.snoozed.map((item) => item.pr.number)).toEqual([1]);
});

test('a mention is new against a mark when it is newer and the mark did not know its text', () => {
  const [item] = mentionItems([entry('acme/api', 1, ['2026-07-10T09:00:00Z', '2026-07-25T09:00:00Z'])]);

  expect(hasNewMention(item, mark('2026-07-25T09:00:00Z'))).toBe(false);
  expect(hasNewMention(item, mark('2026-07-25T08:59:59Z'))).toBe(true);
  expect(hasNewMention(item, mark('2026-07-20T00:00:00Z', ['acme/api#1-1']))).toBe(false);
  expect(hasNewMention(item, mark('2026-07-20T00:00:00Z', ['acme/api#1-0']))).toBe(true);
});

test('the read state follows the mark by hand, then the seed, and reads everything before the seed lands', () => {
  const reads = seeded([
    ['acme/api#1', mark('2026-07-25T09:00:00Z')],
    ['acme/api#2', null],
  ]);

  const [api1, api2, web3] = mentionItems([
    entry('acme/api', 1, ['2026-07-25T09:00:00Z']),
    entry('acme/api', 2, ['2026-07-01T09:00:00Z']),
    entry('acme/web', 3, ['2026-07-22T09:00:00Z']),
  ]);

  expect(isUnreadMention(reads, api1)).toBe(false);
  expect(isUnreadMention(reads, api2)).toBe(true);
  expect(isUnreadMention(reads, web3)).toBe(true);
  expect(isUnreadMention(emptyMentionReads(), web3)).toBe(false);

  expect(isUnreadMention(markMentionRead(reads, 'acme/web#3', markOf(web3)), web3)).toBe(false);
  expect(isUnreadMention(markMentionRead(reads, 'acme/web#3', mark(web3.mentionedAt - 1)), web3)).toBe(true);

  const marked = markMentionRead(reads, 'acme/web#3', markOf(web3));
  const [edited] = mentionItems([entry('acme/web', 3, ['2026-07-28T09:00:00Z'])]);
  const [extended] = mentionItems([entry('acme/web', 3, ['2026-07-22T09:00:00Z', '2026-07-28T09:00:00Z'])]);

  expect(isUnreadMention(marked, edited)).toBe(false);
  expect(isUnreadMention(marked, extended)).toBe(true);

  const known = seeded([], mark(SEED, ['acme/web#3-0']));

  expect(isUnreadMention(known, edited)).toBe(false);
  expect(isUnreadMention(known, extended)).toBe(true);
});

test('seeding only takes the first mark, unseeding drops it, and the marks by hand survive both', () => {
  const fresh = emptyMentionReads();
  const first = seedMentionReads(fresh, mark(SEED, ['acme/api#2-0']));

  expect(first.seed).toEqual(mark(SEED, ['acme/api#2-0']));
  expect(seedMentionReads(first, mark(NOW))).toBe(first);
  expect(seedMentionReads(fresh, mark(SEED))).not.toBe(fresh);

  const marked = markMentionUnread(first, 'acme/api#2');
  const unseeded = unseedMentionReads(marked);

  expect(unseeded.seed).toBeNull();
  expect(unseeded.reads).toEqual(new Map([['acme/api#2', null]]));
  expect(unseedMentionReads(unseeded)).toBe(unseeded);

  const [old] = mentionItems([entry('acme/api', 2, ['2026-07-10T09:00:00Z'])]);

  expect(isUnreadMention(first, old)).toBe(false);
  expect(isUnreadMention(marked, old)).toBe(true);
});

test('splitMentions sorts the inbox newest first and parks snoozed mentions until an unknown one arrives', () => {
  const items = mentionItems([
    entry('acme/api', 1, ['2026-07-21T09:00:00Z']),
    entry('acme/web', 2, ['2026-07-23T09:00:00Z']),
    entry('acme/api', 3, ['2026-07-22T09:00:00Z']),
    entry('acme/web', 4, ['2026-07-24T09:00:00Z']),
    entry('acme/api', 5, ['2026-07-10T09:00:00Z']),
    entry('acme/web', 6, ['2026-07-11T09:00:00Z']),
    entry('acme/api', 7, ['2026-07-25T09:00:00Z']),
    entry('acme/api', 8, ['2026-07-26T09:00:00Z']),
  ]);

  const reads = seeded([
    ['acme/web#6', null],
    ['acme/api#7', mark('2026-07-25T09:00:00Z')],
  ]);

  const snoozes = [
    mentionSnooze('acme/api#1', '2026-08-02T09:00:00Z', '2026-07-21T09:00:00Z'),
    mentionSnooze('acme/api#3', '2026-08-01T15:00:00Z', '2026-07-22T09:00:00Z'),
    mentionSnooze('acme/web#2', '2026-08-01T09:00:00Z', '2026-07-23T09:00:00Z'),
    mentionSnooze('acme/web#4', '2026-08-03T09:00:00Z', '2026-07-20T09:00:00Z'),
    mentionSnooze('acme/api#8', '2026-08-04T09:00:00Z', '2026-07-24T09:00:00Z', ['acme/api#8-0']),
    { kind: 'review' as const, ref: 'acme/web#2', until: Date.parse('2026-08-03T09:00:00Z'), at: NOW },
  ];

  const split = splitMentions(items, reads, snoozes, NOW);

  expect(split.unread.map((item) => item.pr.number)).toEqual([4, 2, 6]);

  expect(split.snoozed.map((item) => [item.pr.number, item.until])).toEqual([
    [3, Date.parse('2026-08-01T15:00:00Z')],
    [1, Date.parse('2026-08-02T09:00:00Z')],
    [8, Date.parse('2026-08-04T09:00:00Z')],
  ]);

  expect(split.read.map((item) => item.pr.number)).toEqual([7, 5]);

  expect(splitMentions(items, emptyMentionReads(), [], NOW).unread).toEqual([]);
});

test('wokenMentions lists the PRs whose snoozed mention still awaits you', () => {
  const due = [
    mentionSnooze('acme/api#1', '2026-08-01T09:00:00Z', '2026-07-21T09:00:00Z'),
    mentionSnooze('acme/api#2', '2026-08-01T09:00:00Z', '2026-07-21T09:00:00Z'),
    mentionSnooze('acme/api#3', '2026-08-01T09:00:00Z', '2026-07-21T09:00:00Z'),
    mentionSnooze('acme/api#4', '2026-08-01T09:00:00Z', '2026-07-21T09:00:00Z'),
    mentionSnooze('acme/api#5', '2026-08-01T09:00:00Z', '2026-07-21T09:00:00Z', ['acme/api#5-0']),
    { kind: 'review' as const, ref: 'acme/api#1', until: Date.parse('2026-08-01T09:00:00Z'), at: NOW },
  ];

  const entries = [
    entry('acme/api', 1, ['2026-07-21T09:00:00Z']),
    entry('acme/api', 2, ['2026-07-21T09:00:00Z', '2026-07-28T09:00:00Z']),
    entry('acme/api', 3, ['2026-07-21T09:00:00Z']),
    entry('acme/api', 5, ['2026-07-28T09:00:00Z']),
  ];

  const reads = seeded([['acme/api#3', mark('2026-07-21T09:00:00Z')]]);

  expect(wokenMentions(due, entries, reads).map((woken) => woken.number)).toEqual([1, 5]);
  expect(wokenMentions([], entries, reads)).toEqual([]);
});

test('writes and reads the read state of every login with the marks as ISO times and text ids', () => {
  const alice = seeded(
    [
      ['acme/api#1', mark('2026-07-25T09:00:00Z', ['acme/api#1-0'])],
      ['acme/api#2', null],
    ],
    mark(SEED, ['acme/api#1-0', 'acme/web#3-0']),
  );

  const bob = seeded([['acme/api#1', mark('2026-07-26T09:00:00Z', ['acme/api#1-0', 'acme/api#1-1'])]]);

  const all = new Map([
    ['alice', alice],
    ['bob', bob],
  ]);

  expect(writeMentionReads(all)).toBe(true);

  expect(JSON.parse(readFileSync(join(dir, 'mention-reads.json'), 'utf8'))).toEqual({
    users: {
      alice: {
        seed: { at: '2026-07-20T00:00:00.000Z', ids: ['acme/api#1-0', 'acme/web#3-0'] },
        reads: {
          'acme/api#1': { at: '2026-07-25T09:00:00.000Z', ids: ['acme/api#1-0'] },
          'acme/api#2': null,
        },
      },
      bob: {
        seed: { at: '2026-07-20T00:00:00.000Z', ids: [] },
        reads: { 'acme/api#1': { at: '2026-07-26T09:00:00.000Z', ids: ['acme/api#1-0', 'acme/api#1-1'] } },
      },
    },
  });

  expect(readMentionReads()).toEqual(all);

  expect(writeMentionReads(new Map())).toBe(true);
  expect(readMentionReads()).toEqual(new Map());

  configureCache(false);

  expect(writeMentionReads(all)).toBe(false);
  expect(readMentionReads()).toEqual(new Map());
});

test('reads an empty state from a missing or damaged file and drops damaged marks and logins', () => {
  expect(readMentionReads()).toEqual(new Map());

  writeFileSync(join(dir, 'mention-reads.json'), 'not json');

  expect(readMentionReads()).toEqual(new Map());

  writeFileSync(join(dir, 'mention-reads.json'), '[]');

  expect(readMentionReads()).toEqual(new Map());

  writeFileSync(
    join(dir, 'mention-reads.json'),
    JSON.stringify({ seededAt: '2026-07-20T00:00:00Z', reads: { 'acme/api#1': '2026-07-25T09:00:00Z' } }),
  );

  expect(readMentionReads()).toEqual(new Map());

  writeFileSync(
    join(dir, 'mention-reads.json'),
    JSON.stringify({
      users: {
        Alice: {
          seed: { at: 'yesterday', ids: [] },
          reads: {
            'acme/api#1': { at: '2026-07-25T09:00:00Z', ids: ['acme/api#1-0', 7] },
            'acme/api#2': { at: 'soon', ids: [] },
            'acme/api#3': 7,
            'acme/api#4': null,
            'acme/api#5': { at: '2026-07-25T09:00:00Z' },
          },
        },
        bob: 'nothing',
      },
    }),
  );

  expect(readMentionReads()).toEqual(
    new Map([
      [
        'alice',
        {
          seed: null,
          reads: new Map([
            ['acme/api#1', mark('2026-07-25T09:00:00Z', ['acme/api#1-0'])],
            ['acme/api#4', null],
          ]),
        },
      ],
    ]),
  );
});
