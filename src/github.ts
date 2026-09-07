import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { CliError } from './utils';

const execFileAsync = promisify(execFile);

const API_BASE = 'https://api.github.com';

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
 * One node of the review-request timeline. The requestedReviewer is a
 * User or Team union in the API, so both the login and the slug are
 * optional.
 */
export interface TimelineNode {
  createdAt: string;
  requestedReviewer?: { login?: string; slug?: string } | null;
}

export interface ReviewNode {
  author: { login: string } | null;
  submittedAt: string | null;
  state: string;
}

/**
 * Review timeline and size of one PR on your reviewing plate. The
 * additions and deletions ride along for the review-time-vs-size
 * scatter and hold the PR's size at fetch time, not at review time.
 */
export interface PrDetails {
  additions: number;
  deletions: number;
  timelineItems: { nodes: (TimelineNode | null)[] };
  reviews: { nodes: (ReviewNode | null)[] };
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
 * Arguments of one PR search. The requested and reviewed modes cover PRs
 * other people authored and exclude the user's own, because GitHub
 * records an author's inline replies as reviews, so a plain reviewed-by
 * search returns your own PRs whenever you answered a comment on them.
 * The mentioned mode finds the PRs whose texts name the user, the user's
 * own PRs included, because a mention asks for attention no matter who
 * opened the PR. It also keeps drafts and filters on the last update
 * instead of the creation date, because a fresh mention on an old PR is
 * exactly what it looks for.
 *
 * The mentioned mode runs two queries and unites their results. The
 * first uses the mentions qualifier, whose index only covers the PR body
 * and the conversation comments, so a mention that sits in a review body
 * or an inline review comment never reaches it. The second searches the
 * login as text, which the text index finds in reviews and inline
 * comments too, but which also misses conversation comments the mentions
 * index has, so neither query replaces the other. The text search drops
 * the at sign, so on its own it would match every PR that carries the
 * login anywhere, which for a login that is also a common word means
 * hundreds of thousands of PRs. The involves qualifier bounds it to the
 * PRs the user authored, commented on, reviewed, or is indexed as
 * mentioned on. A mention in a review of a PR the user has only been
 * asked to review, or has nothing to do with, still stays out, because
 * no search qualifier reaches those texts. The mention fetch then
 * confirms every hit against the texts, so a PR that carries the login
 * without an at sign drops out there.
 */
export interface SearchArgs {
  user: string;
  sinceIso: string;
  repos: string[];
  includeDrafts: boolean;
  mode: 'requested' | 'reviewed' | 'authored' | 'mentioned';
}

/**
 * Result of one search, the PRs it found and whether any query behind it
 * reached the result cap. The cap is judged per query and not on the
 * united list, because the mentioned mode unites two queries whose
 * complete results can add up past the cap without either being cut.
 */
export interface SearchResult {
  items: SearchPrItem[];
  capped: boolean;
}

/**
 * Most results one query returns. The gh CLI accepts it as its limit and
 * the REST endpoint stops at the same count, so a query that returns
 * this many items may have been cut and the load warns about it.
 */
export const SEARCH_LIMIT = 1000;

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
 * every token, so all data comes from canned responses instead of GitHub.
 */
export function configureAuth(cliToken?: string, debugPath?: string): void {
  if (debugPath !== undefined) {
    ghBinary = resolveDebugBinary(debugPath);
    token = undefined;
    return;
  }

  ghBinary = 'gh';
  token = cliToken ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
}

async function gh(args: string[]): Promise<string> {
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

    throw new CliError(`gh ${args.slice(0, 2).join(' ')} failed${stderr ? `\n${stderr}` : ''}`);
  }
}

/**
 * Sends one request to the GitHub API with the configured token and returns
 * the parsed JSON body.
 */
async function api<T>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
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

  if (!response.ok) {
    /**
     * GitHub error responses carry a JSON body whose message names the
     * actual problem, so read it here to enrich the error.
     */
    const payload: unknown = await response.json().catch(() => null);
    const message = (payload as { message?: string } | null)?.message ?? '';
    const endpoint = path.split('?')[0];

    throw new CliError(
      `GitHub API ${method} ${endpoint} failed with ${response.status}${message ? ` (${message})` : ''}`,
    );
  }

  return (await response.json().catch(() => null)) as T;
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
 * Reports whether a search mode excludes the user's own PRs. Only the two
 * review searches do, see SearchArgs.
 */
function excludesOwnPrs(mode: SearchArgs['mode']): boolean {
  return mode === 'requested' || mode === 'reviewed';
}

/**
 * One query of a search. The three review and authored modes run one
 * query each, and the mentioned mode runs the indexed one, which asks the
 * mentions index, and the text one, which searches the login as text
 * among the PRs the user is involved in, see SearchArgs.
 */
type SearchQuery = 'requested' | 'reviewed' | 'authored' | 'mentioned' | 'mentionedText';

interface QueryArgs extends Omit<SearchArgs, 'mode'> {
  query: SearchQuery;
}

/**
 * Reports whether a query looks for mentions, which filters on the
 * update time, keeps drafts, and sorts by the update time for stable
 * pages.
 */
function isMentionQuery(query: SearchQuery): query is 'mentioned' | 'mentionedText' {
  return query === 'mentioned' || query === 'mentionedText';
}

/**
 * Builds the quoted text term of the text mention query, the login
 * behind an at sign, see SearchArgs.
 */
function mentionTerm(user: string): string {
  return `"@${user}"`;
}

/**
 * Mirrors the gh search through the REST search endpoint. The endpoint
 * returns at most 100 items per page and caps out at 1000 results, which
 * matches the limit the gh path uses. Items map onto the field names the
 * gh --json output produces, so both paths return the same shape. The
 * mention queries sort by the update time, because a text search ranks
 * by relevance otherwise and that ranking shifts between pages, which
 * drops and repeats items across them.
 */
async function searchPrsViaApi({ user, sinceIso, repos, includeDrafts, query }: QueryArgs): Promise<SearchPrItem[]> {
  const terms = ['type:pr'];

  if (query === 'mentioned') {
    terms.push(`mentions:${user}`, `updated:>=${sinceIso}`);
  } else if (query === 'mentionedText') {
    terms.push(mentionTerm(user), `involves:${user}`, `updated:>=${sinceIso}`);
  } else {
    const qualifier = { requested: 'review-requested', reviewed: 'reviewed-by', authored: 'author' }[query];

    terms.push(`${qualifier}:${user}`, `created:>=${sinceIso}`);
  }

  const mode = isMentionQuery(query) ? 'mentioned' : query;

  if (excludesOwnPrs(mode)) {
    terms.push(`-author:${user}`);
  }

  if (!includeDrafts && mode !== 'mentioned') {
    terms.push('draft:false');
  }

  for (const repo of repos) {
    terms.push(`repo:${repo}`);
  }

  const encoded = encodeURIComponent(terms.join(' '));
  const sort = mode === 'mentioned' ? '&sort=updated&order=desc' : '';
  const items: SearchApiItem[] = [];

  for (let page = 1; page <= SEARCH_LIMIT / 100; page++) {
    const result = await api<{ items: SearchApiItem[]; total_count: number }>(
      `/search/issues?q=${encoded}${sort}&per_page=100&page=${page}`,
    );

    items.push(...result.items);

    if (result.items.length === 0 || items.length >= result.total_count) {
      break;
    }
  }

  return items.map((item) => {
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
  });
}

/**
 * Runs the queries of a search, the two mention queries for the mentioned
 * mode and one query otherwise, and unites their results. A PR both
 * mention queries return counts once, with the later update time, so the
 * mention cache keys it on the newest activity either query saw. The
 * search counts as capped when any of its queries returned the limit,
 * which is judged before the union, see SearchResult.
 */
export async function searchPrs({ user, sinceIso, repos, includeDrafts, mode }: SearchArgs): Promise<SearchResult> {
  const queries: SearchQuery[] = mode === 'mentioned' ? ['mentioned', 'mentionedText'] : [mode];

  const results = await Promise.all(
    queries.map((query) => {
      return searchOnce({ user, sinceIso, repos, includeDrafts, query });
    }),
  );

  const capped = results.some((items) => items.length >= SEARCH_LIMIT);

  if (results.length === 1) {
    return { items: results[0], capped };
  }

  const byRef = new Map<string, SearchPrItem>();

  for (const item of results.flat()) {
    const ref = `${item.repository.nameWithOwner}#${item.number}`;
    const known = byRef.get(ref);

    if (known === undefined || item.updatedAt > known.updatedAt) {
      byRef.set(ref, item);
    }
  }

  return { items: [...byRef.values()], capped };
}

/**
 * Runs one query through the REST endpoint with a token and through the
 * gh CLI otherwise.
 */
async function searchOnce({ user, sinceIso, repos, includeDrafts, query }: QueryArgs): Promise<SearchPrItem[]> {
  if (token) {
    return searchPrsViaApi({ user, sinceIso, repos, includeDrafts, query });
  }

  const mode = isMentionQuery(query) ? 'mentioned' : query;

  /**
   * The mention queries sort by the update time for stable pages, see
   * searchPrsViaApi, and the text one passes its term as the positional
   * query.
   */
  const selection =
    query === 'mentioned'
      ? ['--mentions', user, '--updated', `>=${sinceIso}`, '--sort', 'updated', '--order', 'desc']
      : query === 'mentionedText'
        ? [mentionTerm(user), '--involves', user, '--updated', `>=${sinceIso}`, '--sort', 'updated', '--order', 'desc']
        : [
            { requested: '--review-requested', reviewed: '--reviewed-by', authored: '--author' }[query],
            user,
            '--created',
            `>=${sinceIso}`,
          ];

  const args = [
    'search',
    'prs',
    ...selection,
    '--limit',
    String(SEARCH_LIMIT),
    '--json',
    'number,repository,title,url,createdAt,updatedAt,isDraft,state',
  ];

  if (!includeDrafts && mode !== 'mentioned') {
    args.push('--draft=false');
  }

  for (const repo of repos) {
    args.push('--repo', repo);
  }

  /**
   * The gh CLI has no flag that negates the author, so the exclusion goes
   * in as a raw query term behind the flag terminator, which keeps gh from
   * reading the leading dash as a flag.
   */
  if (excludesOwnPrs(mode)) {
    args.push('--', `-author:${user}`);
  }

  return JSON.parse(await gh(args)) as SearchPrItem[];
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
                  ... on Team { slug }
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
        }
      }`;
  });

  const query = `query {${parts.join('\n')}}`;
  const data = await runGraphql<Record<string, { pullRequest: PrDetails | null } | null>>(query);

  return prs.map((pr, i) => data[`pr${i}`]?.pullRequest ?? null);
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
 * One page of a GraphQL connection as the mention queries select it.
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
