import { expect, test } from 'bun:test';
import type { RawData, ReviewResult, SizeEntry } from '../data/load';
import { buildOpenAuthoredView, buildPendingReviewView, queueRows } from './queue';
import { buildOpenRepoOptions, buildPendingRepoOptions } from './repos';

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
    comments: { discussion: 0, review: 0, total: 0 },
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
       * A closed pending request and a reviewed PR stay out of the queue
       * counts, but their repos stay on the list, so the picker matches
       * the review tab's.
       */
      pendingResult('acme/zulu', 4, '2026-07-04T00:00:00Z', 'closed'),
      {
        kind: 'reviewed',
        pr: pr('acme/zulu', 5, 'closed'),
        requestedAt: new Date('2026-07-01T00:00:00Z'),
        reviewedAt: new Date('2026-07-02T00:00:00Z'),
      },
    ],
  });

  expect(buildPendingRepoOptions(raw)).toEqual([
    { repo: null, label: 'All repos', detail: '3 PRs awaiting your review' },
    { repo: 'acme/api', label: 'acme/api', detail: '2 PRs awaiting your review' },
    { repo: 'acme/web', label: 'acme/web', detail: '1 PR awaiting your review' },
    { repo: 'acme/zulu', label: 'acme/zulu', detail: '0 PRs awaiting your review' },
  ]);

  expect(
    buildPendingRepoOptions(rawData({ reviewResults: [pendingResult('acme/api', 1, '2026-07-01T00:00:00Z')] })),
  ).toEqual([]);
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

  expect(flat.lists.map((list) => list.title)).toEqual(['Open and awaiting your review (n=3)']);
  expect(queueRows(flat).map((row) => row.ref)).toEqual(['acme/api#2', 'acme/web#1', 'acme/api#3']);

  const narrowed = buildPendingReviewView(raw, 'acme/api');

  expect(narrowed.lists.map((list) => list.title)).toEqual(['Open and awaiting your review (n=2)']);
  expect(queueRows(narrowed).map((row) => row.ref)).toEqual(['acme/api#2', 'acme/api#3']);

  /**
   * Grouping splits the aggregate into one list per repo, largest first,
   * and each group keeps the longest wait on top. A repo scope ignores
   * the flag, because a single repo has nothing to group.
   */
  const grouped = buildPendingReviewView(raw, null, true);

  expect(grouped.lists.map((list) => list.title)).toEqual(['acme/api (n=2)', 'acme/web (n=1)']);
  expect(queueRows(grouped).map((row) => row.ref)).toEqual(['acme/api#2', 'acme/api#3', 'acme/web#1']);

  expect(buildPendingReviewView(raw, 'acme/api', true)).toEqual(narrowed);

  expect(buildPendingReviewView(rawData({}), null, true).empty).toBe('No PRs are awaiting your review.');
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

  expect(flat.lists.map((list) => list.title)).toEqual(['Your open authored PRs (n=3)']);
  expect(queueRows(flat).map((row) => row.ref)).toEqual(['acme/api#2', 'acme/web#1', 'acme/web#3']);

  const narrowed = buildOpenAuthoredView(raw, 'acme/web');

  expect(narrowed.lists.map((list) => list.title)).toEqual(['Your open authored PRs (n=2)']);
  expect(queueRows(narrowed).map((row) => row.ref)).toEqual(['acme/web#1', 'acme/web#3']);

  /**
   * Grouping splits the aggregate into one list per repo, largest first,
   * and each group stays oldest first. A repo scope ignores the flag,
   * because a single repo has nothing to group.
   */
  const grouped = buildOpenAuthoredView(raw, null, true);

  expect(grouped.lists.map((list) => list.title)).toEqual(['acme/web (n=2)', 'acme/api (n=1)']);
  expect(queueRows(grouped).map((row) => row.ref)).toEqual(['acme/web#1', 'acme/web#3', 'acme/api#2']);

  expect(buildOpenAuthoredView(raw, 'acme/web', true)).toEqual(narrowed);

  expect(buildOpenAuthoredView(raw, 'acme/zulu').empty).toBe('No open authored PRs found.');
});
