import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { CliError, createLimiter, sleep } from './utils';

const execFileAsync = promisify(execFile);

const API_BASE = 'https://api.github.com';

/**
 * Marks a request GitHub refused over a rate limit, the primary one or a
 * secondary one. The retry wrapper catches it and waits before it tries
 * again, and the one that escapes after the last retry tells the user to
 * wait instead of blaming the request.
 */
export class RateLimitError extends CliError {
  /**
   * Holds the time GitHub said the limit lifts, from the retry-after or
   * the rate-limit reset header, or null when the answer named none,
   * which is what the gh CLI path and most secondary limits leave.
   */
  readonly resetAt: Date | null;

  constructor(message: string, resetAt: Date | null = null) {
    super(message);
    this.resetAt = resetAt;
  }
}

/**
 * One pause a load sits in because of GitHub's rate limits. A pace wait
 * spaces the search requests below GitHub's per-minute search limit
 * before any request gets refused, and a retry wait follows a refused
 * request and lasts until the retry.
 */
export interface RateLimitWait {
  reason: 'pace' | 'retry';
  until: Date;
}

type WaitListener = (wait: RateLimitWait | null) => void;

let waitListener: WaitListener | null = null;

const activeWaits = new Set<RateLimitWait>();

/**
 * Registers the listener that hears about every rate-limit wait, so a
 * load can show the pause instead of a stalled spinner. The listener
 * receives the wait that ends last while any is active and null once
 * the requests flow again. Only one listener is registered at a time,
 * because only one load runs at a time. Returns the function that
 * removes the listener again.
 */
export function onRateLimitWait(listener: WaitListener): () => void {
  waitListener = listener;

  return () => {
    if (waitListener === listener) {
      waitListener = null;
    }
  };
}

function publishWaits(): void {
  if (waitListener === null) {
    return;
  }

  let latest: RateLimitWait | null = null;

  for (const wait of activeWaits) {
    if (latest === null || wait.until > latest.until) {
      latest = wait;
    }
  }

  waitListener(latest);
}

/**
 * Sleeps until the wait ends and reports the wait to the listener for
 * as long as it lasts.
 */
async function waitOut(wait: RateLimitWait): Promise<void> {
  activeWaits.add(wait);
  publishWaits();

  try {
    await sleep(wait.until.getTime() - Date.now());
  } finally {
    activeWaits.delete(wait);
    publishWaits();
  }
}

/**
 * Tunes how the module treats GitHub's rate limits. The retries count
 * says how often a refused request is tried again, the base wait is the
 * pause before the first retry, which doubles with every further one when
 * GitHub names no reset time, and the max wait is the longest pause the
 * module accepts before it gives up right away, because a limit that
 * lifts in an hour is not worth sitting through. The search bound caps
 * the search requests per window, which GitHub sets at thirty per minute
 * for the search endpoint, and the default keeps a little headroom under
 * that.
 */
export interface RateLimitPolicy {
  retries: number;
  baseWaitMs: number;
  maxWaitMs: number;
  searchRequestsPerWindow: number;
  searchWindowMs: number;
}

export const DEFAULT_RATE_LIMIT_POLICY: RateLimitPolicy = {
  retries: 3,
  baseWaitMs: 60_000,
  maxWaitMs: 5 * 60_000,
  searchRequestsPerWindow: 25,
  searchWindowMs: 60_000,
};

let policy: RateLimitPolicy = DEFAULT_RATE_LIMIT_POLICY;

/**
 * Overrides parts of the rate-limit policy and keeps the rest as it is.
 * The tests shorten the waits with it, and the debug path lifts the
 * search pacing, because no rate limit stands behind a fake gh.
 */
export function configureRateLimits(overrides: Partial<RateLimitPolicy>): void {
  policy = { ...policy, ...overrides };
}

/**
 * Runs the request and retries it after a pause whenever GitHub refuses
 * it over a rate limit, following GitHub's guidance to honor the reset
 * time it names and to back off exponentially otherwise. The request
 * that still fails after the last retry, or whose reset lies further
 * away than the policy accepts, escapes as a RateLimitError that tells
 * the user what to do.
 */
async function withRateLimitRetry<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      if (!(error instanceof RateLimitError)) {
        throw error;
      }

      const waitMs = error.resetAt === null ? policy.baseWaitMs * 2 ** attempt : error.resetAt.getTime() - Date.now();

      /**
       * The gh CLI reports through a multi-line stderr text, which folds
       * onto one line so the message reads as one sentence in the UI.
       */
      const detail = error.message.replaceAll(/\s+/g, ' ');

      if (waitMs > policy.maxWaitMs) {
        const resumeAt = new Date(Date.now() + waitMs).toLocaleTimeString();

        throw new RateLimitError(
          `GitHub rate limit exceeded until about ${resumeAt}. Reload after that, or narrow the search with --since or --repo. (${detail})`,
          error.resetAt,
        );
      }

      if (attempt >= policy.retries) {
        throw new RateLimitError(
          `GitHub kept refusing requests over a rate limit through ${attempt} retries. Wait a few minutes and reload, or narrow the search with --since or --repo. (${detail})`,
          error.resetAt,
        );
      }

      await waitOut({ reason: 'retry', until: new Date(Date.now() + Math.max(waitMs, 0)) });
    }
  }
}

/**
 * Reads the time a rate limit lifts from the headers of a refused
 * answer. The retry-after header counts seconds from now, and the reset
 * header names an epoch second once the remaining budget hit zero. An
 * answer with neither, which the secondary limits usually send, yields
 * null.
 */
function rateLimitReset(headers: Headers): Date | null {
  const retryAfter = Number(headers.get('retry-after'));

  if (retryAfter > 0) {
    return new Date(Date.now() + retryAfter * 1000);
  }

  const reset = Number(headers.get('x-ratelimit-reset'));

  if (headers.get('x-ratelimit-remaining') === '0' && reset > 0) {
    return new Date(reset * 1000);
  }

  return null;
}

const RATE_LIMIT_MESSAGE = /rate limit/i;

export interface SearchPrItem {
  number: number;
  repository: { nameWithOwner: string };
  title: string;
  url: string;
  createdAt: string;
  /**
   * Holds the time of the last activity on the PR as an ISO string. The
   * mention fetch keys its cache on it, because any new comment or
   * review moves it, so an unchanged value proves no mention is new.
   */
  updatedAt: string;
  isDraft: boolean;
  state: string;
}

export interface PrRef {
  repo: string;
  number: number;
}

/**
 * A requested reviewer as the API returns it, a User or Team union, so
 * the login and the team slugs are all optional. A team carries its
 * bare slug and the combined org/slug form, which is what identifies a
 * team across organizations and what the team membership lookup returns.
 */
export interface RequestedReviewer {
  login?: string;
  slug?: string;
  combinedSlug?: string;
}

/**
 * One node of the review-request timeline.
 */
export interface TimelineNode {
  createdAt: string;
  requestedReviewer?: RequestedReviewer | null;
}

export interface ReviewNode {
  author: { login: string } | null;
  submittedAt: string | null;
  state: string;
}

/**
 * Review timeline and size of one PR on your reviewing plate. The
 * additions and deletions ride along for the review-time-vs-size
 * scatter and hold the PR's size at fetch time, not at review time. The
 * review requests list the reviewers whose request is still outstanding,
 * which tells a team request a teammate already answered from one that
 * still waits, because the timeline only records when a request was
 * made and never when it was satisfied.
 */
export interface PrDetails {
  additions: number;
  deletions: number;
  timelineItems: { nodes: (TimelineNode | null)[] };
  reviews: { nodes: (ReviewNode | null)[] };
  reviewRequests: { nodes: ({ requestedReviewer?: RequestedReviewer | null } | null)[] };
}

/**
 * Size and comment counters of one authored PR. The comments connection
 * counts the conversation comments, and each review node carries the
 * count of its inline comments, so the sum over the nodes is the number
 * of review comments. GitHub's aggregate totalCommentsCount field is
 * unreliable, which is why the two sources are fetched separately.
 * The merge and close timestamps ride along because the search endpoints
 * only report open or closed and cannot tell a merge from a plain close.
 * Each review node also names its author and carries its submission time,
 * which feed the reviewer leaderboard and the first-review stats. A deleted
 * account leaves the author null, and the viewer's own unsubmitted pending
 * review leaves the submission time null.
 */
export interface PrSize {
  additions: number;
  deletions: number;
  changedFiles: number;
  /**
   * Holds the merge time as an ISO string, or null while the PR is open
   * or was closed without a merge.
   */
  mergedAt: string | null;
  /**
   * Holds the close time as an ISO string, merged or not, or null while
   * the PR is open.
   */
  closedAt: string | null;
  comments: { totalCount: number };
  reviews: {
    nodes: ({
      author: { login: string } | null;
      submittedAt: string | null;
      comments: { totalCount: number };
    } | null)[];
  };
}

/**
 * Arguments of one PR search. The review mode covers the PRs other people
 * authored that the user was asked to review or reviewed, in one query,
 * and excludes the user's own, because GitHub records an author's inline
 * replies as reviews, so a plain reviewed-by search returns your own PRs
 * whenever you answered a comment on them. The authored mode covers the
 * user's own PRs. The mentioned mode finds the PRs whose texts name the
 * user, the user's own PRs included, because a mention asks for attention
 * no matter who opened the PR. It also keeps drafts and filters on the
 * last update instead of the creation date, because a fresh mention on an
 * old PR is exactly what it looks for.
 *
 * The mentioned mode unites two lookups in one query. The first uses the
 * mentions qualifier, whose index only covers the PR body and the
 * conversation comments, so a mention that sits in a review body or an
 * inline review comment never reaches it. The second searches the login
 * as text, which the text index finds in reviews and inline comments too,
 * but which also misses conversation comments the mentions index has, so
 * neither lookup replaces the other. The text search drops the at sign,
 * so on its own it would match every PR that carries the login anywhere,
 * which for a login that is also a common word means hundreds of
 * thousands of PRs. The involves qualifier bounds it to the PRs the user
 * authored, commented on, reviewed, or is indexed as mentioned on. A
 * mention in a review of a PR the user has only been asked to review, or
 * has nothing to do with, still stays out, because no search qualifier
 * reaches those texts. The mention fetch then confirms every hit against
 * the texts, so a PR that carries the login without an at sign drops out
 * there.
 */
export interface SearchArgs {
  user: string;
  sinceIso: string;
  repos: string[];
  includeDrafts: boolean;
  mode: 'review' | 'authored' | 'mentioned';
}

/**
 * Result of one search, the PRs it found and whether the query reached
 * the result cap, in which case GitHub cut the list and the load warns
 * about it.
 */
export interface SearchResult {
  items: SearchPrItem[];
  capped: boolean;
}

/**
 * Most results one query returns, which is where GitHub's search endpoint
 * stops paging, so a query that returns this many items may have been cut
 * and the load warns about it.
 */
export const SEARCH_LIMIT = 1000;

/**
 * Items per search page, the most the search endpoint hands out at once.
 */
const SEARCH_PAGE_SIZE = 100;

let token: string | undefined;

let ghBinary = 'gh';

/**
 * Resolves a --debug value to the fake gh binary it names. The path can
 * point at a testdata directory that contains a gh executable, or at the
 * executable itself.
 */
function resolveDebugBinary(input: string): string {
  const resolved = resolve(input);
  const stats = statSync(resolved, { throwIfNoEntry: false });

  if (stats?.isDirectory()) {
    const binary = join(resolved, 'gh');

    if (!statSync(binary, { throwIfNoEntry: false })?.isFile()) {
      throw new CliError(`--debug directory "${input}" does not contain a gh executable`);
    }

    return binary;
  }

  if (stats?.isFile()) {
    return resolved;
  }

  throw new CliError(`--debug path "${input}" does not exist`);
}

/**
 * Picks the auth method for all GitHub calls. A token from the --token flag
 * or the GITHUB_TOKEN/GH_TOKEN environment variables switches the module to
 * direct API calls. Without one, everything goes through the gh CLI. A
 * debug path replaces the gh CLI with the fake binary it names and ignores
 * every token, so all data comes from canned responses instead of GitHub,
 * and it lifts the search pacing, because no rate limit stands behind the
 * fake.
 */
export function configureAuth(cliToken?: string, debugPath?: string): void {
  if (debugPath !== undefined) {
    ghBinary = resolveDebugBinary(debugPath);
    token = undefined;
    configureRateLimits({ searchRequestsPerWindow: Number.POSITIVE_INFINITY });
    return;
  }

  ghBinary = 'gh';
  token = cliToken ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  configureRateLimits({ searchRequestsPerWindow: DEFAULT_RATE_LIMIT_POLICY.searchRequestsPerWindow });
}

/**
 * Runs one gh command and returns its stdout. A command gh reports
 * a rate limit for is retried after a pause, see withRateLimitRetry.
 */
function gh(args: string[]): Promise<string> {
  return withRateLimitRetry(() => ghOnce(args));
}

/**
 * Runs one gh command exactly once and returns its stdout. A command gh
 * reports a rate limit for, which it only tells through its stderr text,
 * fails with a RateLimitError, so the retry around it knows to wait. The
 * search pages call this directly, because they pass the pacing before
 * every attempt and wrap the retry around both.
 */
async function ghOnce(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(ghBinary, args, {
      maxBuffer: 64 * 1024 * 1024,
    });

    return stdout;
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stderr?: string | Buffer };

    if (execError.code === 'ENOENT') {
      throw new CliError('the gh CLI is not installed, install it or provide a token via --token or GITHUB_TOKEN');
    }

    const stderr = execError.stderr?.toString().trim();
    const detail = `gh ${args.slice(0, 2).join(' ')} failed${stderr ? `\n${stderr}` : ''}`;

    if (stderr && RATE_LIMIT_MESSAGE.test(stderr)) {
      throw new RateLimitError(detail);
    }

    throw new CliError(detail);
  }
}

/**
 * Sends one request to the GitHub API with the configured token and returns
 * the parsed JSON body. A refusal over a rate limit is retried after a
 * pause, see withRateLimitRetry.
 */
function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  return withRateLimitRetry(() => apiOnce<T>(path, options));
}

/**
 * Sends exactly one request to the GitHub API with the configured token
 * and returns the parsed JSON body. A refusal over a rate limit, which
 * GitHub signals with a 403 or 429 and a rate-limit message or header,
 * fails with a RateLimitError, so the retry around it knows to wait.
 * GitHub also answers a GraphQL query it rate limits with a 200 whose
 * errors carry the RATE_LIMITED type, which gets the same treatment. The
 * search pages call this directly, because they pass the pacing before
 * every attempt and wrap the retry around both.
 */
async function apiOnce<T>(
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'pr-stats',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    const failure = error as { message?: string; cause?: { message?: string } };

    throw new CliError(`cannot reach ${API_BASE} (${failure.cause?.message ?? failure.message})`);
  }

  const endpoint = path.split('?')[0];

  if (!response.ok) {
    /**
     * GitHub error responses carry a JSON body whose message names the
     * actual problem, so read it here to enrich the error.
     */
    const payload: unknown = await response.json().catch(() => null);
    const message = (payload as { message?: string } | null)?.message ?? '';
    const detail = `GitHub API ${method} ${endpoint} failed with ${response.status}${message ? ` (${message})` : ''}`;
    const resetAt = rateLimitReset(response.headers);

    if (
      (response.status === 403 || response.status === 429) &&
      (resetAt !== null || RATE_LIMIT_MESSAGE.test(message))
    ) {
      throw new RateLimitError(detail, resetAt);
    }

    throw new CliError(detail);
  }

  const payload = (await response.json().catch(() => null)) as T;
  const errors = (payload as { errors?: { type?: string; message?: string }[] } | null)?.errors;
  const rateLimited = errors?.find((error) => error.type === 'RATE_LIMITED');

  if (rateLimited !== undefined) {
    throw new RateLimitError(
      `GitHub API ${method} ${endpoint} was rate limited${rateLimited.message ? ` (${rateLimited.message})` : ''}`,
      rateLimitReset(response.headers),
    );
  }

  return payload;
}

/**
 * Runs a GraphQL query through the configured auth method and returns the
 * data object. Partial data with per-field errors passes through, because
 * the callers already treat missing PRs as inaccessible.
 */
async function runGraphql<T>(query: string): Promise<T> {
  if (token) {
    const result = await api<{ data?: T; errors?: { message?: string }[] }>('/graphql', {
      method: 'POST',
      body: { query },
    });

    if (!result.data) {
      const message = result.errors?.[0]?.message;

      throw new CliError(`GitHub GraphQL query failed${message ? ` (${message})` : ''}`);
    }

    return result.data;
  }

  const stdout = await gh(['api', 'graphql', '-f', `query=${query}`]);

  return (JSON.parse(stdout) as { data: T }).data;
}

/**
 * Returns a stable fingerprint of the active credentials, so values
 * cached for one account never get served to another. Token auth hashes
 * the token itself. The gh path hashes the token gh would send, which
 * "gh auth token" prints from its local config without a network round
 * trip, so an account switch through gh changes the fingerprint too.
 * Only a digest of the credential ever leaves this function.
 */
export async function authFingerprint(): Promise<string> {
  let credential = token;

  if (credential === undefined) {
    const stdout = await gh(['auth', 'token']);

    credential = stdout.trim();
  }

  return createHash('sha256').update(credential).digest('hex').slice(0, 16);
}

/**
 * Returns the login of the authenticated user.
 */
export async function fetchCurrentUser(): Promise<string> {
  if (token) {
    const user = await api<{ login: string }>('/user');

    return user.login;
  }

  const stdout = await gh(['api', 'user', '--jq', '.login']);

  return stdout.trim();
}

/**
 * Finds the owner of the repo in the current directory. The gh path asks
 * gh directly. The token path parses the origin remote URL, covering both
 * the SSH and HTTPS forms.
 */
async function fetchDefaultOwner(): Promise<string> {
  if (!token) {
    const stdout = await gh(['repo', 'view', '--json', 'owner', '--jq', '.owner.login']);

    return stdout.trim();
  }

  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin']);
    const match = /github\.com[/:]([^/]+)\//.exec(stdout);

    return match?.[1] ?? '';
  } catch {
    return '';
  }
}

/**
 * Expands bare repository names against the owner of the repo in the
 * current directory. Names already in owner/name form pass through.
 */
export async function resolveRepos(repos: string[]): Promise<string[]> {
  let defaultOwner: string | undefined;

  const resolved: string[] = [];

  for (const repo of repos) {
    if (repo.includes('/')) {
      resolved.push(repo);
      continue;
    }

    if (!defaultOwner) {
      defaultOwner = await fetchDefaultOwner();

      if (!defaultOwner) {
        throw new CliError(`cannot resolve owner for "--repo ${repo}", use the owner/name form`);
      }
    }

    resolved.push(`${defaultOwner}/${repo}`);
  }

  return resolved;
}

/**
 * Item shape of the REST search endpoint, reduced to the fields the search
 * mapping below reads.
 */
interface SearchApiItem {
  number: number;
  repository_url: string;
  title: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  draft: boolean;
  state: string;
}

/**
 * Joins terms with OR and wraps the group in parentheses, or returns a
 * lone term as it is. The advanced search syntax reads a bare space
 * between qualifiers as AND, so every alternative has to be grouped this
 * way, the repos included.
 */
function orGroup(terms: string[]): string {
  return terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`;
}

/**
 * Builds the query string of one search in GitHub's advanced issue
 * search syntax, see SearchArgs for what each mode asks for. The review
 * mode ORs the two review qualifiers into one query, and the mentioned
 * mode ORs the mentions index with the quoted login as text bounded by
 * the involves qualifier, so each mode costs one query.
 */
function buildSearchQuery({ user, sinceIso, repos, includeDrafts, mode }: SearchArgs): string {
  const terms = ['type:pr'];

  if (mode === 'review') {
    terms.push(
      orGroup([`review-requested:${user}`, `reviewed-by:${user}`]),
      `-author:${user}`,
      `created:>=${sinceIso}`,
    );
  } else if (mode === 'authored') {
    terms.push(`author:${user}`, `created:>=${sinceIso}`);
  } else {
    terms.push(`(mentions:${user} OR ("@${user}" involves:${user}))`, `updated:>=${sinceIso}`);
  }

  if (!includeDrafts && mode !== 'mentioned') {
    terms.push('draft:false');
  }

  if (repos.length > 0) {
    terms.push(orGroup(repos.map((repo) => `repo:${repo}`)));
  }

  return terms.join(' ');
}

interface SearchPage {
  total_count: number;
  items: SearchApiItem[];
}

/**
 * Times of the search requests sent within the last window, which the
 * pacing below reads to stay under GitHub's per-minute search limit.
 */
const searchRequestTimes: number[] = [];

/**
 * Holds a search request back until it fits under the search bound of
 * the policy. GitHub caps the search endpoint at thirty requests per
 * minute on top of the general limits, and a user with hundreds of PRs
 * in the window pages through more than that across the three searches,
 * so without the pause the pages past the bound come back refused. The
 * wait reports through the rate-limit listener like a retry wait does.
 */
async function paceSearchRequest(): Promise<void> {
  for (;;) {
    const now = Date.now();

    while (searchRequestTimes.length > 0 && now - searchRequestTimes[0] >= policy.searchWindowMs) {
      searchRequestTimes.shift();
    }

    if (searchRequestTimes.length < policy.searchRequestsPerWindow) {
      searchRequestTimes.push(now);
      return;
    }

    await waitOut({ reason: 'pace', until: new Date(searchRequestTimes[0] + policy.searchWindowMs) });
  }
}

/**
 * Fetches one page of the search endpoint with the given query
 * parameters, through the API with a token and through gh api otherwise.
 * Both paths speak to the same REST endpoint with the same parameters,
 * so the query syntax, the paging, and the pacing are shared, where the
 * gh search command would page on its own without any pause between the
 * pages. Every attempt passes the pacing first, the retries after a
 * refusal included, because GitHub counts each of them against the same
 * search limit, so the retry wraps around the pacing here instead of
 * inside the request functions.
 */
function fetchSearchPage(params: Record<string, string>): Promise<SearchPage> {
  return withRateLimitRetry(async () => {
    await paceSearchRequest();

    if (token) {
      return apiOnce<SearchPage>(`/search/issues?${new URLSearchParams(params).toString()}`);
    }

    const fields = Object.entries(params).flatMap(([key, value]) => ['-f', `${key}=${value}`]);
    const stdout = await ghOnce(['api', 'search/issues', '-X', 'GET', ...fields]);

    return JSON.parse(stdout) as SearchPage;
  });
}

/**
 * Gate that runs the searches one at a time across the process. The
 * three searches of a load used to page concurrently, which with a wide
 * window sent a burst of heavy search requests that tripped GitHub's
 * secondary rate limits. One search at a time keeps the burst to a
 * trickle, and the per-minute pacing bounds the trickle.
 */
const searchGate = createLimiter(1);

/**
 * Runs one search and pages through its results up to the cap. Items map
 * onto the field names the gh search command used to produce, so the
 * rest of the code reads one shape. The mentioned mode sorts by the
 * update time, because a text search ranks by relevance otherwise and
 * that ranking shifts between pages, which drops and repeats items across
 * them. The search counts as capped when it returned the limit, see
 * SearchResult.
 */
export function searchPrs(args: SearchArgs): Promise<SearchResult> {
  return searchGate(async () => {
    const params: Record<string, string> = {
      q: buildSearchQuery(args),
      advanced_search: 'true',
      per_page: String(SEARCH_PAGE_SIZE),
      ...(args.mode === 'mentioned' ? { sort: 'updated', order: 'desc' } : {}),
    };

    const items: SearchApiItem[] = [];

    for (let page = 1; page <= SEARCH_LIMIT / SEARCH_PAGE_SIZE; page++) {
      const result = await fetchSearchPage({ ...params, page: String(page) });

      items.push(...result.items);

      if (result.items.length === 0 || items.length >= result.total_count) {
        break;
      }
    }

    return {
      items: items.map((item) => {
        return {
          number: item.number,
          repository: { nameWithOwner: item.repository_url.replace(`${API_BASE}/repos/`, '') },
          title: item.title,
          url: item.html_url,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          isDraft: item.draft,
          state: item.state,
        };
      }),
      capped: items.length >= SEARCH_LIMIT,
    };
  });
}

/**
 * Fetches review requests, reviews, and the size for a batch of PRs
 * with one GraphQL call. Aliases keep the batch inside a single query.
 */
export async function fetchPrDetails(prs: PrRef[]): Promise<(PrDetails | null)[]> {
  const parts = prs.map((pr, i) => {
    const [owner, name] = pr.repo.split('/');

    return `
      pr${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
        pullRequest(number: ${pr.number}) {
          additions
          deletions
          timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], first: 100) {
            nodes {
              ... on ReviewRequestedEvent {
                createdAt
                requestedReviewer {
                  ... on User { login }
                  ... on Team { slug combinedSlug }
                }
              }
            }
          }
          reviews(first: 100) {
            nodes {
              author { login }
              submittedAt
              state
            }
          }
          reviewRequests(first: 20) {
            nodes {
              requestedReviewer {
                ... on User { login }
                ... on Team { combinedSlug }
              }
            }
          }
        }
      }`;
  });

  const query = `query {${parts.join('\n')}}`;
  const data = await runGraphql<Record<string, { pullRequest: PrDetails | null } | null>>(query);

  return prs.map((_pr, i) => data[`pr${i}`]?.pullRequest ?? null);
}

type TeamPage = Page<{ combinedSlug: string }>;

/**
 * Returns the cursor the page after the given one starts from, or null
 * when the given page is the last one.
 */
function nextCursor(page: Page<unknown>): string | null {
  return page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
}

/**
 * Renders the after argument of a connection for the given cursor, and
 * nothing for the first page.
 */
function afterArgument(cursor: string | null): string {
  return cursor === null ? '' : `, after: ${JSON.stringify(cursor)}`;
}

/**
 * Fetches the combined org/slug names of every team the user belongs to
 * across the organizations the viewer can see, so the classification can
 * tell a review request of one of your teams from one of another team.
 * The lookup goes by the user's login rather than by the repos of the
 * search, because the search often spans every repo the login can see.
 * The organizations and the teams within each are paginated connections,
 * so the lookup follows both to their last page. The first query nests
 * the first team page of every organization, which is all most users
 * need, and a follow-up query per organization fetches the team pages
 * after it, because a nested connection cannot page from inside the list
 * of organizations. The query needs the read:org scope, and a token
 * without it fails here with a CliError, which the caller treats as a
 * soft failure. An answer with a null branch fails the same way instead
 * of reading as fewer teams, because a per-field error nulls the branch
 * it hit and the token path passes such an answer through with its data,
 * and a team missing from the list would hide its review requests for
 * the whole cache period.
 */
export async function fetchUserTeams(user: string): Promise<string[]> {
  const login = JSON.stringify(user);
  const incomplete = () => new CliError(`GitHub GraphQL query for the teams of ${user} returned an incomplete answer`);
  const teams: string[] = [];

  const teamsField = (cursor: string | null) => `teams(first: 100, userLogins: [${login}]${afterArgument(cursor)}) {
    pageInfo { hasNextPage endCursor }
    nodes { combinedSlug }
  }`;

  /**
   * Adds the teams of one page to the list and returns the cursor of the
   * page after it, or null on the last page.
   */
  const readTeams = (page: TeamPage | null | undefined): string | null => {
    if (page === null || page === undefined) {
      throw incomplete();
    }

    for (const team of page.nodes) {
      if (team === null) {
        throw incomplete();
      }

      teams.push(team.combinedSlug);
    }

    return nextCursor(page);
  };

  let organizationCursor: string | null = null;

  do {
    const data = await runGraphql<{
      user: { organizations: Page<{ login: string; teams: TeamPage | null }> | null } | null;
    }>(`query {
      user(login: ${login}) {
        organizations(first: 100${afterArgument(organizationCursor)}) {
          pageInfo { hasNextPage endCursor }
          nodes {
            login
            ${teamsField(null)}
          }
        }
      }
    }`);

    const organizations = data.user?.organizations;

    if (organizations === null || organizations === undefined) {
      throw incomplete();
    }

    for (const organization of organizations.nodes) {
      if (organization === null) {
        throw incomplete();
      }

      let teamCursor = readTeams(organization.teams);

      while (teamCursor !== null) {
        const more = await runGraphql<{ organization: { teams: TeamPage | null } | null }>(`query {
          organization(login: ${JSON.stringify(organization.login)}) {
            ${teamsField(teamCursor)}
          }
        }`);

        teamCursor = readTeams(more.organization?.teams);
      }
    }

    organizationCursor = nextCursor(organizations);
  } while (organizationCursor !== null);

  return teams;
}

/**
 * Fetches the size and comment counters for a batch of authored PRs with
 * one GraphQL call, using the same aliasing approach as fetchPrDetails.
 */
export async function fetchPrSizes(prs: PrRef[]): Promise<(PrSize | null)[]> {
  const parts = prs.map((pr, i) => {
    const [owner, name] = pr.repo.split('/');

    return `
      pr${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
        pullRequest(number: ${pr.number}) {
          additions
          deletions
          changedFiles
          mergedAt
          closedAt
          comments {
            totalCount
          }
          reviews(first: 100) {
            nodes {
              author { login }
              submittedAt
              comments {
                totalCount
              }
            }
          }
        }
      }`;
  });

  const query = `query {${parts.join('\n')}}`;
  const data = await runGraphql<Record<string, { pullRequest: PrSize | null } | null>>(query);

  return prs.map((pr, i) => data[`pr${i}`]?.pullRequest ?? null);
}

/**
 * One piece of text on a PR that can carry a mention. The id is the
 * GraphQL node id, which identifies the text across loads. The creation
 * time is when the text was written, the publication time is when it
 * became visible to others, which differs from the creation time for a
 * review comment drafted before its review was submitted, and the edit
 * time is the last time its author changed it. GitHub leaves the
 * publication and edit times null when they never happened. A deleted
 * account leaves the author null.
 */
export interface MentionSource {
  id: string;
  body: string;
  createdAt: string;
  publishedAt: string | null;
  lastEditedAt: string | null;
  author: { login: string } | null;
}

/**
 * One submitted or pending review with the inline comments that were
 * filed with it. A review that exists but was never submitted has no
 * submission time, and its comments are drafts nobody else can see.
 */
export interface MentionReview {
  id: string;
  body: string;
  submittedAt: string | null;
  lastEditedAt: string | null;
  author: { login: string } | null;
  comments: MentionSource[];
}

/**
 * Every text of one PR that can mention someone, with every list fetched
 * to completion. The PR body is the first source, the conversation
 * comments carry their own times, and each review nests the inline
 * comments that were filed with it. GitHub records a reply on a diff
 * thread as a review of its own with one comment, so the nested lists
 * reach replies too.
 */
export interface PrMentionDetails extends MentionSource {
  comments: MentionSource[];
  reviews: MentionReview[];
}

/**
 * One page of a paginated GraphQL connection, reduced to the cursor
 * fields and the nodes the team and mention queries read.
 */
interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: (T | null)[];
}

interface RawMentionReview extends Omit<MentionReview, 'comments'> {
  comments: Page<MentionSource>;
}

interface RawMentionDetails extends MentionSource {
  comments: Page<MentionSource>;
  reviews: Page<RawMentionReview>;
}

/**
 * Selects the fields of one text that can carry a mention. Every text
 * type implements the Comment interface, so one fragment serves the PR
 * body, the conversation comments, the review bodies, and the inline
 * review comments alike.
 */
const MENTION_TEXT_FRAGMENT = `
  fragment MentionText on Comment {
    id
    body
    createdAt
    publishedAt
    lastEditedAt
    author { login }
  }`;

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }';

/**
 * Sizes of the first page of each list. Together they bound the cost of
 * one batched call, because GitHub charges by the nodes a query can
 * return. Twenty-five PRs with these sizes stay under thirty thousand
 * nodes, a few hundred rate-limit points. The follow-up pages that
 * complete a list beyond its first page are rare and fetched per PR.
 */
const COMMENTS_PAGE = 100;
const REVIEWS_PAGE = 50;
const REVIEW_COMMENTS_PAGE = 20;

/**
 * Builds the selection of one page of a text list, with a cursor to
 * continue from when given.
 */
function textPage(field: string, size: number, after?: string): string {
  const cursor = after === undefined ? '' : `, after: ${JSON.stringify(after)}`;

  return `${field}(first: ${size}${cursor}) { ${PAGE_INFO} nodes { ...MentionText } }`;
}

/**
 * Builds the selection of one page of the reviews list with the first
 * page of each review's inline comments nested inside.
 */
function reviewsPage(after?: string): string {
  const cursor = after === undefined ? '' : `, after: ${JSON.stringify(after)}`;

  return `reviews(first: ${REVIEWS_PAGE}${cursor}) {
    ${PAGE_INFO}
    nodes {
      id
      body
      submittedAt
      lastEditedAt
      author { login }
      ${textPage('comments', REVIEW_COMMENTS_PAGE)}
    }
  }`;
}

function pullRequestSelection(pr: PrRef, selection: string): string {
  const [owner, name] = pr.repo.split('/');

  return `repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    pullRequest(number: ${pr.number}) { ${selection} }
  }`;
}

/**
 * Fetches the pages beyond the first of every list on one PR until each
 * list is complete, appending the nodes in place. Every round asks for
 * the next page of each list that still has one in a single call, and
 * a review that arrives with an incomplete comment list gets its
 * remaining comments in the following round through its node id. Most
 * PRs never reach this, because their lists fit the first page. Returns
 * false when a page did not come back, because the PR then cannot be
 * read in full and a result that misses texts must not be cached as a
 * PR without a mention.
 */
async function completeMentionPages(pr: PrRef, raw: RawMentionDetails): Promise<boolean> {
  for (;;) {
    const parts: string[] = [];

    if (raw.comments.pageInfo.hasNextPage) {
      const after = raw.comments.pageInfo.endCursor ?? undefined;

      parts.push(`comments: ${pullRequestSelection(pr, textPage('comments', COMMENTS_PAGE, after))}`);
    }

    if (raw.reviews.pageInfo.hasNextPage) {
      parts.push(`reviews: ${pullRequestSelection(pr, reviewsPage(raw.reviews.pageInfo.endCursor ?? undefined))}`);
    }

    const incompleteReviews: number[] = [];

    for (const [i, review] of raw.reviews.nodes.entries()) {
      if (review?.comments.pageInfo.hasNextPage) {
        const after = review.comments.pageInfo.endCursor ?? undefined;
        const page = textPage('comments', COMMENTS_PAGE, after);

        incompleteReviews.push(i);
        parts.push(`review${i}: node(id: ${JSON.stringify(review.id)}) { ... on PullRequestReview { ${page} } }`);
      }
    }

    if (parts.length === 0) {
      return true;
    }

    const query = `query {${parts.join('\n')}}\n${MENTION_TEXT_FRAGMENT}`;

    const data =
      await runGraphql<
        Record<string, { comments?: Page<MentionSource>; pullRequest?: Partial<RawMentionDetails> | null } | null>
      >(query);

    const pages: [Page<unknown>, Page<unknown> | undefined][] = [];

    if (raw.comments.pageInfo.hasNextPage) {
      pages.push([raw.comments, data.comments?.pullRequest?.comments]);
    }

    if (raw.reviews.pageInfo.hasNextPage) {
      pages.push([raw.reviews, data.reviews?.pullRequest?.reviews]);
    }

    for (const i of incompleteReviews) {
      const review = raw.reviews.nodes[i];

      if (review != null) {
        pages.push([review.comments, data[`review${i}`]?.comments]);
      }
    }

    if (pages.some(([, next]) => next === undefined)) {
      return false;
    }

    /**
     * The reviews a new page brings keep their own paging state, so the
     * next round picks up their remaining comments.
     */
    for (const [list, next] of pages) {
      appendPage(list, next);
    }
  }
}

/**
 * Appends the nodes of the next page to the list in place and takes over
 * its paging state.
 */
function appendPage<T>(list: Page<T>, next: Page<T> | undefined): void {
  if (next !== undefined) {
    list.nodes.push(...next.nodes);
    list.pageInfo = next.pageInfo;
  }
}

function present<T>(nodes: (T | null)[]): T[] {
  return nodes.filter((node): node is T => node !== null);
}

/**
 * Fetches every text that can mention someone for a batch of PRs. The
 * first pages of all lists come in one GraphQL call, using the same
 * aliasing approach as fetchPrDetails, and the PRs whose lists run past
 * their first page get the remaining pages afterwards, so a mention
 * beyond the first page cannot go missing. The follow-up pages of a
 * batch run one after another, so a batch never has more than one call
 * in flight and the batch gate in the data module keeps bounding the
 * requests of the whole process. A PR the token cannot read, or whose
 * pages cannot all be read, comes back null. The mention cache keeps the
 * fetch away from PRs without new activity.
 */
export async function fetchPrMentionDetails(prs: PrRef[]): Promise<(PrMentionDetails | null)[]> {
  const parts = prs.map((pr, i) => {
    const selection = `...MentionText ${textPage('comments', COMMENTS_PAGE)} ${reviewsPage()}`;

    return `pr${i}: ${pullRequestSelection(pr, selection)}`;
  });

  const query = `query {${parts.join('\n')}}\n${MENTION_TEXT_FRAGMENT}`;
  const data = await runGraphql<Record<string, { pullRequest: RawMentionDetails | null } | null>>(query);
  const raws = prs.map((pr, i) => data[`pr${i}`]?.pullRequest ?? null);

  for (const [i, raw] of raws.entries()) {
    if (raw !== null && !(await completeMentionPages(prs[i], raw))) {
      raws[i] = null;
    }
  }

  return raws.map((raw) => {
    if (raw === null) {
      return null;
    }

    return {
      ...raw,
      comments: present(raw.comments.nodes),
      reviews: present(raw.reviews.nodes).map((review) => {
        return { ...review, comments: present(review.comments.nodes) };
      }),
    };
  });
}
