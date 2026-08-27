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
 * Builds a PrDetails timeline from request and review timestamps,
 * all attributed to the given user unless a login is passed explicitly.
 */
function details(requests: string[], reviews: (string | { at: string; login: string })[]): PrDetails {
  return {
    timelineItems: {
      nodes: requests.map((at) => {
        return { createdAt: at, requestedReviewer: { login: 'me' } };
      }),
    },
    reviews: {
      nodes: reviews.map((review) => {
        const { at, login } = typeof review === 'string' ? { at: review, login: 'me' } : review;

        return { author: { login }, submittedAt: at, state: 'APPROVED' };
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
    },
  ]);
});

test('two answered requests yield two reviewed cycles', () => {
  const results = classifyPr(
    pr,
    details(['2026-07-01T09:00:00Z', '2026-07-02T09:00:00Z'], ['2026-07-01T15:00:00Z', '2026-07-02T15:00:00Z']),
    'me',
  );

  expect(results).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T15:00:00Z'),
    },
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-02T09:00:00Z'),
      reviewedAt: new Date('2026-07-02T15:00:00Z'),
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
    },
  ]);
});

test('a review before the first request never answers it', () => {
  expect(classifyPr(pr, details(['2026-07-02T09:00:00Z'], ['2026-07-01T15:00:00Z']), 'me')).toEqual([
    { kind: 'pending', pr, requestedAt: new Date('2026-07-02T09:00:00Z') },
  ]);
});

test('reviews without any personal request classify as unrequested', () => {
  expect(classifyPr(pr, details([], ['2026-07-01T15:00:00Z']), 'me')).toEqual([{ kind: 'unrequested', pr }]);
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
