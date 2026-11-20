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
 * The fake spaces its PRs an hour apart unless sameSecond puts them all in one second, honors the
 * date qualifier of a query, and refuses pages past the first thousand results like GitHub.
 */
interface FakeSpec {
  counts: { review: number; requested?: number; authored: number; mentioned: number };
  sameSecond?: boolean;
  failCalls?: number;
  failSearch?: 'review' | 'requested' | 'authored' | 'mentioned';
  failMessage?: string;
}

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
const mode = q.includes('reviewed-by:')
  ? 'review'
  : q.includes('review-requested:') ? 'requested' : q.includes('mentions:') ? 'mentioned' : 'authored';
if (state.calls <= (spec.failCalls ?? 0) || mode === spec.failSearch) {
  process.stderr.write(spec.failMessage + '\\n');
  process.exit(1);
}
const perPage = Number(fields.per_page);
const page = Number(fields.page);
if ((page - 1) * perPage >= 1000) {
  process.stderr.write('gh: Cannot access beyond the first 1000 results. (HTTP 422)\\n');
  process.exit(1);
}
const iso = (ms) => new Date(ms).toISOString().replace(/\\.\\d{3}Z$/, 'Z');
const matching = [];
for (let n = 1; n <= (spec.counts[mode] ?? 0); n++) {
  const created = Date.parse('2026-07-01T10:00:00Z') + (spec.sameSecond ? 0 : (n - 1) * 3_600_000);
  matching.push({ n, created_at: iso(created), updated_at: iso(created + 86_400_000) });
}
const bound = /(created|updated):(\\S+)/.exec(q);
const inWindow = (item) => {
  if (bound === null) {
    return true;
  }
  const at = Date.parse(item[bound[1] + '_at']);
  const [from, to] = bound[2].startsWith('>=')
    ? [bound[2].slice(2), null]
    : bound[2].startsWith('<=')
      ? [null, bound[2].slice(2)]
      : bound[2].split('..');
  return (from === null || at >= Date.parse(from)) && (to === null || at <= Date.parse(to));
};
const found = matching.filter(inWindow);
const items = found.slice((page - 1) * perPage, page * perPage).map((item) => {
  return {
    number: item.n,
    repository_url: 'https://api.github.com/repos/acme/web',
    title: 'pr ' + item.n,
    html_url: 'https://github.com/acme/web/pull/' + item.n,
    created_at: item.created_at,
    updated_at: item.updated_at,
    draft: false,
    state: 'open',
  };
});
process.stdout.write(JSON.stringify({ total_count: found.length, items }));
`,
  );

  writeFileSync(join(dir, 'gh'), '#!/bin/sh\nexec node "$(dirname "$0")/gh.mjs" "$@"\n', { mode: 0o755 });
  configureAuth(undefined, dir);
}

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

function recordWaits(): { waits: (RateLimitWait | null)[]; stop: () => void } {
  const waits: (RateLimitWait | null)[] = [];

  const stop = onRateLimitWait((wait) => {
    waits.push(wait);
  });

  return { waits, stop };
}

const searchArgs = { user: 'testuser', sinceIso: '2026-06-01', repos: [] as string[], includeDrafts: false };

test('each mode is one advanced search query with the alternatives grouped by OR', async () => {
  installFakeGh({ counts: { review: 3, requested: 2, authored: 2, mentioned: 1 } });

  const review = await searchPrs({ ...searchArgs, repos: ['acme/web', 'acme/api'], mode: 'review' });
  const requested = await searchPrs({ ...searchArgs, repos: ['acme/web'], mode: 'requested' });
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

  expect(requested.items).toHaveLength(2);
  expect(authored.items).toHaveLength(2);
  expect(mentioned.items).toHaveLength(1);

  const calls = loggedCalls();

  expect(calls).toHaveLength(4);

  expect(calls[0]).toEqual({
    q: 'type:pr (review-requested:testuser OR reviewed-by:testuser) -author:testuser created:>=2026-06-01 draft:false (repo:acme/web OR repo:acme/api)',
    advanced_search: 'true',
    per_page: '100',
    page: '1',
  });

  expect(calls[1]).toEqual({
    q: 'type:pr review-requested:testuser -author:testuser is:open draft:false repo:acme/web',
    advanced_search: 'true',
    per_page: '100',
    page: '1',
  });

  expect(calls[2]).toEqual({
    q: 'type:pr author:testuser created:>=2026-06-01 repo:acme/web',
    advanced_search: 'true',
    per_page: '100',
    page: '1',
  });

  expect(calls[3]).toEqual({
    q: 'type:pr (mentions:testuser OR ("@testuser" involves:testuser)) updated:>=2026-06-01',
    advanced_search: 'true',
    per_page: '100',
    sort: 'updated',
    order: 'desc',
    page: '1',
  });
});

test('pages until the total is reached, and a total of exactly a thousand is complete', async () => {
  installFakeGh({ counts: { review: 250, authored: 1000, mentioned: 1 } });

  const review = await searchPrs({ ...searchArgs, mode: 'review' });

  expect(review.items).toHaveLength(250);
  expect(review.capped).toBe(false);
  expect(loggedCalls().map((call) => call.page)).toEqual(['1', '2', '3']);

  const authored = await searchPrs({ ...searchArgs, mode: 'authored' });

  expect(authored.items).toHaveLength(1000);
  expect(authored.capped).toBe(false);
  expect(loggedCalls()).toHaveLength(13);
});

test('a search past the thousand result cap splits its date range until every PR is found', async () => {
  installFakeGh({ counts: { review: 2500, requested: 1500, authored: 1, mentioned: 2500 } });

  const review = await searchPrs({ ...searchArgs, mode: 'review' });
  const requested = await searchPrs({ ...searchArgs, mode: 'requested' });
  const mentioned = await searchPrs({ ...searchArgs, mode: 'mentioned' });

  for (const [result, total] of [
    [review, 2500],
    [requested, 1500],
    [mentioned, 2500],
  ] as const) {
    expect(result.capped).toBe(false);
    expect(new Set(result.items.map((item) => item.number)).size).toBe(total);
    expect(result.items).toHaveLength(total);
  }

  const queries = loggedCalls().map((call) => call.q);

  expect(queries[0]).toContain('created:>=2026-06-01 ');
  expect(queries.some((q) => /created:2026-06-01\.\.\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ /.test(q))).toBe(true);
  expect(queries.some((q) => /is:open created:<=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ /.test(q))).toBe(true);
  expect(queries.some((q) => /updated:>=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(q))).toBe(true);
}, 60_000);

test('a single second with more than a thousand results reports the cap', async () => {
  installFakeGh({ counts: { review: 1, authored: 1200, mentioned: 1 }, sameSecond: true });

  const authored = await searchPrs({ ...searchArgs, mode: 'authored' });

  expect(authored.items).toHaveLength(1000);
  expect(authored.capped).toBe(true);
}, 30_000);

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
