import { afterEach, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { configureCache } from '../../cache';
import { configureAuth } from '../../github';
import { loadData } from './load';

beforeEach(() => {
  configureCache(false);
  configureAuth(undefined, join(import.meta.dir, '..', 'testdata'));

  process.env.PR_STATS_TEST_OLD_REQUEST = '1';
});

afterEach(() => {
  delete process.env.PR_STATS_TEST_OLD_REQUEST;
});

const params = { since: '2026-06-01', repos: '', user: '', includeDrafts: false, reviewTypes: '' };

test('a request on a PR older than the window reaches the queue without its earlier cycles', async () => {
  const raw = await loadData(params, () => {}, { bypassCache: true });

  const old = raw.reviewResults.filter((result) => result.pr.repo === 'acme/api' && result.pr.number === 30);

  expect(old.map((result) => result.kind)).toEqual(['pending']);
  expect(old[0]).toMatchObject({ kind: 'pending', requestedAt: new Date('2026-08-27T09:00:00Z') });

  expect(raw.reviewResults.some((result) => result.pr.number === 1 && result.kind === 'reviewed')).toBe(true);
});
