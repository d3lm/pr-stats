import { CliError } from './utils';

/**
 * GitHub owners and repository names use letters, digits, hyphens, underscores, and dots.
 */
const SEGMENT = /^[\w.*-]+$/;

export function hasWildcard(text: string): boolean {
  return text.includes('*');
}

/**
 * Matches case-insensitively because GitHub treats owner and repository names that way.
 */
export function matchesGlob(pattern: string, text: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replaceAll(/[$()+.?[\\\]^{|}]/g, String.raw`\$&`))
    .join('.*');

  return new RegExp(`^${source}$`, 'i').test(text);
}

/**
 * Returns each entry as `owner/name` where either part may hold `*`, or as a bare name without a
 * wildcard. A bare pattern like `acme*` names owners, so it comes back as `acme*`/`*`.
 */
export function parseRepoEntries(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const parts = entry.split('/');

      if (parts.length > 2 || !parts.every((part) => SEGMENT.test(part))) {
        throw new CliError(`"${entry}" is not a repository, use owner/name, owner/*, or a pattern like acme*`);
      }

      return parts.length === 1 && hasWildcard(entry) ? `${entry}/*` : entry;
    });
}

function ownerOf(repo: string): string {
  return repo.slice(0, repo.indexOf('/')).toLowerCase();
}

/**
 * Lists the owners whose repositories the search has to cover in full, because GitHub search has no
 * wildcard and a name pattern can only narrow its results afterwards.
 */
function patternOwners(repos: string[]): Set<string> {
  return new Set(repos.filter((repo) => hasWildcard(repo)).map((repo) => ownerOf(repo)));
}

/**
 * Expects owners without wildcards, as resolveRepos returns them.
 */
export function searchQualifiers(repos: string[]): string[] {
  const owners = patternOwners(repos);
  const qualifiers = new Set<string>();

  for (const repo of repos) {
    const owner = ownerOf(repo);

    qualifiers.add(owners.has(owner) ? `org:${owner}` : `repo:${repo}`);
  }

  return [...qualifiers];
}

/**
 * Keeps every result of a `repo:` qualifier, and keeps a result of an `org:` qualifier only when
 * one of the patterns for that owner matches its name.
 */
export function repoFilter(repos: string[]): (repo: string) => boolean {
  const owners = patternOwners(repos);

  return (repo) => {
    const owner = ownerOf(repo);

    if (!owners.has(owner)) {
      return true;
    }

    const name = repo.slice(repo.indexOf('/') + 1);

    return repos.some((pattern) => ownerOf(pattern) === owner && matchesGlob(pattern.slice(owner.length + 1), name));
  };
}
