import { expect, test } from 'bun:test';
import { computeCommentStats, computeMergeStats, computeReviewStats } from './compute';
import type { ReviewResult, SizeEntry } from './data';

/**
 * Builds a size entry with the given comment counts and a fixed size, so
 * the tests only vary what the comment stats read.
 */
function entry(number: number, discussion: number, review: number): SizeEntry {
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

/**
 * Builds one completed review cycle on the given PR with the given
 * verdict, so the cycle and verdict tests can vary just those two.
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
  };
}

test('counts the completed cycles per PR and carries the verdicts through', () => {
  const stats = computeReviewStats([
    reviewedResult(1, 'CHANGES_REQUESTED'),
    reviewedResult(1, 'APPROVED'),
    reviewedResult(2, 'COMMENTED'),
  ]);

  expect(stats.cycles).toEqual([2, 1]);
  expect(stats.reviewed.map((entry) => entry.verdict)).toEqual(['CHANGES_REQUESTED', 'APPROVED', 'COMMENTED']);
});
