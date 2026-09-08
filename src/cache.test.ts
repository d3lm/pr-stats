import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cacheSize,
  clearCache,
  configureCache,
  PrCache,
  prKey,
  readCachedLogin,
  readCachedTeams,
  writeCachedLogin,
  writeCachedTeams,
} from './cache';
import {
  collectAuthoredPrs,
  collectMentionedPrs,
  collectReviewPrs,
  fetchMentionsRaw,
  fetchReviewRaw,
  fetchSizeRaw,
  resolveTeams,
  resolveUser,
} from './data';
import { parseCliArgs } from './flags';
import { authFingerprint, configureAuth, searchPrs, type PrDetails } from './github';
import { loadSnapshot, saveSnapshot, type RawData } from './tui/data/load';
import { loadMentionBaseline, saveMentionBaseline } from './tui/data/notifications';
import { applySavedOptions, readSavedOptions, writeSavedOptions, type OptionsState } from './tui/state/options';
import { formatBytes } from './utils';

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

test('cacheSize sums the files in the cache directory and survives a missing one', () => {
  // the temp directory starts empty
  expect(cacheSize()).toBe(0);

  writeFileSync(join(dir, 'details.json'), 'x'.repeat(1500));
  writeFileSync(join(dir, 'settings.json'), 'y'.repeat(48));
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'nested', 'ignored.json'), 'z'.repeat(4096));

  // only the direct files count, and the settings file counts like the data
  expect(cacheSize()).toBe(1548);

  // a clear takes the data file out of the sum and leaves the settings in
  clearCache();

  expect(cacheSize()).toBe(48);

  // the size reads the disk whether or not the cache is enabled
  configureCache(false);

  expect(cacheSize()).toBe(48);

  rmSync(dir, { recursive: true, force: true });

  expect(cacheSize()).toBe(0);
});

test('formatBytes picks a binary unit and keeps the text short', () => {
  expect(formatBytes(0)).toBe('0 B');
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(1023)).toBe('1023 B');
  expect(formatBytes(1024)).toBe('1.0 KiB');
  expect(formatBytes(1536)).toBe('1.5 KiB');
  expect(formatBytes(10 * 1024)).toBe('10 KiB');
  expect(formatBytes(700 * 1024 + 700)).toBe('701 KiB');
  expect(formatBytes(1024 * 1024 - 1)).toBe('1.0 MiB');
  expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MiB');
  expect(formatBytes(12.6 * 1024 * 1024)).toBe('13 MiB');
  expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GiB');
});

test('the mention baseline persists with its key, clears on null, and goes with the cache', () => {
  const baseline = {
    seen: new Set(['web13-c3', 'api7-r3-c3']),
    observedAt: Date.parse('2026-08-24T18:00:00Z'),
    unread: new Map([['acme/api#7', Date.parse('2026-08-24T12:00:00Z')]]),
  };

  expect(saveMentionBaseline('key', baseline)).toBe(true);
  expect(loadMentionBaseline('key')).toEqual(baseline);

  // a baseline built for other options never seeds a session
  expect(loadMentionBaseline('other')).toBeNull();

  expect(saveMentionBaseline('key', null)).toBe(true);
  expect(loadMentionBaseline('key')).toBeNull();

  saveMentionBaseline('key', baseline);
  clearCache();

  expect(loadMentionBaseline('key')).toBeNull();

  configureCache(false);

  expect(saveMentionBaseline('key', baseline)).toBe(false);
  expect(loadMentionBaseline('key')).toBeNull();
});

const SAVED_OPTIONS: OptionsState = {
  since: '30d',
  repos: 'acme/api, acme/web',
  user: 'someone',
  target: '1d',
  targetPercentile: 'p95',
  sizeTarget: '400l',
  workDays: 'Sun-Thu',
  workHours: '9-17',
  tz: 'Europe/Berlin',
  wallClock: false,
  includeDrafts: true,
  reviewTypes: 'approve',
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
  expect(values['target-percentile']).toBe('p95');
  expect(values['size-target']).toBe('400l');
  expect(values['work-days']).toBe('Sun-Thu');
  expect(values['work-hours']).toBe('9-17');
  expect(values.tz).toBe('Europe/Berlin');
  expect(values['include-drafts']).toBe(true);
  expect(values['review-types']).toBe('approve');
});

test('empty saved fields stay unset when merged into the CLI values', () => {
  writeSavedOptions({
    ...SAVED_OPTIONS,
    repos: '',
    user: '',
    target: '',
    targetPercentile: '',
    sizeTarget: '',
    tz: '',
    reviewTypes: '',
  });

  const { values, explicit } = parseCliArgs([]);

  expect(applySavedOptions(values, explicit)).not.toBeNull();

  expect(values.repo).toEqual([]);
  expect(values.user).toBeUndefined();
  expect(values.target).toBeUndefined();
  expect(values['target-percentile']).toBeUndefined();
  expect(values['size-target']).toBeUndefined();
  expect(values.tz).toBeUndefined();
  expect(values['review-types']).toBeUndefined();
  expect(values['work-hours']).toBe('9-17');
});

test('a save written before newer fields existed loads with their empty defaults', () => {
  const legacy = { ...SAVED_OPTIONS } as Partial<OptionsState>;

  delete legacy.reviewTypes;
  delete legacy.targetPercentile;
  delete legacy.workDays;

  writeSavedOptions(legacy as OptionsState);

  expect(readSavedOptions()).toEqual({ ...SAVED_OPTIONS, reviewTypes: '', targetPercentile: '', workDays: 'Mon-Fri' });
});

test('discards a saved options file that fails the shape or value checks', () => {
  writeSavedOptions({ ...SAVED_OPTIONS, tz: 'Not/AZone' });

  expect(readSavedOptions()).toBeNull();

  writeFileSync(join(dir, 'options.json'), JSON.stringify({ version: 5, value: { since: 42 } }));

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
 * in tui/testdata. Its canned data has five closed and three open review
 * PRs and four closed and one open authored PR.
 */
function useFakeGh(): void {
  configureAuth(undefined, `${import.meta.dir}/tui/testdata`);
}

/**
 * Builds an empty details entry in the current shape, which the cache
 * tests poison the store with to prove where a read comes from.
 */
function emptyDetails(): PrDetails {
  return {
    additions: 0,
    deletions: 0,
    timelineItems: { nodes: [] },
    reviews: { nodes: [] },
    reviewRequests: { nodes: [] },
  };
}

const searchArgs = { user: 'testuser', sinceIso: '2026-06-01', repos: [] as string[], includeDrafts: false };

async function loadReviewPrs() {
  const review = await searchPrs({ ...searchArgs, mode: 'review' });

  return collectReviewPrs(review.items);
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

  store.set(prKey('acme/api', 1), emptyDetails());

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
  store.set(prKey('acme/web', 3), emptyDetails());

  store.save();

  const { results, cacheHits } = await fetchReviewRaw(prs, 'testuser');

  expect(cacheHits).toBe(0);
  expect(results.find((result) => result.pr.number === 3)?.kind).toBe('pending');
  expect(new PrCache('details').has(prKey('acme/web', 3))).toBe(false);
});

test('refetches a cached details entry written before the outstanding review requests existed', async () => {
  useFakeGh();

  const prs = await loadReviewPrs();
  const store = new PrCache<PrDetails>('details');

  /**
   * An entry from before the field existed lacks the review requests. It
   * reads as a miss although the PR is closed, so the load refetches it
   * once and writes it back in the current shape, after which it serves
   * from the cache again.
   */
  const legacy: Partial<PrDetails> = emptyDetails();

  delete legacy.reviewRequests;

  store.set(prKey('acme/api', 1), legacy as PrDetails);
  store.save();

  const refetched = await fetchReviewRaw(prs, 'testuser');

  expect(refetched.cacheHits).toBe(0);
  expect(refetched.results.find((result) => result.pr.number === 1)?.kind).toBe('reviewed');
  expect(new PrCache<PrDetails>('details').get(prKey('acme/api', 1))?.reviewRequests).toEqual({ nodes: [] });

  const served = await fetchReviewRaw(prs, 'testuser');

  expect(served.cacheHits).toBe(5);
});

test('classifies the canned team requests against the resolved teams', async () => {
  useFakeGh();

  const prs = await loadReviewPrs();
  const teams = await resolveTeams('testuser');

  expect(teams).toEqual(new Set(['acme/backend', 'acme/oncall', 'globex/platform']));

  /**
   * The backend team is still requested on api#9, so it waits for the
   * team, and a teammate already answered on web#16, so nothing waits
   * there. Without the teams both read as requests of someone else.
   */
  const { results } = await fetchReviewRaw(prs, 'testuser', undefined, { teams });

  expect(results.find((result) => result.pr.number === 9)).toMatchObject({
    kind: 'team-pending',
    pr: { repo: 'acme/api', number: 9, state: 'open' },
    requestedAt: new Date('2026-08-25T09:00:00Z'),
    team: 'acme/backend',
  });

  expect(results.find((result) => result.pr.number === 16)?.kind).toBe('inaccessible');

  const withoutTeams = await fetchReviewRaw(prs, 'testuser');

  expect(withoutTeams.results.find((result) => result.pr.number === 9)?.kind).toBe('inaccessible');
});

test('resolveTeams caches the lookup per login and credentials, and a hard reload refreshes it', async () => {
  useFakeGh();

  const auth = await authFingerprint();

  /**
   * The fake pages the memberships. The oncall team only sits on acme's
   * second team page and the platform team only on the second
   * organization page, so the full set proves the lookup follows both
   * connections to their last page before it caches anything.
   */
  expect(readCachedTeams(auth, 'testuser')).toBeNull();
  expect(await resolveTeams('testuser')).toEqual(new Set(['acme/backend', 'acme/oncall', 'globex/platform']));

  expect(readCachedTeams(auth, 'testuser')).toEqual({
    teams: ['acme/backend', 'acme/oncall', 'globex/platform'],
    fresh: true,
  });

  /**
   * A poisoned cached entry proves the next resolve reads the cache
   * instead of asking gh, and a bypass refetches and repairs it.
   */
  writeCachedTeams(['acme/cached'], 'testuser', auth);

  expect(await resolveTeams('testuser')).toEqual(new Set(['acme/cached']));
  expect(await resolveTeams('testuser', true)).toEqual(new Set(['acme/backend', 'acme/oncall', 'globex/platform']));

  expect(readCachedTeams(auth, 'testuser')).toEqual({
    teams: ['acme/backend', 'acme/oncall', 'globex/platform'],
    fresh: true,
  });

  // an entry of another login or other credentials never serves
  expect(readCachedTeams(auth, 'someone')).toBeNull();
  expect(readCachedTeams('other-fingerprint', 'testuser')).toBeNull();
});

test('resolveTeams refreshes an expired entry and falls back to it when the lookup fails', async () => {
  useFakeGh();

  const auth = await authFingerprint();

  const expire = (login: string, teams: string[]) => {
    writeFileSync(
      join(dir, 'teams.json'),
      JSON.stringify({ version: 5, value: { login, auth, teams, cachedAt: '2020-01-01T00:00:00Z' } }),
    );
  };

  expire('testuser', ['acme/stale']);

  expect(readCachedTeams(auth, 'testuser')).toEqual({ teams: ['acme/stale'], fresh: false });
  expect(await resolveTeams('testuser')).toEqual(new Set(['acme/backend', 'acme/oncall', 'globex/platform']));
  expect(readCachedTeams(auth, 'testuser')?.fresh).toBe(true);

  /**
   * The fake cannot resolve the teams of any other login, the way a token
   * without the read:org scope fails the query. The expired entry still
   * serves then, and without any entry the user has no teams, so the
   * load goes on either way.
   */
  expire('someone', ['acme/stale']);

  expect(await resolveTeams('someone')).toEqual(new Set(['acme/stale']));
  expect(readCachedTeams(auth, 'someone')?.fresh).toBe(false);

  rmSync(join(dir, 'teams.json'));

  expect(await resolveTeams('someone')).toEqual(new Set());
  expect(readCachedTeams(auth, 'someone')).toBeNull();
});

test('resolveTeams keeps the expired teams when the token path answers with an incomplete list', async () => {
  /**
   * The token path passes a GraphQL answer through when it carries data
   * next to its errors, and an error nulls the branch it hit, so a
   * membership answer can arrive with an organization or its teams
   * missing. Such an answer must not replace the cached teams, because a
   * missing team would hide its review requests until the entry expires
   * again. The stubbed fetch stands in for the API here, and the token
   * fingerprint keys the entries like the real token path would.
   */
  const originalFetch = globalThis.fetch;
  const answers: unknown[] = [];

  globalThis.fetch = (async () => Response.json(answers.shift())) as unknown as typeof fetch;
  configureAuth('test-token');

  try {
    const auth = await authFingerprint();

    writeFileSync(
      join(dir, 'teams.json'),
      JSON.stringify({
        version: 5,
        value: { login: 'testuser', auth, teams: ['acme/stale'], cachedAt: '2020-01-01T00:00:00Z' },
      }),
    );

    const acme = { login: 'acme', teams: page([{ combinedSlug: 'acme/backend' }]) };
    const errors = [{ message: 'Resource not accessible by integration' }];

    // a missing organization, a missing team list, and a missing team each read as incomplete
    answers.push(
      { data: { user: { organizations: page([acme, null]) } }, errors },
      { data: { user: { organizations: page([acme, { login: 'globex', teams: null }]) } }, errors },
      { data: { user: { organizations: page([{ login: 'acme', teams: page([null]) }]) } }, errors },
      { data: { user: null }, errors },
    );

    while (answers.length > 0) {
      expect(await resolveTeams('testuser')).toEqual(new Set(['acme/stale']));
      expect(readCachedTeams(auth, 'testuser')).toEqual({ teams: ['acme/stale'], fresh: false });
    }

    // a complete answer refreshes the entry as before
    answers.push({ data: { user: { organizations: page([acme, { login: 'globex', teams: page([]) }]) } } });

    expect(await resolveTeams('testuser')).toEqual(new Set(['acme/backend']));
    expect(readCachedTeams(auth, 'testuser')).toEqual({ teams: ['acme/backend'], fresh: true });
  } finally {
    globalThis.fetch = originalFetch;
    useFakeGh();
  }
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
    JSON.stringify({ version: 5, value: { login: 'stale', auth, cachedAt: '2020-01-01T00:00:00Z' } }),
  );

  expect(readCachedLogin(auth)).toBeNull();
  expect(await resolveUser('')).toBe('testuser');
});

const SNAPSHOT_OPTIONS = { since: '2026-06-01', repos: '', user: '', includeDrafts: false, reviewTypes: '' };

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
      lines: 190,
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
    {
      kind: 'team-pending',
      pr: {
        repo: 'acme/api',
        number: 9,
        title: 'h',
        url: 'https://example.com/9',
        state: 'open',
        createdAt: new Date('2026-06-25T08:00:00Z'),
      },
      requestedAt: new Date('2026-06-25T09:00:00Z'),
      team: 'acme/backend',
    },
    {
      kind: 'team-reviewed',
      pr: {
        repo: 'acme/web',
        number: 16,
        title: 'i',
        url: 'https://example.com/16',
        state: 'closed',
        createdAt: new Date('2026-06-09T10:00:00Z'),
      },
      requestedAt: new Date('2026-06-10T09:00:00Z'),
      reviewedAt: new Date('2026-06-11T09:00:00Z'),
      verdict: 'APPROVED',
      lines: 72,
      team: 'acme/backend',
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
      reviews: [
        { login: 'alice', submittedAt: new Date('2026-06-06T10:00:00Z') },
        { login: null, submittedAt: null },
      ],
    },
  ],
  authoredTotal: 2,
  mentions: [
    {
      pr: {
        repo: 'acme/web',
        number: 13,
        title: 'e',
        url: 'https://example.com/13',
        state: 'open',
        createdAt: new Date('2026-07-20T10:00:00Z'),
        updatedAt: new Date('2026-08-25T14:00:00Z'),
      },
      mentions: [
        { id: 'web13-c1', at: new Date('2026-06-20T10:00:00Z') },
        { id: 'web13-c3', at: new Date('2026-08-25T14:00:00Z') },
      ],
      earlier: ['web13-c0'],
    },
    {
      pr: {
        repo: 'acme/web',
        number: 14,
        title: 'f',
        url: 'https://example.com/14',
        state: 'open',
        createdAt: new Date('2026-06-10T10:00:00Z'),
        updatedAt: new Date('2026-06-12T10:00:00Z'),
      },
      mentions: [{ id: 'web14-c1', at: new Date('2026-06-11T10:00:00Z') }],
      earlier: [],
    },
    {
      pr: {
        repo: 'acme/web',
        number: 15,
        title: 'g',
        url: 'https://example.com/15',
        state: 'open',
        createdAt: new Date('2026-06-10T10:00:00Z'),
        updatedAt: new Date('2026-08-20T10:00:00Z'),
      },
      mentions: null,
      earlier: [],
    },
  ],
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
  expect(loadSnapshot({ ...SNAPSHOT_OPTIONS, reviewTypes: 'approve' })).toBeNull();

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

  /**
   * Mentions are cut by their own time. The July window drops the June
   * mention on web#13 and keeps the August one, with the id of the cut
   * mention joining the earlier ids the entry already had, drops web#14
   * whose only mention is from June, and keeps the unreadable web#15
   * because its update time falls in the window, which is the rule the
   * search applies to a PR the load cannot read. A window that starts
   * after every mention and update leaves nothing.
   */
  const [web13, , web15] = SNAPSHOT_DATA.mentions ?? [];

  expect(narrowed?.mentions).toEqual([
    {
      pr: web13.pr,
      mentions: [{ id: 'web13-c3', at: new Date('2026-08-25T14:00:00Z') }],
      earlier: ['web13-c0', 'web13-c1'],
    },
    web15,
  ]);

  expect(loadSnapshot({ ...SNAPSHOT_OPTIONS, since: '2026-08-26' })?.mentions).toEqual([]);

  expect(loadSnapshot({ ...SNAPSHOT_OPTIONS, since: '2026-05-01' })).toBeNull();
});

test('a snapshot written before loads looked for mentions reads as a load without them', () => {
  const { mentions, ...legacy } = SNAPSHOT_DATA;

  expect(mentions).not.toBeNull();

  saveSnapshot(SNAPSHOT_OPTIONS, legacy as RawData);

  expect(loadSnapshot(SNAPSHOT_OPTIONS)).toEqual({ ...legacy, mentions: null });
});

test('serves mentioned PRs from the mention cache until the search reports a newer update', async () => {
  useFakeGh();

  const mentioned = await searchPrs({ ...searchArgs, mode: 'mentioned' });
  const prs = collectMentionedPrs(mentioned.items);
  const first = await fetchMentionsRaw(prs, 'testuser');

  /**
   * The canned data mentions testuser in the third comment on web#13 and
   * in the third inline comment of the third review on api#7, and the
   * fake serves two entries per page, so both mentions only turn up once
   * the fetch follows every list past its first page. The mention on
   * web#3 names a longer login and never counts, which also proves that
   * a PR without a mention is cached and does not refetch.
   */
  expect(first.cacheHits).toBe(0);

  expect(first.mentions.map((entry) => [`${entry.pr.repo}#${entry.pr.number}`, entry.mentions])).toEqual([
    ['acme/web#13', [{ id: 'web13-c3', at: new Date('2026-08-25T14:00:00Z') }]],
    ['acme/api#7', [{ id: 'api7-r3-c3', at: new Date('2026-08-24T16:00:00Z') }]],
  ]);

  const second = await fetchMentionsRaw(prs, 'testuser');

  expect(second.cacheHits).toBe(3);
  expect(second.mentions).toEqual(first.mentions);

  // a newer update time on one PR sends only that PR back to GitHub
  const bumped = prs.map((pr) => (pr.number === 13 ? { ...pr, updatedAt: new Date('2026-08-26T09:00:00Z') } : pr));
  const third = await fetchMentionsRaw(bumped, 'testuser');

  expect(third.cacheHits).toBe(2);
  expect(third.mentions.map((entry) => entry.mentions)).toEqual(first.mentions.map((entry) => entry.mentions));

  const bypassed = await fetchMentionsRaw(prs, 'testuser', undefined, { bypassCache: true });

  expect(bypassed.cacheHits).toBe(0);
  expect(bypassed.mentions).toEqual(first.mentions);

  /**
   * A PR the fake has no texts for reads like one the token cannot read.
   * It stays in the result with null mentions, so the notification diff
   * knows the load did not observe it, and stays out of the cache, so
   * the next load retries it.
   */
  const unreadable = { ...prs[0], number: 99, updatedAt: new Date('2026-08-26T09:00:00Z') };
  const withUnreadable = await fetchMentionsRaw([...prs, unreadable], 'testuser');

  expect(withUnreadable.cacheHits).toBe(3);
  expect(withUnreadable.mentions).toEqual([...first.mentions, { pr: unreadable, mentions: null, earlier: [] }]);

  const retried = await fetchMentionsRaw([...prs, unreadable], 'testuser');

  expect(retried.cacheHits).toBe(3);
});

test('the since option cuts mentions by their time after the cache is read', async () => {
  useFakeGh();

  const mentioned = await searchPrs({ ...searchArgs, mode: 'mentioned' });
  const prs = collectMentionedPrs(mentioned.items);
  const all = await fetchMentionsRaw(prs, 'testuser');

  expect(all.mentions.map((entry) => [entry.pr.number, entry.earlier])).toEqual([
    [13, []],
    [7, []],
  ]);

  /**
   * The mention on api#7 predates the window and drops out with its PR,
   * while the one on web#13 stays. The cut runs on the cached texts, so
   * the narrower window hits the cache for every PR instead of
   * refetching, and a PR the fetch could not read stays in the result
   * regardless, because nothing is known about its mentions.
   */
  const unreadable = { ...prs[0], number: 99, updatedAt: new Date('2026-08-26T09:00:00Z') };
  const since = new Date('2026-08-25T00:00:00Z');
  const cut = await fetchMentionsRaw([...prs, unreadable], 'testuser', undefined, { since });

  expect(cut.cacheHits).toBe(3);

  expect(cut.mentions).toEqual([
    { pr: all.mentions[0].pr, mentions: [{ id: 'web13-c3', at: new Date('2026-08-25T14:00:00Z') }], earlier: [] },
    { pr: unreadable, mentions: null, earlier: [] },
  ]);

  // a mention at the exact start of the window counts as inside it
  const edge = await fetchMentionsRaw(prs, 'testuser', undefined, { since: new Date('2026-08-24T16:00:00Z') });

  expect(edge.mentions.map((entry) => entry.pr.number)).toEqual([13, 7]);

  /**
   * A PR that keeps a mention in the window carries the ids of the ones
   * the window cut as its earlier ids, so a mark made on it covers them.
   * No canned PR mentions testuser twice, so the cached texts of web#13
   * gain an older mention by hand, which the cache serves because the
   * update time still matches the search.
   */
  const store = new PrCache<{ user: string; updatedAt: string; mentions: { id: string; at: string }[] }>('mentions');
  const web13 = prKey('acme/web', 13);
  const cached = store.get(web13);

  store.set(web13, {
    user: 'testuser',
    updatedAt: cached?.updatedAt ?? '',
    mentions: [{ id: 'web13-c0', at: '2026-08-01T10:00:00Z' }, ...(cached?.mentions ?? [])],
  });

  store.save();

  const between = await fetchMentionsRaw(prs, 'testuser', undefined, { since });

  expect(between.cacheHits).toBe(3);

  expect(between.mentions).toEqual([
    {
      pr: all.mentions[0].pr,
      mentions: [{ id: 'web13-c3', at: new Date('2026-08-25T14:00:00Z') }],
      earlier: ['web13-c0'],
    },
  ]);
});

test('the mention cache only serves the login it was written for', async () => {
  useFakeGh();

  const mentioned = await searchPrs({ ...searchArgs, mode: 'mentioned' });
  const prs = collectMentionedPrs(mentioned.items);

  /**
   * Nothing on the canned PRs mentions alice, and her own comment on
   * web#13 does not count for her, so every PR caches as one without a
   * mention for her. The same PRs unchanged must still refetch for
   * testuser and find the mentions, instead of serving alice's empty
   * results. Logins compare case-insensitively, so a differently cased
   * spelling of the same login hits the cache.
   */
  const alice = await fetchMentionsRaw(prs, 'alice');

  expect(alice.mentions).toEqual([]);

  const testuser = await fetchMentionsRaw(prs, 'testuser');

  expect(testuser.cacheHits).toBe(0);
  expect(testuser.mentions.map((entry) => entry.pr.number)).toEqual([13, 7]);

  const recased = await fetchMentionsRaw(prs, 'TestUser');

  expect(recased.cacheHits).toBe(3);
  expect(recased.mentions).toEqual(testuser.mentions);
});

test('serves closed authored PRs from the size cache', async () => {
  useFakeGh();

  const authored = await searchPrs({ ...searchArgs, mode: 'authored' });
  const prs = collectAuthoredPrs(authored.items);
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

function page<T>(nodes: (T | null)[]) {
  return { pageInfo: { hasNextPage: false, endCursor: null }, nodes };
}
