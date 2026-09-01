import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir, cacheEnabled, writeFileAtomic } from './cache';
import type { CliValues } from './flags';
import { CliError } from './utils';

/**
 * Channels a desktop notification can go through. Auto asks the terminal
 * to post the notification and falls back to the platform command,
 * terminal and command force one of those paths, and bell rings the
 * terminal bell instead of posting any text. The settings dialog cycles
 * through them in this order.
 */
export const NOTIFY_CHANNELS = ['auto', 'terminal', 'command', 'bell'] as const;

export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

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
   * Makes enter and a click on a PR reference copy the PR's link to the
   * clipboard instead of opening it in the browser.
   */
  copyLinks?: boolean;
  /**
   * Keeps the TUI reloading its data in the background while it runs,
   * with the reloadInterval setting naming the cadence.
   */
  autoReload?: boolean;
  /**
   * Names how long the TUI waits after one load finishes before the
   * next background reload starts, like 30s, 10m, or 2h. The interval
   * only applies while autoReload is set.
   */
  reloadInterval?: string;
  /**
   * Sends a desktop notification when a load finds a PR newly awaiting
   * your review or a review re-requested from you. The first load of a
   * session only records what is already waiting.
   */
  notifications?: boolean;
  /**
   * Picks the channel the notifications go through. With auto the TUI
   * asks the terminal to post them and falls back to the platform
   * command, terminal forces the terminal path, command forces the
   * platform command, osascript on macOS and notify-send on Linux, and
   * bell rings the terminal bell instead of posting any text.
   */
  notifyChannel?: NotifyChannel;
  /**
   * Holds the theme, the active preset (a built-in name or custom) plus
   * the colors that form the custom theme. The theme module validates
   * and applies it.
   */
  theme?: unknown;
}

/**
 * Interval the auto-reload setting runs on until the user picks one.
 */
export const DEFAULT_RELOAD_INTERVAL = '10m';

/**
 * Longest interval the auto-reload setting accepts. A timer delay must
 * fit in a 32-bit signed integer, and a day sits well inside that while
 * still covering any cadence a TUI left running would want.
 */
const MAX_RELOAD_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Converts a reload interval like 30s, 10m, or 2h into milliseconds, or
 * returns null for anything else, including intervals shorter than a
 * second or longer than a day.
 */
export function reloadIntervalMs(input: string): number | null {
  const match = /^(\d+)([smh])$/.exec(input);

  if (match === null) {
    return null;
  }

  const ms = Number(match[1]) * (match[2] === 'h' ? 3_600_000 : match[2] === 'm' ? 60_000 : 1000);

  return ms >= 1000 && ms <= MAX_RELOAD_INTERVAL_MS ? ms : null;
}

/**
 * Parses a reload interval into milliseconds, throwing a CliError that
 * names the accepted forms for anything reloadIntervalMs refuses. The
 * settings dialog validates interval edits with it.
 */
export function parseReloadInterval(input: string): number {
  const ms = reloadIntervalMs(input);

  if (ms === null) {
    throw new CliError(`invalid reload interval "${input}", use a value from 1s to 24h like 30s, 10m, or 2h`);
  }

  return ms;
}

/**
 * Resolves the path of the settings file. The settings dialog shows it on
 * the reset row.
 */
export function settingsFile(): string {
  return join(cacheDir(), 'settings.json');
}

/**
 * Holds the settings the last loadSettings call read, so the save
 * functions can rewrite the file without dropping the other keys it
 * holds.
 */
let current: Settings = {};

/**
 * Writes the current settings to settings.json. Returns false without
 * writing while the cache is disabled, which keeps debug runs from
 * writing settings.
 */
function writeCurrent(): boolean {
  if (!cacheEnabled()) {
    return false;
  }

  writeFileAtomic(settingsFile(), `${JSON.stringify(current, null, 2)}\n`);

  return true;
}

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

  if (settings.copyLinks !== undefined && typeof settings.copyLinks !== 'boolean') {
    throw new CliError(`"copyLinks" in ${settingsFile()} must be true or false`);
  }

  if (settings.autoReload !== undefined && typeof settings.autoReload !== 'boolean') {
    throw new CliError(`"autoReload" in ${settingsFile()} must be true or false`);
  }

  if (
    settings.reloadInterval !== undefined &&
    (typeof settings.reloadInterval !== 'string' || reloadIntervalMs(settings.reloadInterval) === null)
  ) {
    throw new CliError(
      `"reloadInterval" in ${settingsFile()} must be an interval from 1s to 24h like "30s", "10m", or "2h"`,
    );
  }

  if (settings.notifications !== undefined && typeof settings.notifications !== 'boolean') {
    throw new CliError(`"notifications" in ${settingsFile()} must be true or false`);
  }

  if (settings.notifyChannel !== undefined && !NOTIFY_CHANNELS.includes(settings.notifyChannel)) {
    throw new CliError(`"notifyChannel" in ${settingsFile()} must be "auto", "terminal", "command", or "bell"`);
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

  return writeCurrent();
}

/**
 * Persists the copy-links setting to settings.json, keeping every other
 * key the file holds. Returns false without writing while the cache is
 * disabled, which keeps debug runs from writing settings.
 */
export function saveCopyLinks(on: boolean): boolean {
  current = { ...current, copyLinks: on };

  return writeCurrent();
}

/**
 * Persists the auto-reload toggle to settings.json, keeping every other
 * key the file holds, the saved interval included, so turning the reload
 * back on resumes the cadence it had. Returns false without writing while
 * the cache is disabled, which keeps debug runs from writing settings.
 */
export function saveAutoReload(on: boolean): boolean {
  current = { ...current, autoReload: on };

  return writeCurrent();
}

/**
 * Persists an already validated reload interval to settings.json, keeping
 * every other key the file holds. Returns false without writing while the
 * cache is disabled, which keeps debug runs from writing settings.
 */
export function saveReloadInterval(value: string): boolean {
  current = { ...current, reloadInterval: value };

  return writeCurrent();
}

/**
 * Persists the notifications toggle to settings.json, keeping every
 * other key the file holds. Returns false without writing while the
 * cache is disabled, which keeps debug runs from writing settings.
 */
export function saveNotifications(on: boolean): boolean {
  current = { ...current, notifications: on };

  return writeCurrent();
}

/**
 * Persists the notification channel to settings.json, keeping every
 * other key the file holds. Returns false without writing while the
 * cache is disabled, which keeps debug runs from writing settings.
 */
export function saveNotifyChannel(channel: NotifyChannel): boolean {
  current = { ...current, notifyChannel: channel };

  return writeCurrent();
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

  return writeCurrent();
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
