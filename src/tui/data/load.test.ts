import { afterEach, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { configureCache } from '../../cache';
import { configureAuth } from '../../github';
import { loadData } from './load';

/**
 * The load runs against the fake gh in testdata with the cache off, so
 * nothing reads or writes the real cache directory. The fake adds an old
 * PR with a fresh request only while PR_STATS_TEST_OLD_REQUEST is set,
 * which the gh child inherits from this process.
 */
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

  /**
   * The PR api#30 was created before the window, so only the request
   * search finds it. Its first cycle, reviewed back then, stays out of
   * the results the statistics read, and the open request it got since
   * puts it in the awaiting queue.
   */
  const old = raw.reviewResults.filter((result) => result.pr.repo === 'acme/api' && result.pr.number === 30);

  expect(old.map((result) => result.kind)).toEqual(['pending']);
  expect(old[0]).toMatchObject({ kind: 'pending', requestedAt: new Date('2026-08-27T09:00:00Z') });

  // the PRs both searches return still classify in full, with their reviewed cycles
  expect(raw.reviewResults.some((result) => result.pr.number === 1 && result.kind === 'reviewed')).toBe(true);
});
