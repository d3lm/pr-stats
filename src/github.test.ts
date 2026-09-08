import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configureAuth,
  configureRateLimits,
  DEFAULT_RATE_LIMIT_POLICY,
  fetchPrSizes,
  onRateLimitWait,
  RateLimitError,
  searchPrs,
  type RateLimitWait,
} from './github';
import { loadData } from './tui/data/load';
import { CliError, sleep } from './utils';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pr-stats-github-'));
});

afterEach(() => {
  configureRateLimits(DEFAULT_RATE_LIMIT_POLICY);
  configureAuth(undefined, `${import.meta.dir}/tui/testdata`);
  rmSync(dir, { recursive: true, force: true });
});

/**
 * What the throwaway gh answers. The counts name how many PRs each search
 * mode has in total, which the fake pages out a hundred at a time. The
 * failing calls make the first so many search calls exit with the given
 * stderr text instead of an answer, and the failing search makes every
 * call of that search mode do the same.
 */
interface FakeSpec {
  counts: { review: number; authored: number; mentioned: number };
  failCalls?: number;
  failSearch?: 'review' | 'authored' | 'mentioned';
  failMessage?: string;
}

/**
 * Installs a gh in the temp directory that logs every call and answers
 * the search endpoint from the spec, and points the GitHub module at it.
 * The token lookup gets a canned token, so a load can run its team
 * lookup against the fake, and every other command fails the way the
 * real gh fails an unknown one.
 */
function installFakeGh(spec: FakeSpec): void {
  writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec));

  writeFileSync(
    join(dir, 'gh.mjs'),
    `import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const args = process.argv.slice(2);
appendFileSync(dir + 'calls.log', JSON.stringify(args) + '\\n');
const spec = JSON.parse(readFileSync(dir + 'spec.json', 'utf8'));
if (args[0] === 'auth') {
  process.stdout.write('fake-token\\n');
  process.exit(0);
}
if (args[1] !== 'search/issues') {
  process.stderr.write('fake gh got unexpected args: ' + args.join(' ') + '\\n');
  process.exit(1);
}
const state = existsSync(dir + 'state.json') ? JSON.parse(readFileSync(dir + 'state.json', 'utf8')) : { calls: 0 };
state.calls += 1;
writeFileSync(dir + 'state.json', JSON.stringify(state));
const fields = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-f') {
    const [key, ...rest] = args[i + 1].split('=');
    fields[key] = rest.join('=');
  }
}
const q = fields.q ?? '';
const mode = q.includes('review-requested:') ? 'review' : q.includes('mentions:') ? 'mentioned' : 'authored';
if (state.calls <= (spec.failCalls ?? 0) || mode === spec.failSearch) {
  process.stderr.write(spec.failMessage + '\\n');
  process.exit(1);
}
const total = spec.counts[mode];
const perPage = Number(fields.per_page);
const page = Number(fields.page);
const items = [];
for (let n = (page - 1) * perPage + 1; n <= Math.min(total, page * perPage); n++) {
  items.push({
    number: n,
    repository_url: 'https://api.github.com/repos/acme/web',
    title: 'pr ' + n,
    html_url: 'https://github.com/acme/web/pull/' + n,
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-02T10:00:00Z',
    draft: false,
    state: 'open',
  });
}
process.stdout.write(JSON.stringify({ total_count: total, items }));
`,
  );

  writeFileSync(join(dir, 'gh'), '#!/bin/sh\nexec node "$(dirname "$0")/gh.mjs" "$@"\n', { mode: 0o755 });
  configureAuth(undefined, dir);
}

/**
 * Returns the field parameters of every gh call the fake logged, in call
 * order. A call without field parameters, like the token lookup, logs as
 * an empty record.
 */
function loggedCalls(): Record<string, string>[] {
  const log = join(dir, 'calls.log');

  if (!existsSync(log)) {
    return [];
  }

  return readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const args = JSON.parse(line) as string[];
      const fields: Record<string, string> = {};

      for (const [i, arg] of args.entries()) {
        if (arg === '-f') {
          const [key, ...rest] = args[i + 1].split('=');

          fields[key] = rest.join('=');
        }
      }

      return fields;
    });
}

/**
 * Collects every wait the GitHub module reports until the returned
 * function removes the listener.
 */
function recordWaits(): { waits: (RateLimitWait | null)[]; stop: () => void } {
  const waits: (RateLimitWait | null)[] = [];

  const stop = onRateLimitWait((wait) => {
    waits.push(wait);
  });

  return { waits, stop };
}

const searchArgs = { user: 'testuser', sinceIso: '2026-06-01', repos: [] as string[], includeDrafts: false };

test('each mode is one advanced search query with the alternatives grouped by OR', async () => {
  installFakeGh({ counts: { review: 3, authored: 2, mentioned: 1 } });

  const review = await searchPrs({ ...searchArgs, repos: ['acme/web', 'acme/api'], mode: 'review' });
  const authored = await searchPrs({ ...searchArgs, repos: ['acme/web'], includeDrafts: true, mode: 'authored' });
  const mentioned = await searchPrs({ ...searchArgs, mode: 'mentioned' });

  expect(review.items.map((item) => item.number)).toEqual([1, 2, 3]);

  expect(review.items[0]).toEqual({
    number: 1,
    repository: { nameWithOwner: 'acme/web' },
    title: 'pr 1',
    url: 'https://github.com/acme/web/pull/1',
    createdAt: '2026-07-01T10:00:00Z',
    updatedAt: '2026-07-02T10:00:00Z',
    isDraft: false,
    state: 'open',
  });

  expect(authored.items).toHaveLength(2);
  expect(mentioned.items).toHaveLength(1);

  const calls = loggedCalls();

  expect(calls).toHaveLength(3);

  /**
   * The review query ORs the two review qualifiers and excludes the
   * user's own PRs, the repos group with OR because the advanced syntax
   * reads a bare space between them as AND, and the drafts filter
   * applies unless drafts are included. The mentioned query ORs the
   * mentions index with the quoted login bounded by involves, filters on
   * the update time, keeps drafts, and sorts by the update time so its
   * pages stay stable.
   */
  expect(calls[0]).toEqual({
    q: 'type:pr (review-requested:testuser OR reviewed-by:testuser) -author:testuser created:>=2026-06-01 draft:false (repo:acme/web OR repo:acme/api)',
    advanced_search: 'true',
    per_page: '100',
    page: '1',
  });

  expect(calls[1]).toEqual({
    q: 'type:pr author:testuser created:>=2026-06-01 repo:acme/web',
    advanced_search: 'true',
    per_page: '100',
    page: '1',
  });

  expect(calls[2]).toEqual({
    q: 'type:pr (mentions:testuser OR ("@testuser" involves:testuser)) updated:>=2026-06-01',
    advanced_search: 'true',
    per_page: '100',
    sort: 'updated',
    order: 'desc',
    page: '1',
  });
});

test('pages until the total is reached and reports the cap at a thousand', async () => {
  installFakeGh({ counts: { review: 250, authored: 1000, mentioned: 1200 } });

  const review = await searchPrs({ ...searchArgs, mode: 'review' });

  expect(review.items).toHaveLength(250);
  expect(review.capped).toBe(false);
  expect(loggedCalls().map((call) => call.page)).toEqual(['1', '2', '3']);

  const authored = await searchPrs({ ...searchArgs, mode: 'authored' });

  expect(authored.items).toHaveLength(1000);
  expect(authored.capped).toBe(true);

  /**
   * The search endpoint stops at a thousand results, so the paging stops
   * at the tenth page even when the total reports more.
   */
  const mentioned = await searchPrs({ ...searchArgs, mode: 'mentioned' });

  expect(mentioned.items).toHaveLength(1000);
  expect(mentioned.capped).toBe(true);
  expect(loggedCalls()).toHaveLength(23);
});

test('concurrent searches run one at a time and pace their pages under the search bound', async () => {
  installFakeGh({ counts: { review: 150, authored: 150, mentioned: 1 } });
  configureRateLimits({ searchRequestsPerWindow: 3, searchWindowMs: 400 });

  const { waits, stop } = recordWaits();
  const started = Date.now();

  try {
    const [review, authored, mentioned] = await Promise.all([
      searchPrs({ ...searchArgs, mode: 'review' }),
      searchPrs({ ...searchArgs, mode: 'authored' }),
      searchPrs({ ...searchArgs, mode: 'mentioned' }),
    ]);

    expect(review.items).toHaveLength(150);
    expect(authored.items).toHaveLength(150);
    expect(mentioned.items).toHaveLength(1);
  } finally {
    stop();
  }

  /**
   * The gate keeps the searches in call order, so the pages of one
   * search never interleave with another's. Five pages against a bound
   * of three per window means the fourth page waits out the window, and
   * the wait reports as a pace wait that clears once the page goes out.
   */
  const calls = loggedCalls();

  expect(
    calls.map(
      (call) =>
        `${call.q.includes('review-requested:') ? 'review' : call.q.includes('mentions:') ? 'mentioned' : 'authored'}:${call.page}`,
    ),
  ).toEqual(['review:1', 'review:2', 'authored:1', 'authored:2', 'mentioned:1']);

  expect(Date.now() - started).toBeGreaterThanOrEqual(300);
  expect(waits.length).toBeGreaterThanOrEqual(2);
  expect(waits[0]?.reason).toBe('pace');
  expect(waits.at(-1)).toBeNull();
});

test('a search that fails the load keeps the later searches from starting', async () => {
  installFakeGh({
    counts: { review: 1, authored: 1, mentioned: 1 },
    failSearch: 'review',
    failMessage: 'gh: API rate limit exceeded for user ID 1. (HTTP 429)',
  });

  configureRateLimits({ retries: 0 });

  const options = { since: '2026-06-01', repos: '', user: 'testuser', includeDrafts: false, reviewTypes: '' };
  const failure = await loadData(options, () => {}, { mentions: true }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(RateLimitError);

  /**
   * The searches used to queue up behind the gate together, so the
   * authored and the mentioned search ran on after the review search had
   * already failed the load. The pause gives such a leftover search the
   * time to reach the fake before the log is read, so a regression shows
   * up as extra search calls.
   */
  await sleep(300);

  const searches = loggedCalls().filter((call) => 'q' in call);

  expect(searches).toHaveLength(1);
  expect(searches[0].q).toContain('review-requested:');
});

test('the retries of a refused search page pass the pacing like the first attempt', async () => {
  installFakeGh({
    counts: { review: 150, authored: 1, mentioned: 1 },
    failCalls: 2,
    failMessage:
      'gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)',
  });

  configureRateLimits({ searchRequestsPerWindow: 2, searchWindowMs: 400, baseWaitMs: 10 });

  const { waits, stop } = recordWaits();
  const started = Date.now();

  try {
    const review = await searchPrs({ ...searchArgs, mode: 'review' });

    expect(review.items).toHaveLength(150);
  } finally {
    stop();
  }

  /**
   * Two refused attempts and the two pages after them make four search
   * requests, and each counts against the bound of two per window, so
   * the third request waits out the window although the retry pause
   * alone would have sent it after a few milliseconds.
   */
  expect(loggedCalls().map((call) => call.page)).toEqual(['1', '1', '1', '2']);
  expect(Date.now() - started).toBeGreaterThanOrEqual(350);

  const reasons = waits.map((wait) => wait?.reason ?? null);

  expect(reasons).toContain('retry');
  expect(reasons).toContain('pace');
  expect(waits.at(-1)).toBeNull();
});

test('retries a call gh reports a rate limit for and reports the wait', async () => {
  installFakeGh({
    counts: { review: 1, authored: 1, mentioned: 1 },
    failCalls: 1,
    failMessage:
      'gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)',
  });

  configureRateLimits({ baseWaitMs: 30 });

  const { waits, stop } = recordWaits();

  try {
    const review = await searchPrs({ ...searchArgs, mode: 'review' });

    expect(review.items).toHaveLength(1);
  } finally {
    stop();
  }

  expect(loggedCalls().map((call) => call.page)).toEqual(['1', '1']);
  expect(waits.map((wait) => wait?.reason ?? null)).toEqual(['retry', null]);
});

test('gives up with a RateLimitError once the retries run out and backs off between them', async () => {
  installFakeGh({
    counts: { review: 1, authored: 1, mentioned: 1 },
    failCalls: 10,
    failMessage: 'gh: API rate limit exceeded for user ID 1. (HTTP 429)',
  });

  configureRateLimits({ retries: 2, baseWaitMs: 20 });

  const { waits, stop } = recordWaits();
  const started = Date.now();

  try {
    const failure = await searchPrs({ ...searchArgs, mode: 'authored' }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RateLimitError);
    expect((failure as RateLimitError).message).toContain('through 2 retries');
    expect((failure as RateLimitError).message).toContain('--since or --repo');
  } finally {
    stop();
  }

  /**
   * The base wait doubles with every retry, twenty then forty
   * milliseconds, so the two retries take at least sixty together.
   */
  expect(loggedCalls()).toHaveLength(3);
  expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  expect(waits.filter((wait) => wait !== null)).toHaveLength(2);
});

test('a failure that is not a rate limit is not retried', async () => {
  installFakeGh({
    counts: { review: 1, authored: 1, mentioned: 1 },
    failCalls: 1,
    failMessage: 'gh: Validation Failed (HTTP 422)',
  });

  configureRateLimits({ baseWaitMs: 10 });

  const failure = await searchPrs({ ...searchArgs, mode: 'authored' }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(CliError);
  expect(failure).not.toBeInstanceOf(RateLimitError);
  expect((failure as CliError).message).toContain('Validation Failed');
  expect(loggedCalls()).toHaveLength(1);
});

/**
 * Builds a fetch stand-in that answers each call with the next response
 * of the list and records the requested URLs.
 */
function fakeFetch(responses: Response[]): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const queue = [...responses];

  const stub = ((input: string | URL | Request) => {
    urls.push(String(input));

    const next = queue.shift();

    if (next === undefined) {
      throw new Error('fake fetch ran out of responses');
    }

    return Promise.resolve(next);
  }) as typeof fetch;

  return { fetch: stub, urls };
}

function searchPage(numbers: number[], total: number): Response {
  return Response.json({
    total_count: total,
    items: numbers.map((number) => {
      return {
        number,
        repository_url: 'https://api.github.com/repos/acme/web',
        title: `pr ${number}`,
        html_url: `https://github.com/acme/web/pull/${number}`,
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-02T10:00:00Z',
        draft: false,
        state: 'open',
      };
    }),
  });
}

test('the token path honors the retry-after header and encodes the query for the URL', async () => {
  const realFetch = globalThis.fetch;

  const refused = Response.json(
    { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' },
    { status: 403, headers: { 'retry-after': '1' } },
  );

  const { fetch, urls } = fakeFetch([refused, searchPage([1, 2], 2)]);

  globalThis.fetch = fetch;
  configureAuth('test-token');
  configureRateLimits({ baseWaitMs: 60_000 });

  const { waits, stop } = recordWaits();
  const started = Date.now();

  try {
    const review = await searchPrs({ ...searchArgs, repos: ['acme/web', 'acme/api'], mode: 'review' });

    expect(review.items.map((item) => item.number)).toEqual([1, 2]);
  } finally {
    stop();
    globalThis.fetch = realFetch;
  }

  /**
   * The header names one second, which beats the minute-long base wait,
   * and the query goes out form-encoded, so the parentheses and the
   * quotes never reach GitHub raw.
   */
  expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  expect(waits.map((wait) => wait?.reason ?? null)).toEqual(['retry', null]);
  expect(urls).toHaveLength(2);

  expect(urls[0]).toBe(
    'https://api.github.com/search/issues?q=type%3Apr+%28review-requested%3Atestuser+OR+reviewed-by%3Atestuser%29+-author%3Atestuser+created%3A%3E%3D2026-06-01+draft%3Afalse+%28repo%3Aacme%2Fweb+OR+repo%3Aacme%2Fapi%29&advanced_search=true&per_page=100&page=1',
  );
});

test('the token path gives up right away when the limit lifts too far in the future', async () => {
  const realFetch = globalThis.fetch;
  const reset = Math.floor(Date.now() / 1000) + 3600;

  const refused = Response.json(
    { message: 'API rate limit exceeded for user ID 1.' },
    { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } },
  );

  const { fetch, urls } = fakeFetch([refused]);

  globalThis.fetch = fetch;
  configureAuth('test-token');

  try {
    const failure = await searchPrs({ ...searchArgs, mode: 'authored' }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RateLimitError);
    expect((failure as RateLimitError).message).toContain('until about');
    expect((failure as RateLimitError).resetAt?.getTime()).toBe(reset * 1000);
  } finally {
    globalThis.fetch = realFetch;
  }

  expect(urls).toHaveLength(1);
});

test('a GraphQL answer that carries a RATE_LIMITED error counts as a rate limit', async () => {
  const realFetch = globalThis.fetch;

  const { fetch, urls } = fakeFetch([
    Response.json({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit already exceeded for user ID 1.' }] }),
    Response.json({ data: { pr0: { pullRequest: null } } }),
  ]);

  globalThis.fetch = fetch;
  configureAuth('test-token');
  configureRateLimits({ baseWaitMs: 20 });

  const { waits, stop } = recordWaits();

  try {
    const sizes = await fetchPrSizes([{ repo: 'acme/web', number: 1 }]);

    expect(sizes).toEqual([null]);
  } finally {
    stop();
    globalThis.fetch = realFetch;
  }

  expect(urls).toEqual(['https://api.github.com/graphql', 'https://api.github.com/graphql']);
  expect(waits.map((wait) => wait?.reason ?? null)).toEqual(['retry', null]);
});
