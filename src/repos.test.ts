import { expect, test } from 'bun:test';
import { matchesGlob, parseRepoEntries, repoFilter, searchQualifiers } from './repos';
import { CliError } from './utils';

test('parses names, owner/name, owner/*, and patterns, and reads a bare pattern as owners', () => {
  expect(parseRepoEntries(' acme/web , web,acme/*, stackblitz*, acme/web-*,, ')).toEqual([
    'acme/web',
    'web',
    'acme/*',
    'stackblitz*/*',
    'acme/web-*',
  ]);

  expect(parseRepoEntries('')).toEqual([]);
});

test('rejects entries that cannot name a repository', () => {
  for (const entry of ['acme/web/extra', 'acme/', '/web', 'acme web', 'acme/we b', 'org:acme']) {
    expect(() => parseRepoEntries(entry)).toThrow(CliError);
  }
});

test('a pattern matches the whole text case-insensitively and treats only * as special', () => {
  expect(matchesGlob('stackblitz*', 'stackblitz')).toBe(true);
  expect(matchesGlob('stackblitz*', 'StackBlitz-Starters')).toBe(true);
  expect(matchesGlob('stackblitz*', 'my-stackblitz')).toBe(false);
  expect(matchesGlob('*-labs', 'stackblitz-labs')).toBe(true);
  expect(matchesGlob('web.app', 'web.app')).toBe(true);
  expect(matchesGlob('web.app', 'webxapp')).toBe(false);
  expect(matchesGlob('*', 'anything')).toBe(true);
});

test('an owner with any pattern is searched whole, and other repositories by name', () => {
  expect(searchQualifiers(['acme/web', 'acme/api'])).toEqual(['repo:acme/web', 'repo:acme/api']);
  expect(searchQualifiers(['acme/web', 'Acme/*', 'globex/api'])).toEqual(['org:acme', 'repo:globex/api']);
  expect(searchQualifiers(['acme/web-*', 'acme/api-*', 'globex/*'])).toEqual(['org:acme', 'org:globex']);
});

test('the filter narrows only the results of owners searched whole', () => {
  const inScope = repoFilter(['acme/web-*', 'acme/api', 'globex/*', 'initech/tps']);

  expect(inScope('acme/web-client')).toBe(true);
  expect(inScope('acme/api')).toBe(true);
  expect(inScope('acme/billing')).toBe(false);
  expect(inScope('globex/anything')).toBe(true);
  expect(inScope('initech/tps')).toBe(true);
  expect(inScope('elsewhere/repo')).toBe(true);
});
