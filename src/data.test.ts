import { expect, test } from 'bun:test';
import { classifyPr, type ReviewPr } from './data';
import type { PrDetails } from './github';

const pr: ReviewPr = {
  repo: 'acme/api',
  number: 1,
  title: 'a',
  url: 'https://example.com/1',
  state: 'open',
  createdAt: new Date('2026-07-01T00:00:00Z'),
};

/**
 * Builds a PrDetails timeline from request and review timestamps, all
 * attributed to the given user unless a login is passed explicitly,
 * and all approvals unless a state overrides it. The size stays fixed
 * at 120 added and 30 removed lines, so every reviewed cycle carries
 * 150 lines.
 */
function details(requests: string[], reviews: (string | { at: string; login?: string; state?: string })[]): PrDetails {
  return {
    additions: 120,
    deletions: 30,
    timelineItems: {
      nodes: requests.map((at) => {
        return { createdAt: at, requestedReviewer: { login: 'me' } };
      }),
    },
    reviews: {
      nodes: reviews.map((review) => {
        const { at, login = 'me', state = 'APPROVED' } = typeof review === 'string' ? { at: review } : review;

        return { author: { login }, submittedAt: at, state };
      }),
    },
  };
}

test('classifies a single answered request as one reviewed cycle', () => {
  expect(classifyPr(pr, details(['2026-07-01T09:00:00Z'], ['2026-07-01T15:00:00Z']), 'me')).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T15:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
    },
  ]);
});

test('a re-request after a review yields the completed cycle plus a pending one', () => {
  expect(
    classifyPr(pr, details(['2026-07-01T09:00:00Z', '2026-07-02T09:00:00Z'], ['2026-07-01T15:00:00Z']), 'me'),
  ).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T15:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
    },
    { kind: 'pending', pr, requestedAt: new Date('2026-07-02T09:00:00Z') },
  ]);
});

test('a nudge before any review stays inside the first cycle', () => {
  expect(
    classifyPr(pr, details(['2026-07-01T09:00:00Z', '2026-07-02T09:00:00Z'], ['2026-07-03T15:00:00Z']), 'me'),
  ).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-03T15:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
    },
  ]);
});

test('two answered requests yield two reviewed cycles, each with its own verdict', () => {
  const results = classifyPr(
    pr,
    details(
      ['2026-07-01T09:00:00Z', '2026-07-02T09:00:00Z'],
      [{ at: '2026-07-01T15:00:00Z', state: 'CHANGES_REQUESTED' }, '2026-07-02T15:00:00Z'],
    ),
    'me',
  );

  expect(results).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T15:00:00Z'),
      verdict: 'CHANGES_REQUESTED',
      lines: 150,
    },
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-02T09:00:00Z'),
      reviewedAt: new Date('2026-07-02T15:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
    },
  ]);
});

test('a review at the exact request timestamp closes that cycle', () => {
  expect(classifyPr(pr, details(['2026-07-01T09:00:00Z'], ['2026-07-01T09:00:00Z']), 'me')).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T09:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
    },
  ]);
});

test('a review before the first request never answers it', () => {
  expect(classifyPr(pr, details(['2026-07-02T09:00:00Z'], ['2026-07-01T15:00:00Z']), 'me')).toEqual([
    { kind: 'pending', pr, requestedAt: new Date('2026-07-02T09:00:00Z') },
  ]);
});

test('reviews without any personal request classify as unrequested with the latest review time', () => {
  expect(classifyPr(pr, details([], ['2026-07-03T09:00:00Z', '2026-07-01T15:00:00Z']), 'me')).toEqual([
    { kind: 'unrequested', pr, reviewedAt: new Date('2026-07-03T09:00:00Z') },
  ]);
});

test('other people on the timeline never count toward your cycles', () => {
  const timeline = details(['2026-07-01T09:00:00Z'], [{ at: '2026-07-01T15:00:00Z', login: 'someoneelse' }]);

  expect(classifyPr(pr, timeline, 'me')).toEqual([
    { kind: 'pending', pr, requestedAt: new Date('2026-07-01T09:00:00Z') },
  ]);
});

test('missing details classify as inaccessible', () => {
  expect(classifyPr(pr, null, 'me')).toEqual([{ kind: 'inaccessible', pr }]);
});

test('an uncounted review never closes a cycle, the next counted one does', () => {
  const timeline = details(
    ['2026-07-01T09:00:00Z'],
    [{ at: '2026-07-01T15:00:00Z', state: 'COMMENTED' }, '2026-07-02T15:00:00Z'],
  );

  expect(classifyPr(pr, timeline, 'me', new Set(['APPROVED']))).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-02T15:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
    },
  ]);
});

test('a request answered only by an uncounted review stays pending', () => {
  const timeline = details(['2026-07-01T09:00:00Z'], [{ at: '2026-07-01T15:00:00Z', state: 'COMMENTED' }]);

  expect(classifyPr(pr, timeline, 'me', new Set(['APPROVED', 'CHANGES_REQUESTED']))).toEqual([
    { kind: 'pending', pr, requestedAt: new Date('2026-07-01T09:00:00Z') },
  ]);
});

test('a PR with only uncounted reviews and no request drops out entirely', () => {
  const timeline = details([], [{ at: '2026-07-01T15:00:00Z', state: 'COMMENTED' }]);

  expect(classifyPr(pr, timeline, 'me', new Set(['APPROVED']))).toEqual([{ kind: 'inaccessible', pr }]);
});

test('without a configured set every submitted review state counts', () => {
  const timeline = details(['2026-07-01T09:00:00Z'], [{ at: '2026-07-01T15:00:00Z', state: 'COMMENTED' }]);

  expect(classifyPr(pr, timeline, 'me')).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T15:00:00Z'),
      verdict: 'COMMENTED',
      lines: 150,
    },
  ]);
});
