import { expect, test } from 'bun:test';
import {
  computeCommentStats,
  computeFirstReviewStats,
  computeMergeStats,
  computeReviewerStats,
  computeReviewStats,
} from './compute';
import type { PrReview, ReviewResult, SizeEntry } from './data';

/**
 * Builds a size entry with the given comment counts and review authors
 * and a fixed size, so the tests only vary what the comment and reviewer
 * stats read. The reviews carry no submission time, which the reviewer
 * and comment stats never read.
 */
function entry(number: number, discussion: number, review: number, reviewers: string[] = []): SizeEntry {
  return {
    pr: {
      repo: 'acme/api',
      number,
      title: `pr ${number}`,
      url: `https://example.com/${number}`,
      state: 'closed',
      createdAt: new Date('2026-07-01T00:00:00Z'),
    },
    files: 1,
    additions: 10,
    deletions: 5,
    total: 15,
    mergedAt: null,
    closedAt: new Date('2026-07-02T00:00:00Z'),
    comments: { discussion, review, total: discussion + review },
    reviews: reviewers.map((login) => {
      return { login, submittedAt: null };
    }),
  };
}

test('splits the comment metrics by kind and keeps the input order', () => {
  const stats = computeCommentStats([entry(1, 1, 2), entry(2, 0, 0), entry(3, 4, 12)]);

  expect(stats.metrics).toEqual([
    { label: 'discussion comments', values: [1, 0, 4] },
    { label: 'review comments', values: [2, 0, 12] },
    { label: 'all comments', values: [3, 0, 16] },
  ]);

  expect(stats.totals).toEqual([3, 0, 16]);
});

test('counts the PRs without comments and ranks the commented ones', () => {
  const stats = computeCommentStats([entry(1, 1, 2), entry(2, 0, 0), entry(3, 4, 12), entry(4, 0, 3)]);

  expect(stats.uncommented).toBe(1);
  expect(stats.top.map((size) => size.pr.number)).toEqual([3, 1, 4]);
});

test('ties in the ranking keep the input order', () => {
  const stats = computeCommentStats([entry(1, 2, 1), entry(2, 0, 3), entry(3, 16, 0)]);

  expect(stats.top.map((size) => size.pr.number)).toEqual([3, 1, 2]);
});

/**
 * The merge-stat dates stay on the Wednesday and Thursday after the
 * helper's creation date, so the durations come out the same in every
 * time mode a previously run test may have left configured.
 */
test('splits the PRs by outcome and derives the merge durations, most recent first', () => {
  const merged1 = { ...entry(1, 0, 0), mergedAt: new Date('2026-07-02T12:00:00Z') };
  const merged2 = { ...entry(2, 0, 0), mergedAt: new Date('2026-07-01T06:00:00Z') };
  const closed = entry(3, 0, 0);
  const open = { ...entry(4, 0, 0), pr: { ...entry(4, 0, 0).pr, state: 'open' }, closedAt: null };

  const stats = computeMergeStats([closed, merged2, open, merged1]);

  expect(stats.merged.map((result) => result.entry.pr.number)).toEqual([1, 2]);
  expect(stats.allHours).toEqual([36, 6]);
  expect(stats.closed.map((result) => result.entry.pr.number)).toEqual([3]);
  expect(stats.closed[0].hours).toBe(24);
  expect(stats.open.map((size) => size.pr.number)).toEqual([4]);
});

test('a reopened PR counts as open even though it still carries its old close time', () => {
  const reopened = { ...entry(5, 0, 0), pr: { ...entry(5, 0, 0).pr, state: 'open' } };

  const stats = computeMergeStats([reopened]);

  expect(stats.open.map((size) => size.pr.number)).toEqual([5]);
  expect(stats.closed).toEqual([]);
  expect(stats.merged).toEqual([]);
});

test('counts distinct PRs and review rounds per reviewer and excludes the author', () => {
  const stats = computeReviewerStats(
    [entry(1, 0, 0, ['alice', 'me', 'alice']), entry(2, 0, 0, ['bob']), entry(3, 0, 0, ['alice'])],
    'me',
  );

  expect(stats.leaderboard).toEqual([
    { login: 'alice', prs: 2, reviews: 3 },
    { login: 'bob', prs: 1, reviews: 1 },
  ]);
});

test('ties on the leaderboard break on review rounds and then on the login', () => {
  const stats = computeReviewerStats([entry(1, 0, 0, ['carol', 'carol', 'bob']), entry(2, 0, 0, ['bob', 'ann'])], 'me');

  expect(stats.leaderboard.map((row) => row.login)).toEqual(['bob', 'carol', 'ann']);
});

test('splits the merged PRs by review coverage, where self-replies never count', () => {
  const mergedAt = new Date('2026-07-02T00:00:00Z');
  const reviewedMerge = { ...entry(1, 0, 0, ['alice']), mergedAt };
  const selfReviewedMerge = { ...entry(2, 0, 0, ['me']), mergedAt };
  const silentMerge = { ...entry(3, 0, 0), mergedAt };
  const reviewedClose = entry(4, 0, 0, ['alice']);

  const stats = computeReviewerStats([reviewedMerge, selfReviewedMerge, silentMerge, reviewedClose], 'me');

  expect(stats.mergedReviewed).toBe(1);
  expect(stats.mergedUnreviewed).toBe(2);

  /**
   * The closed PR stays out of the coverage but its review still counts
   * on the leaderboard.
   */
  expect(stats.leaderboard).toEqual([{ login: 'alice', prs: 2, reviews: 2 }]);
});

/**
 * Builds a size entry with the given reviews, state, and creation date,
 * so the first-review tests only vary who reviewed and when. The dates
 * stay on the Wednesday and Thursday the other helpers use, so the
 * durations come out the same in every time mode.
 */
function reviewedEntry(
  number: number,
  reviews: PrReview[],
  state = 'closed',
  createdAt = '2026-07-01T00:00:00Z',
): SizeEntry {
  const base = entry(number, 0, 0);

  return {
    ...base,
    pr: { ...base.pr, state, createdAt: new Date(createdAt) },
    closedAt: state === 'open' ? null : base.closedAt,
    reviews,
  };
}

test('finds the first review from someone else and skips the author and deleted accounts', () => {
  const stats = computeFirstReviewStats(
    [
      reviewedEntry(1, [
        { login: 'me', submittedAt: new Date('2026-07-01T01:00:00Z') },
        { login: null, submittedAt: new Date('2026-07-01T02:00:00Z') },
        { login: 'bob', submittedAt: new Date('2026-07-02T00:00:00Z') },
        { login: 'alice', submittedAt: new Date('2026-07-01T06:00:00Z') },
      ]),
    ],
    'me',
  );

  expect(stats.received).toHaveLength(1);
  expect(stats.received[0].reviewedAt).toEqual(new Date('2026-07-01T06:00:00Z'));
  expect(stats.allHours).toEqual([6]);
  expect(stats.awaiting).toEqual([]);
});

test('open PRs without a counted review wait, longest first, and closed ones stay out', () => {
  const now = new Date('2026-07-02T00:00:00Z');

  const stats = computeFirstReviewStats(
    [
      reviewedEntry(2, [{ login: 'alice', submittedAt: null }], 'open', '2026-07-01T12:00:00Z'),
      reviewedEntry(1, [{ login: 'me', submittedAt: new Date('2026-07-01T01:00:00Z') }], 'open'),
      reviewedEntry(3, []),
    ],
    'me',
    { now },
  );

  expect(stats.received).toEqual([]);
  expect(stats.awaiting.map((result) => result.entry.pr.number)).toEqual([1, 2]);
  expect(stats.awaiting.map((result) => result.hours)).toEqual([24, 12]);
});

/**
 * Builds one completed review cycle on the given PR with the given
 * verdict, so the cycle and verdict tests can vary just those two.
 * The PR size derives from the number, so the size pass-through is
 * visible per PR.
 */
function reviewedResult(number: number, verdict: string): ReviewResult {
  return {
    kind: 'reviewed',
    pr: {
      repo: 'acme/api',
      number,
      title: `pr ${number}`,
      url: `https://example.com/${number}`,
      state: 'closed',
      createdAt: new Date('2026-07-01T00:00:00Z'),
    },
    requestedAt: new Date('2026-07-01T09:00:00Z'),
    reviewedAt: new Date('2026-07-01T15:00:00Z'),
    verdict,
    lines: number * 100,
  };
}

test('counts the completed cycles per PR and carries the verdicts and sizes through', () => {
  const stats = computeReviewStats([
    reviewedResult(1, 'CHANGES_REQUESTED'),
    reviewedResult(1, 'APPROVED'),
    reviewedResult(2, 'COMMENTED'),
  ]);

  expect(stats.cycles).toEqual([2, 1]);
  expect(stats.reviewed.map((entry) => entry.verdict)).toEqual(['CHANGES_REQUESTED', 'APPROVED', 'COMMENTED']);
  expect(stats.reviewed.map((entry) => entry.lines)).toEqual([100, 100, 200]);
});
