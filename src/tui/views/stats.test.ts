import { expect, test } from 'bun:test';
import type { RawData, ReviewResult } from '../data/load';
import type { Line } from './charts/model';
import { buildReviewRepoOptions } from './repos';
import { buildReviewView, type StatsView } from './stats';

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

function unrequestedResult(repo: string, number: number, reviewedAt: string): ReviewResult {
  return { kind: 'unrequested', pr: pr(repo, number), reviewedAt: new Date(reviewedAt) };
}

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

function cellText(line: Line): string {
  return line.map((span) => span.text).join('');
}

function titles(view: StatsView): string[] {
  return view.cards.map((card) => card.title);
}

test('the review strip counts the distinct PRs apart from the review rounds they took', () => {
  const raw = rawData([
    reviewedResult('acme/api', 1, '2026-07-02T00:00:00Z'),
    reviewedResult('acme/api', 1, '2026-07-06T00:00:00Z'),
    reviewedResult('acme/api', 2, '2026-07-03T00:00:00Z'),
    reviewedResult('acme/web', 3, '2026-07-03T00:00:00Z'),
    unrequestedResult('acme/web', 4, '2026-07-04T00:00:00Z'),
  ]);

  expect(buildReviewView(raw, undefined).strip.map((line) => cellText(line))).toEqual([
    '3 PRs reviewed',
    '4 review rounds',
    '0 awaiting you',
    '0 closed unreviewed',
    '1 reviewed unasked (excluded)',
  ]);

  expect(
    buildReviewView(raw, undefined, 'acme/api')
      .strip.slice(0, 2)
      .map((line) => cellText(line)),
  ).toEqual(['2 PRs reviewed', '3 review rounds']);
});

test('an owner scope keeps the reviews of that owner and still compares its repos', () => {
  const raw = rawData([
    reviewedResult('stackblitz/bolt', 1, '2026-07-02T00:00:00Z'),
    reviewedResult('stackblitz/webcontainer', 2, '2026-07-03T00:00:00Z'),
    reviewedResult('acme/web', 3, '2026-07-03T00:00:00Z'),
  ]);

  const owner = buildReviewView(raw, undefined, 'stackblitz/*');

  expect(cellText(owner.strip[0])).toBe('2 PRs reviewed');
  expect(titles(owner)).toContain('Review time by repo');
  expect(titles(buildReviewView(raw, undefined, 'stackblitz/bolt'))).not.toContain('Review time by repo');
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

  expect(
    buildReviewView(rawData([reviewedResult('acme/api', 1, '2026-07-02T00:00:00Z')]), undefined).strip,
  ).toHaveLength(5);

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
