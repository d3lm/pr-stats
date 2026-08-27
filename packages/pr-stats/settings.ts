import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir, cacheEnabled, writeFileAtomic } from './cache';
import type { CliValues } from './flags';
import { CliError } from './utils';

/**
 * Shape of settings.json in the cache directory. Unlike the cached data
 * and the saved options, the file is meant to be edited by hand, so it
 * carries no version wrapper and a rewrite preserves keys this interface
 * does not know about.
 */
export interface Settings {
  /**
   * Mirrors the --no-cache flag. While set, every load refetches instead
   * of reading the cached PRs, and fresh results still update the cache.
   */
  noCache?: boolean;
  /**
   * Holds the theme, the active preset (a built-in name or custom) plus
   * the colors that form the custom theme. The theme module validates
   * and applies it.
   */
  theme?: unknown;
}

/**
 * Resolves the path of the settings file. The settings dialog shows it on
 * the reset row.
 */
export function settingsFile(): string {
  return join(cacheDir(), 'settings.json');
}

/**
 * Holds the settings the last loadSettings call read, so saveNoCache can
 * rewrite the file without dropping the other keys it holds.
 */
let current: Settings = {};

/**
 * Reads settings.json from the cache directory. Returns empty settings
 * while the cache is disabled, so debug runs and tests never read the
 * real file, and when no file exists. A file that is not valid JSON or
 * holds the wrong types throws a CliError, because the file is edited by
 * hand and a silent fallback would hide the mistake.
 */
export function loadSettings(): Settings {
  current = {};

  if (!cacheEnabled()) {
    return current;
  }

  let text: string;

  try {
    text = readFileSync(settingsFile(), 'utf8');
  } catch {
    return current;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliError(`${settingsFile()} is not valid JSON`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliError(`${settingsFile()} must hold a JSON object`);
  }

  const settings = parsed as Settings;

  if (settings.noCache !== undefined && typeof settings.noCache !== 'boolean') {
    throw new CliError(`"noCache" in ${settingsFile()} must be true or false`);
  }

  current = settings;

  return current;
}

/**
 * Persists the noCache setting to settings.json, keeping every other key
 * the file holds, including a hand-written theme. Returns false without
 * writing while the cache is disabled, which keeps debug runs from
 * writing settings.
 */
export function saveNoCache(on: boolean): boolean {
  current = { ...current, noCache: on };

  if (!cacheEnabled()) {
    return false;
  }

  writeFileAtomic(settingsFile(), `${JSON.stringify(current, null, 2)}\n`);

  return true;
}

/**
 * Persists the theme to settings.json, keeping every other key the file
 * holds. An undefined value removes the theme key, which happens when the
 * settings dialog lands back on the default theme without overrides.
 * Returns false without writing while the cache is disabled, which keeps
 * debug runs from writing settings.
 */
export function saveTheme(value: unknown): boolean {
  current = { ...current };

  if (value === undefined) {
    delete current.theme;
  } else {
    current.theme = value;
  }

  if (!cacheEnabled()) {
    return false;
  }

  writeFileAtomic(settingsFile(), `${JSON.stringify(current, null, 2)}\n`);

  return true;
}

/**
 * Deletes the settings file, so future runs start from the defaults. The
 * settings already loaded keep applying to the running session, and a
 * later saveNoCache writes a fresh file that only holds the toggle.
 * Returns false without touching anything while the cache is disabled,
 * which keeps debug runs away from the real file.
 */
export function resetSettings(): boolean {
  if (!cacheEnabled()) {
    return false;
  }

  current = {};

  rmSync(settingsFile(), { force: true });

  return true;
}

/**
 * Loads the settings and merges them into freshly parsed CLI values. The
 * noCache setting only fills in when --no-cache was not given, so the
 * flag always wins. Call this after configureCache, because a disabled
 * cache reads no settings.
 */
export function applySettings(values: CliValues, explicit: Set<string>): Settings {
  const settings = loadSettings();

  if (!explicit.has('no-cache') && settings.noCache === true) {
    values['no-cache'] = true;
  }

  return settings;
}
