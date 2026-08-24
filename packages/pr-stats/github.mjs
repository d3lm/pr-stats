import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fail } from './utils.mjs';

const execFileAsync = promisify(execFile);

const API_BASE = 'https://api.github.com';

let token;

/**
 * Picks the auth method for all GitHub calls. A token from the --token flag
 * or the GITHUB_TOKEN/GH_TOKEN environment variables switches the module to
 * direct API calls. Without one, everything goes through the gh CLI.
 */
export function configureAuth(cliToken) {
  token = cliToken ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
}

async function gh(args) {
  try {
    const { stdout } = await execFileAsync('gh', args, {
      maxBuffer: 64 * 1024 * 1024,
    });

    return stdout;
  } catch (error) {
    if (error.code === 'ENOENT') {
      fail('the gh CLI is not installed, install it or provide a token via --token or GITHUB_TOKEN');
    }

    const stderr = error.stderr?.toString().trim();

    fail(`gh ${args.slice(0, 2).join(' ')} failed${stderr ? `\n${stderr}` : ''}`);

    /**
     * Fail() exits the process, so this throw is never reached. It only
     * tells the linter that this branch does not return a value.
     */
    throw error;
  }
}

/**
 * Sends one request to the GitHub API with the configured token and returns
 * the parsed JSON body.
 */
async function api(path, { method = 'GET', body } = {}) {
  let response;

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
    fail(`cannot reach ${API_BASE} (${error.cause?.message ?? error.message})`);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.message ?? '';
    const endpoint = path.split('?')[0];

    fail(`GitHub API ${method} ${endpoint} failed with ${response.status}${message ? ` (${message})` : ''}`);
  }

  return payload;
}

/**
 * Runs a GraphQL query through the configured auth method and returns the
 * data object. Partial data with per-field errors passes through, because
 * the callers already treat missing PRs as inaccessible.
 */
async function runGraphql(query) {
  if (token) {
    const result = await api('/graphql', { method: 'POST', body: { query } });

    if (!result?.data) {
      const message = result?.errors?.[0]?.message;

      fail(`GitHub GraphQL query failed${message ? ` (${message})` : ''}`);
    }

    return result.data;
  }

  const stdout = await gh(['api', 'graphql', '-f', `query=${query}`]);

  return JSON.parse(stdout).data;
}

/**
 * Returns the login of the authenticated user.
 */
export async function fetchCurrentUser() {
  if (token) {
    const user = await api('/user');

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
async function fetchDefaultOwner() {
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
export async function resolveRepos(repos) {
  let defaultOwner;

  const resolved = [];

  for (const repo of repos) {
    if (repo.includes('/')) {
      resolved.push(repo);
      continue;
    }

    if (!defaultOwner) {
      defaultOwner = await fetchDefaultOwner();

      if (!defaultOwner) {
        fail(`cannot resolve owner for "--repo ${repo}", use the owner/name form`);
      }
    }

    resolved.push(`${defaultOwner}/${repo}`);
  }

  return resolved;
}

/**
 * Mirrors the gh search through the REST search endpoint. The endpoint
 * returns at most 100 items per page and caps out at 1000 results, which
 * matches the limit the gh path uses. Items map onto the field names the
 * gh --json output produces, so both paths return the same shape.
 */
async function searchPrsViaApi({ user, sinceIso, repos, includeDrafts, mode }) {
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
  const items = [];

  for (let page = 1; page <= 10; page++) {
    const result = await api(`/search/issues?q=${query}&per_page=100&page=${page}`);

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

export async function searchPrs({ user, sinceIso, repos, includeDrafts, mode }) {
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

  return JSON.parse(await gh(args));
}

/**
 * Fetches review requests and reviews for a batch of PRs with one GraphQL
 * call. Aliases keep the batch inside a single query.
 */
export async function fetchPrDetails(prs) {
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
  const data = await runGraphql(query);

  return prs.map((pr, i) => data[`pr${i}`]?.pullRequest ?? null);
}

/**
 * Fetches the size counters for a batch of authored PRs with one GraphQL
 * call, using the same aliasing approach as fetchPrDetails.
 */
export async function fetchPrSizes(prs) {
  const parts = prs.map((pr, i) => {
    const [owner, name] = pr.repo.split('/');

    return `
      pr${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
        pullRequest(number: ${pr.number}) {
          additions
          deletions
          changedFiles
        }
      }`;
  });

  const query = `query {${parts.join('\n')}}`;
  const data = await runGraphql(query);

  return prs.map((pr, i) => data[`pr${i}`]?.pullRequest ?? null);
}
