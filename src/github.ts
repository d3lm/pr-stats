import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { CliError, createLimiter, sleep } from './utils';

const execFileAsync = promisify(execFile);

const API_BASE = 'https://api.github.com';

export class RateLimitError extends CliError {
  readonly resetAt: Date | null;

  constructor(message: string, resetAt: Date | null = null) {
    super(message);

    this.resetAt = resetAt;
  }
}

export interface RateLimitWait {
  reason: 'pace' | 'retry';
  until: Date;
}

type WaitListener = (wait: RateLimitWait | null) => void;

let waitListener: WaitListener | null = null;

const activeWaits = new Set<RateLimitWait>();

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
 * GitHub allows thirty search requests per minute, so the default search bound stays below that.
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

export function configureRateLimits(overrides: Partial<RateLimitPolicy>): void {
  policy = { ...policy, ...overrides };
}

async function withRateLimitRetry<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      if (!(error instanceof RateLimitError)) {
        throw error;
      }

      const waitMs = error.resetAt === null ? policy.baseWaitMs * 2 ** attempt : error.resetAt.getTime() - Date.now();

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
  updatedAt: string;
  isDraft: boolean;
  state: string;
}

export interface PrRef {
  repo: string;
  number: number;
}

export interface RequestedReviewer {
  login?: string;
  slug?: string;
  combinedSlug?: string;
}

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
 * The timeline never records when a request was satisfied, so only reviewRequests shows which
 * requests still wait.
 */
export interface PrDetails {
  additions: number;
  deletions: number;
  timelineItems: { nodes: (TimelineNode | null)[] };
  reviews: { nodes: (ReviewNode | null)[] };
  reviewRequests: { nodes: ({ requestedReviewer?: RequestedReviewer | null } | null)[] };
}

/**
 * Review comments are counted per review because GitHub's totalCommentsCount is unreliable.
 */
export interface PrSize {
  additions: number;
  deletions: number;
  changedFiles: number;
  mergedAt: string | null;
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
 * GitHub records an author's inline replies as reviews, so review mode excludes the user's own PRs.
 * The mentions qualifier misses reviews and inline comments, and text search ignores the at sign,
 * so mentioned mode adds a text search whose hits the mention fetch confirms.
 */
export interface SearchArgs {
  user: string;
  sinceIso: string;
  repos: string[];
  includeDrafts: boolean;
  mode: 'review' | 'requested' | 'authored' | 'mentioned';
}

export interface SearchResult {
  items: SearchPrItem[];
  capped: boolean;
}

/**
 * GitHub's search endpoint stops paging at this many results.
 */
export const SEARCH_LIMIT = 1000;

const SEARCH_PAGE_SIZE = 100;

let token: string | undefined;

let ghBinary = 'gh';

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

function gh(args: string[]): Promise<string> {
  return withRateLimitRetry(() => ghOnce(args));
}

/**
 * The gh CLI reports a rate limit only through its stderr text.
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

function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  return withRateLimitRetry(() => apiOnce<T>(path, options));
}

/**
 * GitHub answers a rate-limited GraphQL query with a 200 whose errors carry the RATE_LIMITED type.
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

export async function authFingerprint(): Promise<string> {
  let credential = token;

  if (credential === undefined) {
    const stdout = await gh(['auth', 'token']);

    credential = stdout.trim();
  }

  return createHash('sha256').update(credential).digest('hex').slice(0, 16);
}

export async function fetchCurrentUser(): Promise<string> {
  if (token) {
    const user = await api<{ login: string }>('/user');

    return user.login;
  }

  const stdout = await gh(['api', 'user', '--jq', '.login']);

  return stdout.trim();
}

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

function orGroup(terms: string[]): string {
  return terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`;
}

/**
 * Holds the inclusive bounds of a date qualifier, where a null bound leaves that side open.
 */
interface SearchWindow {
  from: string | null;
  to: string | null;
}

function dateField(mode: SearchArgs['mode']): 'created' | 'updated' {
  return mode === 'mentioned' ? 'updated' : 'created';
}

function initialWindow({ sinceIso, mode }: SearchArgs): SearchWindow {
  return { from: mode === 'requested' ? null : sinceIso, to: null };
}

function dateTerm(field: 'created' | 'updated', { from, to }: SearchWindow): string[] {
  if (from === null && to === null) {
    return [];
  }

  if (to === null) {
    return [`${field}:>=${from}`];
  }

  if (from === null) {
    return [`${field}:<=${to}`];
  }

  return [`${field}:${from}..${to}`];
}

function buildSearchQuery({ user, repos, includeDrafts, mode }: SearchArgs, window: SearchWindow): string {
  const terms = ['type:pr'];
  const date = dateTerm(dateField(mode), window);

  switch (mode) {
    case 'review': {
      terms.push(orGroup([`review-requested:${user}`, `reviewed-by:${user}`]), `-author:${user}`, ...date);

      break;
    }
    case 'requested': {
      terms.push(`review-requested:${user}`, `-author:${user}`, 'is:open', ...date);

      break;
    }
    case 'authored': {
      terms.push(`author:${user}`, ...date);

      break;
    }
    default: {
      terms.push(`(mentions:${user} OR ("@${user}" involves:${user}))`, ...date);
    }
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

const searchRequestTimes: number[] = [];

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
 * The gh search command pages without pacing, and GitHub counts every retry against the search limit.
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
 * Concurrent search paging trips GitHub's secondary rate limits.
 */
const searchGate = createLimiter(1);

/**
 * GitHub search holds no PRs from before its launch, so an open lower bound splits from here.
 */
const SEARCH_EPOCH = '2008-01-01T00:00:00Z';

function searchTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Splits at second precision because that is the finest unit the date qualifiers accept. The newer
 * half keeps an open upper bound, so a PR that appears or updates during the load still matches.
 */
function splitWindow(window: SearchWindow, now: number): [SearchWindow, SearchWindow] | null {
  const from = Date.parse(window.from ?? SEARCH_EPOCH);
  const to = window.to === null ? now : Date.parse(window.to);
  const middle = Math.floor((from + to) / 2000) * 1000;

  if (middle + 1000 > to) {
    return null;
  }

  return [
    { from: window.from, to: searchTime(middle) },
    { from: searchTime(middle + 1000), to: window.to },
  ];
}

interface Collected {
  items: Map<string, SearchApiItem>;
  capped: boolean;
}

/**
 * Collects the older half first, because an update during the load only moves a PR into a newer
 * window, where the later collection finds it again instead of missing it.
 */
async function collectWindow(
  args: SearchArgs,
  params: Record<string, string>,
  window: SearchWindow,
  collected: Collected,
): Promise<void> {
  const query = { q: buildSearchQuery(args, window), ...params };
  const first = await fetchSearchPage({ ...query, page: '1' });

  if (first.total_count > SEARCH_LIMIT) {
    const halves = splitWindow(window, Date.now());

    if (halves !== null) {
      await collectWindow(args, params, halves[0], collected);
      await collectWindow(args, params, halves[1], collected);

      return;
    }

    collected.capped = true;
  }

  let result = first;
  let fetched = 0;

  for (let page = 1; ; page++) {
    if (page > 1) {
      result = await fetchSearchPage({ ...query, page: String(page) });
    }

    for (const item of result.items) {
      collected.items.set(item.html_url, item);
    }

    fetched += result.items.length;

    if (result.items.length === 0 || fetched >= result.total_count || page >= SEARCH_LIMIT / SEARCH_PAGE_SIZE) {
      break;
    }
  }
}

/**
 * A search with more results than GitHub pages through runs again over halves of its date range
 * until every part fits, and reports capped only when a single second holds too many.
 */
export function searchPrs(args: SearchArgs): Promise<SearchResult> {
  return searchGate(async () => {
    const params: Record<string, string> = {
      advanced_search: 'true',
      per_page: String(SEARCH_PAGE_SIZE),
      // relevance ranking of a text search shifts between pages, which drops and repeats items
      ...(args.mode === 'mentioned' ? { sort: 'updated', order: 'desc' } : {}),
    };

    const collected: Collected = { items: new Map(), capped: false };

    await collectWindow(args, params, initialWindow(args), collected);

    return {
      items: [...collected.items.values()].map((item) => {
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
      capped: collected.capped,
    };
  });
}

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

function nextCursor(page: Page<unknown>): string | null {
  return page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
}

function afterArgument(cursor: string | null): string {
  return cursor === null ? '' : `, after: ${JSON.stringify(cursor)}`;
}

/**
 * A partial answer throws because a missing team would hide its review requests for the
 * whole cache period.
 */
export async function fetchUserTeams(user: string): Promise<string[]> {
  const login = JSON.stringify(user);
  const incomplete = () => new CliError(`GitHub GraphQL query for the teams of ${user} returned an incomplete answer`);
  const teams: string[] = [];

  const teamsField = (cursor: string | null) => `teams(first: 100, userLogins: [${login}]${afterArgument(cursor)}) {
    pageInfo { hasNextPage endCursor }
    nodes { combinedSlug }
  }`;

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
 * The publishedAt time differs from createdAt for a review comment drafted before its
 * review was submitted.
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
 * A review without submittedAt is pending, and its comments are drafts nobody else can see.
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
 * GitHub records a reply on a diff thread as its own review with one comment.
 */
export interface PrMentionDetails extends MentionSource {
  comments: MentionSource[];
  reviews: MentionReview[];
}

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

// the GitHub GraphQL API charges a query by the nodes it can return
const COMMENTS_PAGE = 100;
const REVIEWS_PAGE = 50;
const REVIEW_COMMENTS_PAGE = 20;

function textPage(field: string, size: number, after?: string): string {
  const cursor = after === undefined ? '' : `, after: ${JSON.stringify(after)}`;

  return `${field}(first: ${size}${cursor}) { ${PAGE_INFO} nodes { ...MentionText } }`;
}

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

    for (const [list, next] of pages) {
      appendPage(list, next);
    }
  }
}

function appendPage<T>(list: Page<T>, next: Page<T> | undefined): void {
  if (next !== undefined) {
    list.nodes.push(...next.nodes);

    list.pageInfo = next.pageInfo;
  }
}

function present<T>(nodes: (T | null)[]): T[] {
  return nodes.filter((node): node is T => node !== null);
}

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
