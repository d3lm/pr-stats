import { expect, test } from 'bun:test';
import { emptyMentionReads, type MentionReads } from '../../mentions';
import { formatWakeTime, type Snooze } from '../../snooze';
import type { MentionEntry, RawData, ReviewResult, SizeEntry } from '../data/load';
import {
  buildMentionsView,
  buildOpenAuthoredView,
  buildPendingReviewView,
  buildReviewedView,
  mentionActionOf,
  queueAlerts,
  queueRowAt,
  queueRows,
  snoozeActionOf,
  unreadMentionRows,
} from './queue';
import {
  buildMentionRepoOptions,
  buildOpenRepoOptions,
  buildPendingRepoOptions,
  buildReviewedRepoOptions,
} from './repos';

/**
 * Builds the PR descriptor shared by review results and size entries.
 */
function pr(repo: string, number: number, state: string, createdAt = '2026-07-01T00:00:00Z') {
  return {
    repo,
    number,
    title: `pr ${number}`,
    url: `https://example.com/${repo}/${number}`,
    state,
    createdAt: new Date(createdAt),
  };
}

/**
 * Builds a pending review result, a PR awaiting a review since the given
 * time, open unless a state overrides it.
 */
function pendingResult(repo: string, number: number, requestedAt: string, state = 'open'): ReviewResult {
  return { kind: 'pending', pr: pr(repo, number, state), requestedAt: new Date(requestedAt) };
}

/**
 * Builds a reviewed result, a completed request-review cycle answered at
 * the given time, on an open PR unless a state overrides it.
 */
function reviewedResult(repo: string, number: number, reviewedAt: string, state = 'open'): ReviewResult {
  return {
    kind: 'reviewed',
    pr: pr(repo, number, state),
    requestedAt: new Date('2026-06-15T00:00:00Z'),
    reviewedAt: new Date(reviewedAt),
    verdict: 'APPROVED',
    lines: 15,
  };
}

/**
 * Builds an unrequested result, a review you gave at the given time
 * without a personal request, on an open PR unless a state overrides it.
 */
function unrequestedResult(repo: string, number: number, reviewedAt: string, state = 'open'): ReviewResult {
  return { kind: 'unrequested', pr: pr(repo, number, state), reviewedAt: new Date(reviewedAt) };
}

/**
 * Builds a team-pending result, a PR where only the given team of yours
 * awaits a review since the given time, open unless a state overrides it.
 */
function teamPendingResult(
  repo: string,
  number: number,
  requestedAt: string,
  team = 'acme/backend',
  state = 'open',
): ReviewResult {
  return { kind: 'team-pending', pr: pr(repo, number, state), requestedAt: new Date(requestedAt), team };
}

/**
 * Builds a team-reviewed result, a completed cycle a team of yours was
 * asked for and you answered at the given time, on an open PR.
 */
function teamReviewedResult(repo: string, number: number, reviewedAt: string): ReviewResult {
  return {
    kind: 'team-reviewed',
    pr: pr(repo, number, 'open'),
    requestedAt: new Date('2026-06-15T00:00:00Z'),
    reviewedAt: new Date(reviewedAt),
    verdict: 'APPROVED',
    lines: 15,
    team: 'acme/backend',
  };
}

/**
 * Builds a size entry with a fixed size, so the tests only vary the repo,
 * the state, and the creation date.
 */
function sizeEntry(repo: string, number: number, state: string, createdAt = '2026-07-01T00:00:00Z'): SizeEntry {
  return {
    pr: pr(repo, number, state, createdAt),
    files: 2,
    additions: 10,
    deletions: 5,
    total: 15,
    mergedAt: null,
    closedAt: state === 'open' ? null : new Date('2026-07-15T00:00:00Z'),
    comments: { discussion: 0, review: 0, total: 0 },
    reviews: [],
  };
}

/**
 * Builds a snooze of the given PR ref that wakes up at the given time and
 * covers the ask made at the given time, a review request unless a kind
 * overrides it.
 */
function snooze(ref: string, until: string, at: string, kind: Snooze['kind'] = 'review'): Snooze {
  return { kind, ref, until: Date.parse(until), at: Date.parse(at) };
}

/**
 * Builds a mention entry with one mention of you at each of the given
 * times, on an open PR unless a state overrides it.
 */
function mentionEntry(repo: string, number: number, times: string[], state = 'open'): MentionEntry {
  return {
    pr: { ...pr(repo, number, state), updatedAt: new Date(times.at(-1) ?? '2026-07-01T00:00:00Z') },
    mentions: times.map((at, i) => {
      return { id: `${repo}#${number}-${i}`, at: new Date(at) };
    }),
    earlier: [],
  };
}

/**
 * Builds a read state seeded at the given time with the given marks by
 * hand, each a time or null for a PR marked unread, none of which knows
 * any text.
 */
function reads(seededAt: string, marks: [string, number | null][] = []): MentionReads {
  return {
    seed: { at: Date.parse(seededAt), ids: [] },
    reads: new Map(marks.map(([ref, at]) => [ref, at === null ? null : { at, ids: [] }])),
  };
}

/**
 * Builds raw data around the given results, fetched after every canned
 * timestamp so the pending waits stay positive.
 */
function rawData(overrides: Partial<RawData>): RawData {
  return {
    user: 'testuser',
    sinceIso: '2026-06-01',
    repos: [],
    reviewResults: [],
    sizes: [],
    authoredTotal: 0,
    mentions: null,
    searchCapped: false,
    fetchedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

test('the pending picker lists every repo with review activity and skips the picker below two repos', () => {
  const raw = rawData({
    reviewResults: [
      pendingResult('acme/web', 1, '2026-07-01T00:00:00Z'),
      pendingResult('acme/api', 2, '2026-07-02T00:00:00Z'),
      pendingResult('acme/api', 3, '2026-07-03T00:00:00Z'),
      /**
       * A closed pending request and a closed reviewed PR stay out of
       * the queue counts, but their repos stay on the list, so the
       * picker matches the review tab's.
       */
      pendingResult('acme/zulu', 4, '2026-07-04T00:00:00Z', 'closed'),
      reviewedResult('acme/zulu', 5, '2026-07-02T00:00:00Z', 'closed'),
      // an open reviewed PR counts into the repo's reviewed detail
      reviewedResult('acme/web', 6, '2026-07-05T00:00:00Z'),
    ],
  });

  expect(buildPendingRepoOptions(raw)).toEqual([
    { repo: null, label: 'All repos', detail: '3 PRs awaiting your review' },
    { repo: 'acme/api', label: 'acme/api', detail: '2 PRs awaiting your review' },
    { repo: 'acme/web', label: 'acme/web', detail: '1 PR awaiting your review' },
    { repo: 'acme/zulu', label: 'acme/zulu', detail: '0 PRs awaiting your review' },
  ]);

  // the reviewed picker lists the same repos, most reviewed first
  expect(buildReviewedRepoOptions(raw)).toEqual([
    { repo: null, label: 'All repos', detail: '1 reviewed PR still open' },
    { repo: 'acme/web', label: 'acme/web', detail: '1 reviewed PR still open' },
    { repo: 'acme/api', label: 'acme/api', detail: '0 reviewed PRs still open' },
    { repo: 'acme/zulu', label: 'acme/zulu', detail: '0 reviewed PRs still open' },
  ]);

  const single = rawData({ reviewResults: [pendingResult('acme/api', 1, '2026-07-01T00:00:00Z')] });

  expect(buildPendingRepoOptions(single)).toEqual([]);
  expect(buildReviewedRepoOptions(single)).toEqual([]);
});

test('the open picker lists every repo with an analyzed PR and skips the picker below two repos', () => {
  const raw = rawData({
    sizes: [
      sizeEntry('acme/api', 1, 'open'),
      sizeEntry('acme/web', 2, 'open'),
      sizeEntry('acme/web', 3, 'open'),
      /**
       * A closed PR stays out of the open counts, but its repo stays on
       * the list, so the picker matches the size tab's.
       */
      sizeEntry('acme/zulu', 4, 'closed'),
    ],
  });

  expect(buildOpenRepoOptions(raw)).toEqual([
    { repo: null, label: 'All repos', detail: '3 open PRs' },
    { repo: 'acme/web', label: 'acme/web', detail: '2 open PRs' },
    { repo: 'acme/api', label: 'acme/api', detail: '1 open PR' },
    { repo: 'acme/zulu', label: 'acme/zulu', detail: '0 open PRs' },
  ]);

  expect(
    buildOpenRepoOptions(rawData({ sizes: [sizeEntry('acme/api', 1, 'open'), sizeEntry('acme/api', 2, 'open')] })),
  ).toEqual([]);
});

test('the pending view narrows to a repo and groups the aggregate by repo', () => {
  const raw = rawData({
    reviewResults: [
      pendingResult('acme/web', 1, '2026-07-02T00:00:00Z'),
      pendingResult('acme/api', 2, '2026-07-01T00:00:00Z'),
      pendingResult('acme/api', 3, '2026-07-03T00:00:00Z'),
    ],
  });

  const flat = buildPendingReviewView(raw);

  expect(flat.sections.map((section) => section.title)).toEqual(['Awaiting your review (n=3)']);
  expect(flat.sections[0].lists).toEqual([]);
  expect(queueRows(flat).map((row) => row.ref)).toEqual(['acme/api#2', 'acme/web#1', 'acme/api#3']);

  const narrowed = buildPendingReviewView(raw, 'acme/api');

  expect(narrowed.sections.map((section) => section.title)).toEqual(['Awaiting your review (n=2)']);
  expect(queueRows(narrowed).map((row) => row.ref)).toEqual(['acme/api#2', 'acme/api#3']);

  /**
   * Grouping keeps the section and splits its rows into one sub-list per
   * repo, largest repo first, each keeping the longest wait on top. A
   * repo scope ignores the flag, because a single repo has nothing to
   * group.
   */
  const grouped = buildPendingReviewView(raw, null, true);

  expect(grouped.sections.map((section) => section.title)).toEqual(['Awaiting your review (n=3)']);
  expect(grouped.sections[0].rows).toEqual([]);
  expect(grouped.sections[0].lists.map((list) => list.title)).toEqual(['acme/api (n=2)', 'acme/web (n=1)']);
  expect(queueRows(grouped).map((row) => row.ref)).toEqual(['acme/api#2', 'acme/api#3', 'acme/web#1']);

  expect(buildPendingReviewView(raw, 'acme/api', true)).toEqual(narrowed);

  expect(buildPendingReviewView(rawData({}), null, true).empty).toBe('No PRs are awaiting your review.');
});

test('the reviewed view lists PRs you reviewed that are still open, apart from the awaiting queue', () => {
  const raw = rawData({
    reviewResults: [
      pendingResult('acme/api', 1, '2026-07-01T00:00:00Z'),
      /**
       * Two completed cycles on the same open PR collapse into one
       * reviewed row, which carries the latest review time and sorts
       * by it, oldest first.
       */
      reviewedResult('acme/api', 2, '2026-07-02T00:00:00Z'),
      reviewedResult('acme/api', 2, '2026-07-06T00:00:00Z'),
      // a review without a personal request counts into the queue too
      unrequestedResult('acme/web', 3, '2026-07-04T00:00:00Z'),
      /**
       * A reviewed PR with a fresh re-request sits in the awaiting queue
       * alone, and closed PRs never enter either queue.
       */
      reviewedResult('acme/web', 4, '2026-07-01T00:00:00Z'),
      pendingResult('acme/web', 4, '2026-07-10T00:00:00Z'),
      reviewedResult('acme/api', 5, '2026-07-05T00:00:00Z', 'merged'),
      unrequestedResult('acme/web', 6, '2026-07-05T00:00:00Z', 'closed'),
      pendingResult('acme/zulu', 7, '2026-07-08T00:00:00Z'),
    ],
  });

  const pending = buildPendingReviewView(raw);

  expect(pending.sections.map((section) => section.title)).toEqual(['Awaiting your review (n=3)']);
  expect(queueRows(pending).map((row) => row.ref)).toEqual(['acme/api#1', 'acme/zulu#7', 'acme/web#4']);

  const flat = buildReviewedView(raw);

  expect(flat.sections.map((section) => section.title)).toEqual(['Reviewed (n=2)']);
  expect(queueRows(flat).map((row) => row.ref)).toEqual(['acme/web#3', 'acme/api#2']);
  expect(queueRows(flat)[0].pending).toBeUndefined();

  // narrowing to a repo filters the list
  const narrowed = buildReviewedView(raw, 'acme/api');

  expect(narrowed.sections.map((section) => section.title)).toEqual(['Reviewed (n=1)']);
  expect(queueRows(narrowed).map((row) => row.ref)).toEqual(['acme/api#2']);

  // a scope without reviewed PRs says so
  expect(buildReviewedView(raw, 'acme/zulu').empty).toBe('No PRs you reviewed are still open.');

  /**
   * Grouping splits the list into per-repo sub-lists, ordered largest
   * repo first with ties broken by name.
   */
  const grouped = buildReviewedView(raw, null, true);

  expect(grouped.sections[0].rows).toEqual([]);
  expect(grouped.sections[0].lists.map((list) => list.title)).toEqual(['acme/api (n=1)', 'acme/web (n=1)']);
  expect(queueRows(grouped).map((row) => row.ref)).toEqual(['acme/api#2', 'acme/web#3']);

  expect(buildReviewedView(raw, 'acme/api', true)).toEqual(narrowed);
});

test('the pending view parks snoozed PRs in their own section until they wake up', () => {
  const raw = rawData({
    reviewResults: [
      pendingResult('acme/api', 1, '2026-07-01T00:00:00Z'),
      pendingResult('acme/web', 2, '2026-07-02T00:00:00Z'),
      pendingResult('acme/api', 3, '2026-07-03T00:00:00Z'),
      pendingResult('acme/web', 4, '2026-07-04T00:00:00Z'),
      reviewedResult('acme/api', 5, '2026-07-05T00:00:00Z'),
    ],
  });

  const now = Date.parse('2026-08-01T12:00:00Z');

  const snoozes = [
    snooze('acme/api#1', '2026-08-02T09:00:00Z', '2026-07-01T00:00:00Z'),
    snooze('acme/web#2', '2026-08-01T15:00:00Z', '2026-07-02T00:00:00Z'),
    // this snooze already woke up, so api#3 stays in the awaiting queue
    snooze('acme/api#3', '2026-08-01T09:00:00Z', '2026-07-03T00:00:00Z'),
    // web#4 was re-requested after this snooze, which voids it
    snooze('acme/web#4', '2026-08-03T09:00:00Z', '2026-06-20T00:00:00Z'),
  ];

  /**
   * The snoozed section sits below the awaiting queue, soonest wake-up
   * first, and its rows lead with the wake-up time instead of the wait.
   * Every pending row carries its request time, and the snoozed rows
   * mark themselves for the snooze key. The reviewed PR belongs to the
   * reviewed sub-tab and stays out.
   */
  const flat = buildPendingReviewView(raw, null, false, snoozes, emptyMentionReads(), now);

  expect(flat.sections.map((section) => section.title)).toEqual(['Awaiting your review (n=2)', 'Snoozed (n=2)']);

  expect(queueRows(flat).map((row) => row.ref)).toEqual(['acme/api#3', 'acme/web#4', 'acme/web#2', 'acme/api#1']);

  const rows = queueRows(flat);

  expect(rows[0].pending).toEqual({ requestedAt: Date.parse('2026-07-03T00:00:00Z'), snoozed: false });
  expect(rows[2].pending).toEqual({ requestedAt: Date.parse('2026-07-02T00:00:00Z'), snoozed: true });
  expect(rows[2].lead.trimEnd()).toBe(`until ${formatWakeTime(Date.parse('2026-08-01T15:00:00Z'), now)}`);
  expect(rows[3].lead.trimEnd()).toBe(`until ${formatWakeTime(Date.parse('2026-08-02T09:00:00Z'), now)}`);

  expect(snoozeActionOf(queueRowAt(flat, 0))).toBe('snooze');
  expect(snoozeActionOf(queueRowAt(flat, 2))).toBe('unsnooze');
  expect(snoozeActionOf(queueRowAt(buildReviewedView(raw), 0))).toBeNull();
  expect(snoozeActionOf(queueRowAt(flat, 99))).toBe('unsnooze');
  expect(snoozeActionOf(queueRowAt(null, 0))).toBeNull();

  // narrowing to a repo filters the snoozed queue like the others
  const narrowed = buildPendingReviewView(raw, 'acme/web', false, snoozes, emptyMentionReads(), now);

  expect(narrowed.sections.map((section) => section.title)).toEqual(['Awaiting your review (n=1)', 'Snoozed (n=1)']);
  expect(queueRows(narrowed).map((row) => row.ref)).toEqual(['acme/web#4', 'acme/web#2']);

  // grouping splits the snoozed section into per-repo sub-lists too
  const grouped = buildPendingReviewView(raw, null, true, snoozes, emptyMentionReads(), now);

  expect(grouped.sections[1].rows).toEqual([]);
  expect(grouped.sections[1].lists.map((list) => list.title)).toEqual(['acme/api (n=1)', 'acme/web (n=1)']);

  expect(queueRows(grouped).map((row) => row.ref)).toEqual(['acme/api#3', 'acme/web#4', 'acme/api#1', 'acme/web#2']);

  // a queue with nothing but snoozed PRs still renders its section instead of the empty message
  const onlySnoozed = buildPendingReviewView(
    rawData({ reviewResults: [pendingResult('acme/api', 1, '2026-07-01T00:00:00Z')] }),
    null,
    false,
    snoozes,
    emptyMentionReads(),
    now,
  );

  expect(onlySnoozed.empty).toBeNull();
  expect(onlySnoozed.sections.map((section) => section.title)).toEqual(['Snoozed (n=1)']);

  /**
   * The picker counts the snoozed PRs apart from the awaiting ones, and
   * a repo without snoozed PRs skips that part of the detail.
   */
  expect(buildPendingRepoOptions(raw, snoozes, now)).toEqual([
    { repo: null, label: 'All repos', detail: '2 PRs awaiting your review, 2 snoozed' },
    { repo: 'acme/api', label: 'acme/api', detail: '1 PR awaiting your review, 1 snoozed' },
    { repo: 'acme/web', label: 'acme/web', detail: '1 PR awaiting your review, 1 snoozed' },
  ]);

  expect(buildPendingRepoOptions(raw)[0].detail).toBe('4 PRs awaiting your review');
});

test('the pending view lists the requests of your teams in their own section while the setting is on', () => {
  const raw = rawData({
    reviewResults: [
      pendingResult('acme/api', 1, '2026-07-03T00:00:00Z'),
      teamPendingResult('acme/web', 2, '2026-07-02T00:00:00Z'),
      teamPendingResult('acme/api', 3, '2026-07-01T00:00:00Z', 'acme/oncall'),
      // a team request on a closed PR and a cycle you answered stay off the queue
      teamPendingResult('acme/web', 4, '2026-07-04T00:00:00Z', 'acme/backend', 'closed'),
      teamReviewedResult('acme/api', 5, '2026-07-05T00:00:00Z'),
      // a PR you reviewed that your team was asked about again waits for the team
      reviewedResult('acme/web', 6, '2026-07-01T00:00:00Z'),
      teamPendingResult('acme/web', 6, '2026-07-06T00:00:00Z'),
    ],
    mentions: [mentionEntry('acme/web', 2, ['2026-07-21T00:00:00Z'])],
  });

  const now = Date.parse('2026-08-01T12:00:00Z');
  const state = reads('2026-07-20T00:00:00Z');

  /**
   * The team section follows the awaiting queue, oldest request first,
   * each row carrying its team and the request time for the snooze key,
   * and the badge where the PR also mentions you. The direct request
   * keeps its section to itself.
   */
  const flat = buildPendingReviewView(raw, null, false, [], state, now);

  expect(flat.sections.map((section) => section.title)).toEqual([
    'Awaiting your review (n=1)',
    'Requested of your team (n=3)',
  ]);

  const rows = queueRows(flat);

  expect(rows.map((row) => [row.ref, row.team])).toEqual([
    ['acme/api#1', undefined],
    ['acme/api#3', 'acme/oncall'],
    ['acme/web#2', 'acme/backend'],
    ['acme/web#6', 'acme/backend'],
  ]);

  expect(rows[1].pending).toEqual({ requestedAt: Date.parse('2026-07-01T00:00:00Z'), snoozed: false });
  expect(rows[2].mentioned).toBe(true);
  expect(snoozeActionOf(rows[1])).toBe('snooze');

  // the reviewed queue leaves a PR alone while your team is asked about it, and lists the team cycle you answered
  expect(queueRows(buildReviewedView(raw, null, false, [], state, now)).map((row) => row.ref)).toEqual(['acme/api#5']);

  // narrowing to a repo and grouping work on the team section like on the others
  const narrowed = buildPendingReviewView(raw, 'acme/web', false, [], state, now);

  expect(narrowed.sections.map((section) => section.title)).toEqual(['Requested of your team (n=2)']);
  expect(queueRows(narrowed).map((row) => row.ref)).toEqual(['acme/web#2', 'acme/web#6']);

  const grouped = buildPendingReviewView(raw, null, true, [], state, now);

  expect(grouped.sections[1].lists.map((list) => list.title)).toEqual(['acme/web (n=2)', 'acme/api (n=1)']);

  /**
   * A snoozed team request folds into the shared snoozed section, keeps
   * its team, and marks itself for the snooze key, and a re-request of
   * the team after the snooze voids it like a direct one would.
   */
  const snoozes = [
    snooze('acme/web#2', '2026-08-02T09:00:00Z', '2026-07-02T00:00:00Z'),
    snooze('acme/api#3', '2026-08-03T09:00:00Z', '2026-06-20T00:00:00Z'),
  ];

  const parked = buildPendingReviewView(raw, null, false, snoozes, state, now);

  expect(parked.sections.map((section) => section.title)).toEqual([
    'Awaiting your review (n=1)',
    'Requested of your team (n=2)',
    'Snoozed (n=1)',
  ]);

  const parkedRows = queueRows(parked);

  expect(parkedRows.at(-1)).toMatchObject({
    ref: 'acme/web#2',
    team: 'acme/backend',
    pending: { requestedAt: Date.parse('2026-07-02T00:00:00Z'), snoozed: true },
  });

  expect(snoozeActionOf(parkedRows.at(-1))).toBe('unsnooze');

  // with only a snoozed team request the section still renders instead of the empty message
  const onlyTeam = rawData({ reviewResults: [teamPendingResult('acme/web', 2, '2026-07-02T00:00:00Z')] });

  expect(buildPendingReviewView(onlyTeam, null, false, snoozes, state, now).sections.map((s) => s.title)).toEqual([
    'Snoozed (n=1)',
  ]);

  /**
   * With the setting off the team requests vanish from the queue, the
   * snoozed section, the alerts, and the picker, and a queue with nothing
   * else shows the empty message.
   */
  const hidden = buildPendingReviewView(raw, null, false, snoozes, state, now, false);

  expect(hidden.sections.map((section) => section.title)).toEqual(['Awaiting your review (n=1)']);

  expect(buildPendingReviewView(onlyTeam, null, false, [], state, now, false).empty).toBe(
    'No PRs are awaiting your review.',
  );

  expect(queueAlerts(onlyTeam, [], state, now)).toEqual({ pending: true, mentions: false });
  expect(queueAlerts(onlyTeam, snoozes, state, now)).toEqual({ pending: false, mentions: false });
  expect(queueAlerts(onlyTeam, [], state, now, false)).toEqual({ pending: false, mentions: false });

  /**
   * The picker counts the team requests apart from the direct ones and
   * folds a snoozed team request into the snoozed count.
   */
  expect(buildPendingRepoOptions(raw, snoozes, now)).toEqual([
    { repo: null, label: 'All repos', detail: '1 PR awaiting your review, 2 requested of your team, 1 snoozed' },
    { repo: 'acme/api', label: 'acme/api', detail: '1 PR awaiting your review, 1 requested of your team' },
    { repo: 'acme/web', label: 'acme/web', detail: '0 PRs awaiting your review, 1 requested of your team, 1 snoozed' },
  ]);

  expect(buildPendingRepoOptions(raw, snoozes, now, false)).toEqual([
    { repo: null, label: 'All repos', detail: '1 PR awaiting your review' },
    { repo: 'acme/api', label: 'acme/api', detail: '1 PR awaiting your review' },
    { repo: 'acme/web', label: 'acme/web', detail: '0 PRs awaiting your review' },
  ]);
});

test('the mentions view lists the inbox in unread, snoozed, and read sections', () => {
  const raw = rawData({
    reviewResults: [
      pendingResult('acme/api', 1, '2026-07-01T00:00:00Z'),
      pendingResult('acme/web', 2, '2026-07-02T00:00:00Z'),
      reviewedResult('acme/api', 3, '2026-07-05T00:00:00Z'),
    ],
    mentions: [
      // api#1 also awaits your review, so its awaiting row carries the badge
      mentionEntry('acme/api', 1, ['2026-07-21T00:00:00Z']),
      // a mention on a PR without a review request, and a closed PR counts too
      mentionEntry('acme/zulu', 4, ['2026-07-22T00:00:00Z'], 'merged'),
      mentionEntry('acme/web', 5, ['2026-07-19T00:00:00Z', '2026-07-24T00:00:00Z']),
      // older than the seed, so it starts out read
      mentionEntry('acme/web', 6, ['2026-07-10T00:00:00Z']),
      // older than the seed too, but marked unread by hand
      mentionEntry('acme/api', 7, ['2026-07-11T00:00:00Z']),
      // marked read by hand
      mentionEntry('acme/api', 8, ['2026-07-23T00:00:00Z']),
      // snoozed
      mentionEntry('acme/web', 9, ['2026-07-25T00:00:00Z']),
      // unreadable during the load, so it stays out until a load reads it
      { ...mentionEntry('acme/api', 10, ['2026-07-26T00:00:00Z']), mentions: null },
    ],
  });

  const now = Date.parse('2026-08-01T12:00:00Z');

  const state = reads('2026-07-20T00:00:00Z', [
    ['acme/api#7', null],
    ['acme/api#8', Date.parse('2026-07-23T00:00:00Z')],
  ]);

  const snoozes = [
    snooze('acme/web#9', '2026-08-02T09:00:00Z', '2026-07-25T00:00:00Z', 'mention'),
    snooze('acme/web#2', '2026-08-01T15:00:00Z', '2026-07-02T00:00:00Z'),
  ];

  /**
   * The inbox lists the unread mentions newest first, then the parked
   * ones soonest wake-up first, and the read ones close the tab. The
   * review queues keep their own rows, the awaiting api#1 with the badge
   * because the PR also mentions you, and the snoozed web#2 without one.
   */
  const flat = buildMentionsView(raw, null, false, snoozes, state, now);

  expect(flat.sections.map((section) => section.title)).toEqual(['Unread (n=4)', 'Snoozed (n=1)', 'Read (n=2)']);

  expect(queueRows(flat).map((row) => row.ref)).toEqual([
    'acme/web#5',
    'acme/zulu#4',
    'acme/api#1',
    'acme/api#7',
    'acme/web#9',
    'acme/api#8',
    'acme/web#6',
  ]);

  const rows = queueRows(flat);

  // the unread rows carry the mark of their mentions, lead with the time since the newest one, and carry no badge of their own
  expect(rows[0].mention).toEqual({
    mark: { at: Date.parse('2026-07-24T00:00:00Z'), ids: ['acme/web#5-0', 'acme/web#5-1'] },
    state: 'unread',
  });

  expect(rows[0].mentioned).toBeUndefined();
  expect(rows[0].pending).toBeUndefined();
  expect(rows[0].lead.trim()).not.toBe('');
  expect(rows[0].lead).not.toContain('until');

  // the snoozed row leads with its wake-up time
  expect(rows[4].mention).toEqual({
    mark: { at: Date.parse('2026-07-25T00:00:00Z'), ids: ['acme/web#9-0'] },
    state: 'snoozed',
  });

  expect(rows[4].lead.trimEnd()).toBe(`until ${formatWakeTime(Date.parse('2026-08-02T09:00:00Z'), now)}`);

  // the read rows carry their mention
  expect(rows[5].mention).toEqual({
    mark: { at: Date.parse('2026-07-23T00:00:00Z'), ids: ['acme/api#8-0'] },
    state: 'read',
  });

  // the snooze key parks an unread mention, unsnoozes a parked one, and skips a read one
  expect(snoozeActionOf(rows[0])).toBe('snooze');
  expect(snoozeActionOf(rows[4])).toBe('unsnooze');
  expect(snoozeActionOf(rows[5])).toBeNull();

  // the read key marks unread and snoozed mentions read and read ones unread
  expect(mentionActionOf(rows[0])).toBe('read');
  expect(mentionActionOf(rows[4])).toBe('read');
  expect(mentionActionOf(rows[5])).toBe('unread');
  expect(mentionActionOf(undefined)).toBeNull();

  expect(unreadMentionRows(flat).map((row) => row.ref)).toEqual([
    'acme/web#5',
    'acme/zulu#4',
    'acme/api#1',
    'acme/api#7',
  ]);

  expect(unreadMentionRows(null)).toEqual([]);

  /**
   * The review queues badge the rows of a PR with an unread mention and
   * nothing else, so a snoozed mention or a read one leaves the badge
   * off, and the read key ignores their rows.
   */
  const pending = buildPendingReviewView(raw, null, false, snoozes, state, now);
  const pendingRows = queueRows(pending);

  expect(pendingRows.map((row) => row.ref)).toEqual(['acme/api#1', 'acme/web#2']);
  expect(pendingRows[0].pending).toEqual({ requestedAt: Date.parse('2026-07-01T00:00:00Z'), snoozed: false });
  expect(pendingRows[0].mentioned).toBe(true);
  expect(pendingRows[0].mention).toBeUndefined();
  expect(pendingRows[1].mentioned).toBeUndefined();
  expect(mentionActionOf(pendingRows[0])).toBeNull();

  const reviewedRows = queueRows(buildReviewedView(raw, null, false, snoozes, state, now));

  expect(reviewedRows.map((row) => [row.ref, row.mentioned])).toEqual([['acme/api#3', undefined]]);

  const withReviewedMention = rawData({
    ...raw,
    mentions: [...(raw.mentions ?? []), mentionEntry('acme/api', 3, ['2026-07-27T00:00:00Z'])],
  });

  expect(queueRows(buildReviewedView(withReviewedMention, null, false, snoozes, state, now))[0].mentioned).toBe(true);

  // narrowing to a repo filters every inbox section
  const narrowed = buildMentionsView(raw, 'acme/web', false, snoozes, state, now);

  expect(narrowed.sections.map((section) => section.title)).toEqual(['Unread (n=1)', 'Snoozed (n=1)', 'Read (n=1)']);
  expect(queueRows(narrowed).map((row) => row.ref)).toEqual(['acme/web#5', 'acme/web#9', 'acme/web#6']);

  // grouping splits every inbox section into per-repo sub-lists
  const grouped = buildMentionsView(raw, null, true, snoozes, state, now);

  expect(grouped.sections[0].rows).toEqual([]);

  expect(grouped.sections[0].lists.map((list) => list.title)).toEqual([
    'acme/api (n=2)',
    'acme/web (n=1)',
    'acme/zulu (n=1)',
  ]);

  expect(grouped.sections[2].lists.map((list) => list.title)).toEqual(['acme/api (n=1)', 'acme/web (n=1)']);
  expect(buildMentionsView(raw, 'acme/web', true, snoozes, state, now)).toEqual(narrowed);

  /**
   * Before the seed lands every mention reads as read, so a session
   * never flashes a full inbox, and data without mentions says how to
   * turn the tracking on.
   */
  const unseeded = buildMentionsView(raw, null, false, snoozes, emptyMentionReads(), now);

  expect(unseeded.sections.map((section) => section.title)).toEqual(['Read (n=7)']);

  expect(buildMentionsView({ ...raw, mentions: null }).empty).toBe(
    'Mention tracking is off. Turn on Track mentions in the settings (S) to list the PRs that mention you.',
  );

  expect(buildMentionsView(rawData({ mentions: [] })).empty).toBe('No PR mentions you.');
  expect(buildMentionsView(raw, 'acme/other', false, snoozes, state, now).empty).toBe('No PR mentions you.');

  /**
   * The picker lists every repo with a mention, most unread first, and
   * counts the snoozed and the read mentions apart from the unread ones.
   */
  expect(buildMentionRepoOptions(raw, snoozes, state, now)).toEqual([
    { repo: null, label: 'All repos', detail: '4 unread mentions, 1 snoozed, 2 read' },
    { repo: 'acme/api', label: 'acme/api', detail: '2 unread mentions, 1 read' },
    { repo: 'acme/web', label: 'acme/web', detail: '1 unread mention, 1 snoozed, 1 read' },
    { repo: 'acme/zulu', label: 'acme/zulu', detail: '1 unread mention' },
  ]);

  /**
   * The sub-tab alerts flag the awaiting queue while a PR awaits your
   * review outside a snooze and the inbox while a mention is unread,
   * across every repo. Snoozing the last awaiting PR or reading the last
   * mention clears the flag, and so does a load without mention data.
   */
  expect(queueAlerts(raw, snoozes, state, now)).toEqual({ pending: true, mentions: true });
  expect(queueAlerts(raw, snoozes, emptyMentionReads(), now)).toEqual({ pending: true, mentions: false });
  expect(queueAlerts({ ...raw, mentions: null }, snoozes, state, now)).toEqual({ pending: true, mentions: false });

  const allSnoozed = [...snoozes, snooze('acme/api#1', '2026-08-02T09:00:00Z', '2026-07-01T00:00:00Z')];

  expect(queueAlerts(raw, allSnoozed, state, now)).toEqual({ pending: false, mentions: true });
  expect(queueAlerts(rawData({}))).toEqual({ pending: false, mentions: false });

  expect(buildMentionRepoOptions(rawData({ mentions: null }))).toEqual([]);

  expect(
    buildMentionRepoOptions(rawData({ mentions: [mentionEntry('acme/api', 1, ['2026-07-21T00:00:00Z'])] })),
  ).toEqual([]);
});

test('the open view narrows to a repo and groups the aggregate by repo', () => {
  const raw = rawData({
    sizes: [
      sizeEntry('acme/web', 1, 'open', '2026-07-02T00:00:00Z'),
      sizeEntry('acme/api', 2, 'open', '2026-07-01T00:00:00Z'),
      sizeEntry('acme/web', 3, 'open', '2026-07-03T00:00:00Z'),
      sizeEntry('acme/web', 4, 'closed', '2026-06-01T00:00:00Z'),
    ],
  });

  const flat = buildOpenAuthoredView(raw);

  expect(flat.sections.map((section) => section.title)).toEqual(['Your open authored PRs (n=3)']);
  expect(flat.sections[0].lists).toEqual([]);
  expect(queueRows(flat).map((row) => row.ref)).toEqual(['acme/api#2', 'acme/web#1', 'acme/web#3']);

  const narrowed = buildOpenAuthoredView(raw, 'acme/web');

  expect(narrowed.sections.map((section) => section.title)).toEqual(['Your open authored PRs (n=2)']);
  expect(queueRows(narrowed).map((row) => row.ref)).toEqual(['acme/web#1', 'acme/web#3']);

  /**
   * Grouping keeps the section and splits its rows into one sub-list per
   * repo, largest first, each staying oldest first. A repo scope ignores
   * the flag, because a single repo has nothing to group.
   */
  const grouped = buildOpenAuthoredView(raw, null, true);

  expect(grouped.sections.map((section) => section.title)).toEqual(['Your open authored PRs (n=3)']);
  expect(grouped.sections[0].rows).toEqual([]);
  expect(grouped.sections[0].lists.map((list) => list.title)).toEqual(['acme/web (n=2)', 'acme/api (n=1)']);
  expect(queueRows(grouped).map((row) => row.ref)).toEqual(['acme/web#1', 'acme/web#3', 'acme/api#2']);

  expect(buildOpenAuthoredView(raw, 'acme/web', true)).toEqual(narrowed);

  expect(buildOpenAuthoredView(raw, 'acme/zulu').empty).toBe('No open authored PRs found.');
});
