import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Version of the on-disk format. A file written with a different version
 * is discarded, so schema changes only need a bump here. Version 2 added
 * the merge and close timestamps to the size entries. Version 3 added the
 * review authors to the size entries. Version 4 added the PR size to the
 * review details.
 */
const VERSION = 4;

let enabled = false;

/**
 * Turns the on-disk PR cache on or off for the whole process. The cache
 * starts disabled so tests and other direct consumers never touch the real
 * cache directory. The TUI entry point enables it unless --debug is set,
 * because canned debug data must not pollute the cache.
 */
export function configureCache(on: boolean): void {
  enabled = on;
}

/**
 * Reports whether the on-disk cache is enabled for this process. The
 * settings module checks it before touching settings.json, which lives in
 * the cache directory next to the cached data.
 */
export function cacheEnabled(): boolean {
  return enabled;
}

/**
 * Resolves the directory the cache files live in. The PR_STATS_CACHE_DIR
 * environment variable overrides the platform default, which is
 * ~/Library/Caches/pr-stats on macOS and $XDG_CACHE_HOME/pr-stats or
 * ~/.cache/pr-stats elsewhere.
 */
export function cacheDir(): string {
  if (process.env.PR_STATS_CACHE_DIR) {
    return process.env.PR_STATS_CACHE_DIR;
  }

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'pr-stats');
  }

  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'pr-stats');
}

/**
 * Builds the cache key for one PR.
 */
export function prKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

/**
 * Names of the data cache files, the two PR stores, the cached login, and
 * the TUI startup snapshot. This doubles as the list of files clearCache
 * deletes. The saved options live in options.json next to them and the
 * settings in settings.json. Both stay out of this list, because clearing
 * the cached data should not drop the saved preferences.
 */
const CACHE_FILES = ['details', 'sizes', 'user', 'snapshot'] as const;

/**
 * Deletes the cache files from disk, so the next load refetches every PR.
 * Returns false without touching anything while the cache is disabled,
 * which keeps debug runs and tests away from the real cache directory.
 */
export function clearCache(): boolean {
  if (!enabled) {
    return false;
  }

  for (const name of CACHE_FILES) {
    rmSync(join(cacheDir(), `${name}.json`), { force: true });
  }

  return true;
}

/**
 * Writes a file through a temp file and a rename, so a crash mid-write
 * never leaves a truncated file behind. The settings module shares it for
 * settings.json.
 */
export function writeFileAtomic(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true });

  const temporary = `${file}.${process.pid}.tmp`;

  writeFileSync(temporary, contents);
  renameSync(temporary, file);
}

/**
 * Shape of the single-value cache files, which the login and snapshot
 * caches use. The PR stores keep their own entries shape.
 */
interface ValueFile<T> {
  version: number;
  value: T;
}

/**
 * Reads one single-value cache file. Returns null while the cache is
 * disabled and for missing, unreadable, or outdated files. The caller
 * knows the stored shape and casts the result.
 */
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
    // a missing or unreadable file reads as null
  }

  return null;
}

/**
 * Writes one single-value cache file. Returns false without writing while
 * the cache is disabled, so callers can report that nothing was stored.
 */
export function writeCacheFile(name: string, value: unknown): boolean {
  if (!enabled) {
    return false;
  }

  const payload: ValueFile<unknown> = { version: VERSION, value };

  writeFileAtomic(join(cacheDir(), `${name}.json`), JSON.stringify(payload));

  return true;
}

/**
 * How long a cached login stays trusted. The login almost never changes,
 * but the expiry bounds how long a stale login lingers after an account
 * switch. A hard reload refreshes it immediately.
 */
const LOGIN_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedLogin {
  login: string;
  /**
   * Holds the fingerprint of the credentials the login was resolved
   * with. Entries written before the field existed read as undefined and
   * never match, so they fall out like an account switch would.
   */
  auth?: string;
  cachedAt: string;
}

/**
 * Returns the cached login of the authenticated user, or null when the
 * cache is disabled, the entry is missing or expired, or it was written
 * under different credentials than the given fingerprint.
 */
export function readCachedLogin(auth: string): string | null {
  const cached = readCacheFile('user') as CachedLogin | null;

  if (cached?.auth !== auth) {
    return null;
  }

  const age = Date.now() - new Date(cached.cachedAt).getTime();

  return age >= 0 && age < LOGIN_TTL_MS ? cached.login : null;
}

/**
 * Stores the login of the authenticated user with a fresh timestamp,
 * keyed by the fingerprint of the credentials that resolved it.
 */
export function writeCachedLogin(login: string, auth: string): void {
  writeCacheFile('user', { login, auth, cachedAt: new Date().toISOString() } satisfies CachedLogin);
}

interface CacheFile<T> {
  version: number;
  entries: Record<string, T>;
}

/**
 * One on-disk store of per-PR entries keyed by "repo#number". The store
 * loads its file eagerly, collects changes in memory, and writes them back
 * once through save. While the cache is disabled, reads find nothing and
 * writes go nowhere.
 */
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
      // a missing or unreadable file starts the store empty
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

  /**
   * Writes the store back to disk when anything changed.
   */
  save(): void {
    if (this.#file === null || !this.#dirty) {
      return;
    }

    const payload: CacheFile<T> = { version: VERSION, entries: Object.fromEntries(this.#entries) };

    writeFileAtomic(this.#file, JSON.stringify(payload));

    this.#dirty = false;
  }
}
