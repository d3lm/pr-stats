import { expect, test } from 'bun:test';
import {
  computeCommentStats,
  computeFirstReviewStats,
  computeMergeStats,
  computeReviewerStats,
  computeReviewStats,
  latestReviews,
  teamPendingRequests,
} from './compute';
import type { PrReview, ReviewResult, SizeEntry } from './data';

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

// the dates stay on weekdays, so the durations match in any time mode an earlier test left configured
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

  expect(stats.leaderboard).toEqual([{ login: 'alice', prs: 2, reviews: 2 }]);
});

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

function teamResult(number: number, requestedAt: string, reviewedAt: string | null, state = 'open'): ReviewResult {
  const pr = {
    repo: 'acme/api',
    number,
    title: `pr ${number}`,
    url: `https://example.com/${number}`,
    state,
    createdAt: new Date('2026-07-01T00:00:00Z'),
  };

  if (reviewedAt === null) {
    return { kind: 'team-pending', pr, requestedAt: new Date(requestedAt), team: 'acme/backend' };
  }

  return {
    kind: 'team-reviewed',
    pr,
    requestedAt: new Date(requestedAt),
    reviewedAt: new Date(reviewedAt),
    verdict: 'APPROVED',
    lines: 300,
    team: 'acme/backend',
  };
}

test('the team cycles stand apart until the includeTeam flag folds them into the review stats', () => {
  const now = new Date('2026-07-03T00:00:00Z');

  const results = [
    reviewedResult(1, 'APPROVED'),
    teamResult(2, '2026-07-01T09:00:00Z', '2026-07-01T11:00:00Z'),
    teamResult(3, '2026-07-02T00:00:00Z', null),
    teamResult(4, '2026-07-01T00:00:00Z', null, 'closed'),
    {
      kind: 'pending',
      pr: { ...reviewedResult(5, 'APPROVED').pr, state: 'open' },
      requestedAt: new Date('2026-07-02T12:00:00Z'),
    },
  ] satisfies ReviewResult[];

  const apart = computeReviewStats(results, { now });

  expect(apart.reviewed.map((entry) => entry.pr.number)).toEqual([1]);
  expect(apart.pending.map((entry) => entry.pr.number)).toEqual([5]);
  expect(apart.expired).toEqual([]);
  expect(apart.cycles).toEqual([1]);
  expect(apart.teamReviewed.map((entry) => [entry.pr.number, entry.hours])).toEqual([[2, 2]]);

  expect(apart.teamPending.map((entry) => [entry.pr.number, entry.team, entry.hours])).toEqual([
    [3, 'acme/backend', 24],
  ]);

  const folded = computeReviewStats(results, { now, includeTeam: true });

  expect(folded.reviewed.map((entry) => entry.pr.number)).toEqual([1, 2]);
  expect(folded.allHours).toEqual([6, 2]);
  expect(folded.pending.map((entry) => entry.pr.number)).toEqual([3, 5]);
  expect(folded.expired.map((result) => result.pr.number)).toEqual([4]);
  expect(folded.cycles).toEqual([1, 1]);
  expect(folded.teamReviewed).toEqual(apart.teamReviewed);
  expect(folded.teamPending).toEqual(apart.teamPending);

  expect(teamPendingRequests(results).map((entry) => entry.pr.number)).toEqual([3]);

  expect(latestReviews(results).map((entry) => entry.pr.number)).toEqual([2]);

  expect(
    latestReviews([...results, teamResult(2, '2026-07-02T09:00:00Z', null)]).map((entry) => entry.pr.number),
  ).toEqual([]);
});
