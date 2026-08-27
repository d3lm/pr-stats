import { expect, test } from 'bun:test';
import { computeCommentStats } from './compute';
import type { SizeEntry } from './data';

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
