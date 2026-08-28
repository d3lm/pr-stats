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

export interface PrDetails {
  timelineItems: { nodes: (TimelineNode | null)[] };
  reviews: { nodes: (ReviewNode | null)[] };
}

/**
 * Size and comment counters of one authored PR. The comments connection
 * counts the conversation comments, and each review node carries the
 * count of its inline comments, so the sum over the nodes is the number
 * of review comments. GitHub's aggregate totalCommentsCount field is
 * unreliable, which is why the two sources are fetched separately. The
 * merge and close timestamps ride along because the search endpoints
 * only report open or closed and cannot tell a merge from a plain close.
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
  reviews: { nodes: ({ comments: { totalCount: number } } | null)[] };
}

export interface SearchArgs {
  user: string;
  sinceIso: string;
  repos: string[];
  includeDrafts: boolean;
  mode: 'requested' | 'reviewed' | 'authored';
}

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
  draft: boolean;
  state: string;
}

/**
 * Mirrors the gh search through the REST search endpoint. The endpoint
 * returns at most 100 items per page and caps out at 1000 results, which
 * matches the limit the gh path uses. Items map onto the field names the
 * gh --json output produces, so both paths return the same shape.
 */
async function searchPrsViaApi({ user, sinceIso, repos, includeDrafts, mode }: SearchArgs): Promise<SearchPrItem[]> {
  const qualifier = {
    requested: 'review-requested',
    reviewed: 'reviewed-by',
    authored: 'author',
  }[mode];

  const terms = ['type:pr', `${qualifier}:${user}`, `created:>=${sinceIso}`];

  if (!includeDrafts) {
    terms.push('draft:false');
  }

  for (const repo of repos) {
    terms.push(`repo:${repo}`);
  }

  const query = encodeURIComponent(terms.join(' '));
  const items: SearchApiItem[] = [];

  for (let page = 1; page <= 10; page++) {
    const result = await api<{ items: SearchApiItem[]; total_count: number }>(
      `/search/issues?q=${query}&per_page=100&page=${page}`,
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
      isDraft: item.draft,
      state: item.state,
    };
  });
}

export async function searchPrs({ user, sinceIso, repos, includeDrafts, mode }: SearchArgs): Promise<SearchPrItem[]> {
  if (token) {
    return searchPrsViaApi({ user, sinceIso, repos, includeDrafts, mode });
  }

  const modeFlag = {
    requested: '--review-requested',
    reviewed: '--reviewed-by',
    authored: '--author',
  }[mode];

  const args = [
    'search',
    'prs',
    modeFlag,
    user,
    '--created',
    `>=${sinceIso}`,
    '--limit',
    '1000',
    '--json',
    'number,repository,title,url,createdAt,isDraft,state',
  ];

  if (!includeDrafts) {
    args.push('--draft=false');
  }

  for (const repo of repos) {
    args.push('--repo', repo);
  }

  return JSON.parse(await gh(args)) as SearchPrItem[];
}

/**
 * Fetches review requests and reviews for a batch of PRs with one GraphQL
 * call. Aliases keep the batch inside a single query.
 */
export async function fetchPrDetails(prs: PrRef[]): Promise<(PrDetails | null)[]> {
  const parts = prs.map((pr, i) => {
    const [owner, name] = pr.repo.split('/');

    return `
      pr${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
        pullRequest(number: ${pr.number}) {
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
