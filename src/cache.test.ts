import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearCache, configureCache, PrCache, prKey, readCachedLogin, writeCachedLogin } from './cache';
import { parseCliArgs } from './flags';
import { collectAuthoredPrs, collectReviewPrs, fetchReviewRaw, fetchSizeRaw, resolveUser } from './data';
import { authFingerprint, configureAuth, searchPrs, type PrDetails } from './github';
import { loadSnapshot, saveSnapshot, type RawData } from './tui/data/load';
import { applySavedOptions, readSavedOptions, writeSavedOptions, type OptionsState } from './tui/state/options';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pr-stats-cache-'));
  process.env.PR_STATS_CACHE_DIR = dir;
  configureCache(true);
});

afterEach(() => {
  configureCache(false);
  delete process.env.PR_STATS_CACHE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

test('persists entries across store instances', () => {
  const first = new PrCache<{ x: number }>('roundtrip');

  first.set('acme/api#1', { x: 1 });
  first.save();

  const second = new PrCache<{ x: number }>('roundtrip');

  expect(second.get('acme/api#1')).toEqual({ x: 1 });

  second.delete('acme/api#1');
  second.save();

  expect(new PrCache('roundtrip').has('acme/api#1')).toBe(false);
});

test('never touches disk while disabled', () => {
  configureCache(false);

  const store = new PrCache<{ x: number }>('disabled');

  store.set('acme/api#1', { x: 1 });
  store.save();

  expect(store.get('acme/api#1')).toBeUndefined();
  expect(existsSync(join(dir, 'disabled.json'))).toBe(false);
});

test('clearCache deletes the store files only while enabled', () => {
  const details = new PrCache<{ x: number }>('details');

  details.set('acme/api#1', { x: 1 });
  details.save();

  const sizes = new PrCache<{ y: number }>('sizes');

  sizes.set('acme/api#1', { y: 2 });
  sizes.save();

  configureCache(false);

  expect(clearCache()).toBe(false);
  expect(existsSync(join(dir, 'details.json'))).toBe(true);

  configureCache(true);

  expect(clearCache()).toBe(true);
  expect(existsSync(join(dir, 'details.json'))).toBe(false);
  expect(existsSync(join(dir, 'sizes.json'))).toBe(false);
  expect(new PrCache('details').has('acme/api#1')).toBe(false);
});

const SAVED_OPTIONS: OptionsState = {
  since: '30d',
  repos: 'acme/api, acme/web',
  user: 'someone',
  target: '1d',
  sizeTarget: '400l',
  workHours: '9-17',
  tz: 'Europe/Berlin',
  wallClock: false,
  includeDrafts: true,
};

test('saved options round-trip and lose to explicit flags', () => {
  expect(readSavedOptions()).toBeNull();
  expect(writeSavedOptions(SAVED_OPTIONS)).toBe(true);
  expect(readSavedOptions()).toEqual(SAVED_OPTIONS);

  const { values, explicit } = parseCliArgs(['--since', '7d', '--wall-clock']);

  expect(applySavedOptions(values, explicit)).toEqual(SAVED_OPTIONS);

  // the explicit flags keep their command-line values
  expect(values.since).toBe('7d');
  expect(values['wall-clock']).toBe(true);

  // everything else comes from the save, with the repos list split
  expect(values.repo).toEqual(['acme/api', 'acme/web']);
  expect(values.user).toBe('someone');
  expect(values.target).toBe('1d');
  expect(values['size-target']).toBe('400l');
  expect(values['work-hours']).toBe('9-17');
  expect(values.tz).toBe('Europe/Berlin');
  expect(values['include-drafts']).toBe(true);
});

test('empty saved fields stay unset when merged into the CLI values', () => {
  writeSavedOptions({ ...SAVED_OPTIONS, repos: '', user: '', target: '', sizeTarget: '', tz: '' });

  const { values, explicit } = parseCliArgs([]);

  expect(applySavedOptions(values, explicit)).not.toBeNull();

  expect(values.repo).toEqual([]);
  expect(values.user).toBeUndefined();
  expect(values.target).toBeUndefined();
  expect(values['size-target']).toBeUndefined();
  expect(values.tz).toBeUndefined();
  expect(values['work-hours']).toBe('9-17');
});

test('discards a saved options file that fails the shape or value checks', () => {
  writeSavedOptions({ ...SAVED_OPTIONS, tz: 'Not/AZone' });

  expect(readSavedOptions()).toBeNull();

  writeFileSync(join(dir, 'options.json'), JSON.stringify({ version: 2, value: { since: 42 } }));

  expect(readSavedOptions()).toBeNull();

  configureCache(false);

  expect(writeSavedOptions(SAVED_OPTIONS)).toBe(false);
  expect(readSavedOptions()).toBeNull();
});

test('starts empty on a corrupt or outdated file', () => {
  writeFileSync(join(dir, 'corrupt.json'), 'not json');

  expect(new PrCache('corrupt').has('k')).toBe(false);

  writeFileSync(join(dir, 'outdated.json'), JSON.stringify({ version: 0, entries: { k: 1 } }));

  expect(new PrCache('outdated').has('k')).toBe(false);
});

/**
 * The remaining tests drive the fetch pipeline against the fake gh binary
 * in tui/testdata. Its canned data has five closed and one open review PR
 * and four closed and one open authored PR.
 */
function useFakeGh(): void {
  configureAuth(undefined, `${import.meta.dir}/tui/testdata`);
}

const searchArgs = { user: 'testuser', sinceIso: '2026-06-01', repos: [] as string[], includeDrafts: false };

async function loadReviewPrs() {
  const [requested, reviewed] = await Promise.all([
    searchPrs({ ...searchArgs, mode: 'requested' }),
    searchPrs({ ...searchArgs, mode: 'reviewed' }),
  ]);

  return collectReviewPrs(requested, reviewed);
}

test('serves closed review PRs from the cache and repairs entries on bypass', async () => {
  useFakeGh();

  const prs = await loadReviewPrs();
  const first = await fetchReviewRaw(prs, 'testuser');

  expect(first.cacheHits).toBe(0);

  const second = await fetchReviewRaw(prs, 'testuser');

  expect(second.cacheHits).toBe(5);
  expect(second.results).toEqual(first.results);

  /**
   * Poison the cached entry for a closed PR. The next read must come from
   * the cache, so the PR classifies as inaccessible, which proves reads
   * hit the store. A bypass run then refetches and rewrites the entry.
   */
  const store = new PrCache<PrDetails>('details');

  store.set(prKey('acme/api', 1), { timelineItems: { nodes: [] }, reviews: { nodes: [] } });
  store.save();

  const poisoned = await fetchReviewRaw(prs, 'testuser');

  expect(poisoned.results.find((result) => result.pr.number === 1)?.kind).toBe('inaccessible');

  const bypassed = await fetchReviewRaw(prs, 'testuser', undefined, { bypassCache: true });

  expect(bypassed.cacheHits).toBe(0);
  expect(bypassed.results.find((result) => result.pr.number === 1)?.kind).toBe('reviewed');

  const repaired = await fetchReviewRaw(prs, 'testuser');

  expect(repaired.cacheHits).toBe(5);
  expect(repaired.results.find((result) => result.pr.number === 1)?.kind).toBe('reviewed');
});

test('drops a stale cache entry when a PR shows up open again', async () => {
  useFakeGh();

  const prs = await loadReviewPrs();
  const store = new PrCache<PrDetails>('details');

  // acme/web#3 is open in the canned searches, so this entry is stale
  store.set(prKey('acme/web', 3), { timelineItems: { nodes: [] }, reviews: { nodes: [] } });
  store.save();

  const { results, cacheHits } = await fetchReviewRaw(prs, 'testuser');

  expect(cacheHits).toBe(0);
  expect(results.find((result) => result.pr.number === 3)?.kind).toBe('pending');
  expect(new PrCache('details').has(prKey('acme/web', 3))).toBe(false);
});

test('resolveUser prefers the configured user, then the cached login', async () => {
  useFakeGh();

  const auth = await authFingerprint();

  expect(await resolveUser('someone')).toBe('someone');
  expect(readCachedLogin(auth)).toBeNull();

  expect(await resolveUser('')).toBe('testuser');
  expect(readCachedLogin(auth)).toBe('testuser');

  /**
   * A poisoned cached login proves the next resolve reads the cache
   * instead of asking gh, and a bypass refetches and repairs it.
   */
  writeCachedLogin('cacheduser', auth);

  expect(await resolveUser('')).toBe('cacheduser');
  expect(await resolveUser('', true)).toBe('testuser');
  expect(readCachedLogin(auth)).toBe('testuser');
});

test('a cached login written under other credentials never gets served', async () => {
  useFakeGh();

  writeCachedLogin('previoususer', 'other-fingerprint');

  expect(readCachedLogin(await authFingerprint())).toBeNull();
  expect(await resolveUser('')).toBe('testuser');
});

test('ignores an expired cached login', async () => {
  useFakeGh();

  const auth = await authFingerprint();

  writeFileSync(
    join(dir, 'user.json'),
    JSON.stringify({ version: 2, value: { login: 'stale', auth, cachedAt: '2020-01-01T00:00:00Z' } }),
  );

  expect(readCachedLogin(auth)).toBeNull();
  expect(await resolveUser('')).toBe('testuser');
});

const SNAPSHOT_OPTIONS = { since: '2026-06-01', repos: '', user: '', includeDrafts: false };

const SNAPSHOT_DATA: RawData = {
  user: 'testuser',
  sinceIso: '2026-06-01',
  repos: [],
  reviewResults: [
    {
      kind: 'reviewed',
      pr: {
        repo: 'acme/api',
        number: 1,
        title: 'a',
        url: 'https://example.com/1',
        state: 'closed',
        createdAt: new Date('2026-06-30T10:00:00Z'),
      },
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T15:00:00Z'),
      verdict: 'APPROVED',
    },
    {
      kind: 'pending',
      pr: {
        repo: 'acme/web',
        number: 3,
        title: 'b',
        url: 'https://example.com/3',
        state: 'open',
        createdAt: new Date('2026-08-22T10:00:00Z'),
      },
      requestedAt: new Date('2026-08-23T09:00:00Z'),
    },
    {
      kind: 'unrequested',
      pr: {
        repo: 'acme/api',
        number: 5,
        title: 'c',
        url: 'https://example.com/5',
        state: 'closed',
        createdAt: new Date('2026-07-03T10:00:00Z'),
      },
      reviewedAt: new Date('2026-07-05T12:00:00Z'),
    },
  ],
  sizes: [
    {
      pr: {
        repo: 'acme/api',
        number: 10,
        title: 'd',
        url: 'https://example.com/10',
        state: 'closed',
        createdAt: new Date('2026-06-05T10:00:00Z'),
      },
      files: 2,
      additions: 3,
      deletions: 4,
      total: 7,
      mergedAt: new Date('2026-06-08T10:00:00Z'),
      closedAt: new Date('2026-06-08T10:00:00Z'),
      comments: { discussion: 1, review: 2, total: 3 },
    },
  ],
  authoredTotal: 2,
  searchCapped: false,
  fetchedAt: new Date('2026-08-26T10:00:00Z'),
};

test('snapshot round-trips with revived dates for the same options', () => {
  saveSnapshot(SNAPSHOT_OPTIONS, SNAPSHOT_DATA);

  const loaded = loadSnapshot(SNAPSHOT_OPTIONS);

  expect(loaded).toEqual(SNAPSHOT_DATA);
  expect(loaded?.fetchedAt).toBeInstanceOf(Date);

  expect(loadSnapshot({ ...SNAPSHOT_OPTIONS, user: 'someone' })).toBeNull();
  expect(loadSnapshot({ ...SNAPSHOT_OPTIONS, includeDrafts: true })).toBeNull();

  configureCache(false);

  expect(loadSnapshot(SNAPSHOT_OPTIONS)).toBeNull();
});

test('a snapshot whose unrequested results lack a review time never gets served', () => {
  /**
   * Snapshots written before unrequested results carried the review time
   * would show broken durations in the reviewing queue, so the loader
   * drops them and waits for the background refresh.
   */
  const legacy = {
    ...SNAPSHOT_DATA,
    reviewResults: SNAPSHOT_DATA.reviewResults.map((result) =>
      result.kind === 'unrequested' ? { kind: 'unrequested', pr: result.pr } : result,
    ),
  } as RawData;

  saveSnapshot(SNAPSHOT_OPTIONS, legacy);

  expect(loadSnapshot(SNAPSHOT_OPTIONS)).toBeNull();
});

test('a snapshot whose reviewed results lack a verdict never gets served', () => {
  /**
   * Snapshots written before reviewed results carried the verdict would
   * render an empty verdict gauge, so the loader drops them the same way.
   */
  const legacy = {
    ...SNAPSHOT_DATA,
    reviewResults: SNAPSHOT_DATA.reviewResults.map((result) =>
      result.kind === 'reviewed' ? { ...result, verdict: undefined } : result,
    ),
  } as unknown as RawData;

  saveSnapshot(SNAPSHOT_OPTIONS, legacy);

  expect(loadSnapshot(SNAPSHOT_OPTIONS)).toBeNull();
});

test('snapshot serves a narrower since window by creation date and rejects a wider one', () => {
  saveSnapshot(SNAPSHOT_OPTIONS, SNAPSHOT_DATA);

  const narrowed = loadSnapshot({ ...SNAPSHOT_OPTIONS, since: '2026-07-01' });

  /**
   * The reviewed PR from June and the only sized PR fall out of the July
   * window, while the pending and unrequested PRs stay. The stored data
   * had one inaccessible authored PR (authoredTotal 2 with 1 size), and
   * that delta carries over.
   */
  expect(narrowed?.sinceIso).toBe('2026-07-01');
  expect(narrowed?.reviewResults.map((result) => result.pr.number)).toEqual([3, 5]);
  expect(narrowed?.sizes).toEqual([]);
  expect(narrowed?.authoredTotal).toBe(1);

  expect(loadSnapshot({ ...SNAPSHOT_OPTIONS, since: '2026-05-01' })).toBeNull();
});

test('serves closed authored PRs from the size cache', async () => {
  useFakeGh();

  const prs = collectAuthoredPrs(await searchPrs({ ...searchArgs, mode: 'authored' }));
  const first = await fetchSizeRaw(prs);

  expect(first.cacheHits).toBe(0);
  expect(first.sizes).toHaveLength(5);

  const second = await fetchSizeRaw(prs);

  expect(second.cacheHits).toBe(4);
  expect(second.sizes).toEqual(first.sizes);

  const bypassed = await fetchSizeRaw(prs, undefined, { bypassCache: true });

  expect(bypassed.cacheHits).toBe(0);
  expect(bypassed.sizes).toEqual(first.sizes);
});
