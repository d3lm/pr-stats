import { expect, test } from 'bun:test';
import type { RawData, ReviewResult } from '../data/load';
import type { Line } from './charts/model';
import { buildReviewRepoOptions } from './repos';
import { buildReviewView } from './stats';

/**
 * Builds the PR descriptor shared by the review results.
 */
function pr(repo: string, number: number) {
  return {
    repo,
    number,
    title: `pr ${number}`,
    url: `https://example.com/${repo}/${number}`,
    state: 'closed',
    createdAt: new Date('2026-07-01T00:00:00Z'),
  };
}

/**
 * Builds a reviewed result, a completed request-review cycle
 * answered at the given time.
 */
function reviewedResult(repo: string, number: number, reviewedAt: string): ReviewResult {
  return {
    kind: 'reviewed',
    pr: pr(repo, number),
    requestedAt: new Date('2026-06-15T00:00:00Z'),
    reviewedAt: new Date(reviewedAt),
    verdict: 'APPROVED',
    lines: 15,
  };
}

/**
 * Builds an unrequested result, a review you gave at the given
 * time without a personal request.
 */
function unrequestedResult(repo: string, number: number, reviewedAt: string): ReviewResult {
  return { kind: 'unrequested', pr: pr(repo, number), reviewedAt: new Date(reviewedAt) };
}

/**
 * Builds raw data around the given results.
 */
function rawData(reviewResults: ReviewResult[]): RawData {
  return {
    user: 'testuser',
    sinceIso: '2026-06-01',
    repos: [],
    reviewResults,
    sizes: [],
    authoredTotal: 0,
    mentions: null,
    searchCapped: false,
    fetchedAt: new Date('2026-08-01T00:00:00Z'),
  };
}

/**
 * Flattens one strip cell into its plain text.
 */
function cellText(line: Line): string {
  return line.map((span) => span.text).join('');
}

test('the review strip counts the distinct PRs apart from the review rounds they took', () => {
  const raw = rawData([
    // a PR that came back to you for a second round counts once as a PR and twice as a round
    reviewedResult('acme/api', 1, '2026-07-02T00:00:00Z'),
    reviewedResult('acme/api', 1, '2026-07-06T00:00:00Z'),
    reviewedResult('acme/api', 2, '2026-07-03T00:00:00Z'),
    reviewedResult('acme/web', 3, '2026-07-03T00:00:00Z'),
    // a review without a personal request stays out of both counts
    unrequestedResult('acme/web', 4, '2026-07-04T00:00:00Z'),
  ]);

  expect(buildReviewView(raw, undefined).strip.map((line) => cellText(line))).toEqual([
    '3 PRs reviewed',
    '4 review rounds',
    '0 awaiting you',
    '0 closed unreviewed',
    '1 reviewed unasked (excluded)',
  ]);

  // narrowing to a repo keeps the two counts apart
  expect(
    buildReviewView(raw, undefined, 'acme/api')
      .strip.slice(0, 2)
      .map((line) => cellText(line)),
  ).toEqual(['2 PRs reviewed', '3 review rounds']);
});

test('the review tab leaves the team cycles out until the team stats setting folds them in', () => {
  const raw = rawData([
    reviewedResult('acme/api', 1, '2026-07-02T00:00:00Z'),
    reviewedResult('acme/web', 2, '2026-07-03T00:00:00Z'),
    {
      kind: 'team-reviewed',
      pr: pr('acme/web', 3),
      requestedAt: new Date('2026-06-15T00:00:00Z'),
      reviewedAt: new Date('2026-07-04T00:00:00Z'),
      verdict: 'CHANGES_REQUESTED',
      lines: 40,
      team: 'acme/backend',
    },
    {
      kind: 'team-pending',
      pr: { ...pr('acme/web', 4), state: 'open' },
      requestedAt: new Date('2026-07-20T00:00:00Z'),
      team: 'acme/backend',
    },
  ]);

  /**
   * By default the strip reports the team reviews as excluded next to
   * the unasked ones, the open team request stays out of the awaiting
   * count, and the headline counts the direct cycles alone.
   */
  const excluded = buildReviewView(raw, undefined);

  expect(excluded.strip.map((line) => cellText(line))).toEqual([
    '2 PRs reviewed',
    '2 review rounds',
    '0 awaiting you',
    '0 closed unreviewed',
    '0 reviewed unasked (excluded)',
    '1 team review (excluded)',
  ]);

  expect(excluded.headline?.map((span) => span.text).join('')).toContain('2 of 2 reviews');

  // the team cell only shows while there is something to leave out
  expect(
    buildReviewView(rawData([reviewedResult('acme/api', 1, '2026-07-02T00:00:00Z')]), undefined).strip,
  ).toHaveLength(5);

  /**
   * With the setting on the team cycles join every count and the
   * headline denominator, so a scope never reads as more reviews than
   * the whole, and the excluded cell goes away.
   */
  const included = buildReviewView(raw, undefined, null, 100, false, true);

  expect(included.strip.map((line) => cellText(line))).toEqual([
    '3 PRs reviewed',
    '3 review rounds',
    '1 awaiting you',
    '0 closed unreviewed',
    '0 reviewed unasked (excluded)',
  ]);

  expect(included.headline?.map((span) => span.text).join('')).toContain('3 of 3 reviews');

  expect(
    buildReviewView(raw, undefined, 'acme/web', 100, false, true)
      .headline?.map((span) => span.text)
      .join(''),
  ).toContain('2 of 3 reviews');

  // the picker follows the setting the same way
  expect(buildReviewRepoOptions(raw).map((option) => option.detail)).toEqual([
    '2 reviewed',
    '1 reviewed',
    '1 reviewed',
  ]);

  expect(buildReviewRepoOptions(raw, true).map((option) => [option.label, option.detail])).toEqual([
    ['All repos', '3 reviewed, 1 pending'],
    ['acme/web', '2 reviewed, 1 pending'],
    ['acme/api', '1 reviewed'],
  ]);
});
