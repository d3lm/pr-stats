import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Files with another version read as missing, so a change to any cached shape needs a bump here.
 */
const VERSION = 5;

/**
 * Starts disabled so tests never touch the real cache directory.
 */
let enabled = false;

export function configureCache(on: boolean): void {
  enabled = on;
}

export function cacheEnabled(): boolean {
  return enabled;
}

export function cacheDir(): string {
  if (process.env.PR_STATS_CACHE_DIR) {
    return process.env.PR_STATS_CACHE_DIR;
  }

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'pr-stats');
  }

  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'pr-stats');
}

export function cacheSize(): number {
  const dir = cacheDir();

  let total = 0;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      try {
        total += statSync(join(dir, entry.name)).size;
      } catch {
        // the file vanished after the listing
      }
    }
  } catch {
    // the directory does not exist yet
  }

  return total;
}

export function prKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

/**
 * Leaves out options, settings, snoozes, and mention read state, which share the directory,
 * so clearing keeps saved preferences.
 */
const CACHE_FILES = ['details', 'sizes', 'mentions', 'user', 'teams', 'snapshot', 'mention-baseline'] as const;

export function clearCache(): boolean {
  if (!enabled) {
    return false;
  }

  for (const name of CACHE_FILES) {
    rmSync(join(cacheDir(), `${name}.json`), { force: true });
  }

  return true;
}

export function writeFileAtomic(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true });

  const temporary = `${file}.${process.pid}.tmp`;

  writeFileSync(temporary, contents);
  renameSync(temporary, file);
}

interface ValueFile<T> {
  version: number;
  value: T;
}

export function readCacheFile(name: string): unknown {
  if (!enabled) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(join(cacheDir(), `${name}.json`), 'utf8')) as ValueFile<unknown>;

    if (parsed.version === VERSION) {
      return parsed.value;
    }
  } catch {
    // the file is missing or unreadable
  }

  return null;
}

export function writeCacheFile(name: string, value: unknown): boolean {
  if (!enabled) {
    return false;
  }

  const payload: ValueFile<unknown> = { version: VERSION, value };

  writeFileAtomic(join(cacheDir(), `${name}.json`), JSON.stringify(payload));

  return true;
}

const LOGIN_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedLogin {
  login: string;
  auth?: string;
  cachedAt: string;
}

export function readCachedLogin(auth: string): string | null {
  const cached = readCacheFile('user') as CachedLogin | null;

  if (cached?.auth !== auth) {
    return null;
  }

  const age = Date.now() - new Date(cached.cachedAt).getTime();

  return age >= 0 && age < LOGIN_TTL_MS ? cached.login : null;
}

export function writeCachedLogin(login: string, auth: string): void {
  writeCacheFile('user', { login, auth, cachedAt: new Date().toISOString() } satisfies CachedLogin);
}

const TEAMS_TTL_MS = 6 * 60 * 60 * 1000;

interface CachedTeams {
  login: string;
  auth: string;
  teams: string[];
  cachedAt: string;
}

export function readCachedTeams(auth: string, login: string): { teams: string[]; fresh: boolean } | null {
  const cached = readCacheFile('teams') as CachedTeams | null;

  if (cached?.auth !== auth || cached.login !== login || !Array.isArray(cached.teams)) {
    return null;
  }

  const age = Date.now() - new Date(cached.cachedAt).getTime();

  return { teams: cached.teams, fresh: age >= 0 && age < TEAMS_TTL_MS };
}

export function writeCachedTeams(teams: string[], login: string, auth: string): void {
  writeCacheFile('teams', { login, auth, teams, cachedAt: new Date().toISOString() } satisfies CachedTeams);
}

interface CacheFile<T> {
  version: number;
  entries: Record<string, T>;
}

export class PrCache<T> {
  #entries = new Map<string, T>();
  #dirty = false;
  readonly #file: string | null;

  constructor(name: string) {
    this.#file = enabled ? join(cacheDir(), `${name}.json`) : null;

    if (this.#file === null) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.#file, 'utf8')) as CacheFile<T>;

      if (parsed.version === VERSION) {
        this.#entries = new Map(Object.entries(parsed.entries));
      }
    } catch {
      // the file is missing or unreadable
    }
  }

  get(key: string): T | undefined {
    return this.#entries.get(key);
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  set(key: string, value: T): void {
    if (this.#file === null) {
      return;
    }

    this.#entries.set(key, value);

    this.#dirty = true;
  }

  delete(key: string): void {
    if (this.#entries.delete(key)) {
      this.#dirty = true;
    }
  }

  save(): void {
    if (this.#file === null || !this.#dirty) {
      return;
    }

    const payload: CacheFile<T> = { version: VERSION, entries: Object.fromEntries(this.#entries) };

    writeFileAtomic(this.#file, JSON.stringify(payload));

    this.#dirty = false;
  }
}
