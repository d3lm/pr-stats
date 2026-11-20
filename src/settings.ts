import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir, cacheEnabled, writeFileAtomic } from './cache';
import type { CliValues } from './flags';
import { snoozeDurationMs } from './snooze';
import { CliError } from './utils';

export const NOTIFY_CHANNELS = ['auto', 'terminal', 'command', 'bell'] as const;

export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

export const LINK_TARGETS = ['github', 'linear'] as const;

export type LinkTarget = (typeof LINK_TARGETS)[number];

const GITHUB_ORIGIN = 'https://github.com/';

const LINEAR_REVIEW_ORIGIN = 'https://linear.review/';

export function linkUrl(url: string, target: LinkTarget): string {
  if (target === 'linear' && url.startsWith(GITHUB_ORIGIN)) {
    return `${LINEAR_REVIEW_ORIGIN}${url.slice(GITHUB_ORIGIN.length)}`;
  }

  return url;
}

/**
 * Users edit settings.json by hand, so a rewrite preserves keys this interface does not know about.
 */
export interface Settings {
  noCache?: boolean;
  openIn?: LinkTarget;
  copyLinks?: boolean;
  autoReload?: boolean;
  reloadInterval?: string;
  notifications?: boolean;
  trackMentions?: boolean;
  notifyMentions?: boolean;
  teamReviews?: boolean;
  notifyTeamReviews?: boolean;
  teamReviewStats?: boolean;
  notifyChannel?: NotifyChannel;
  snoozeDuration?: string;
  theme?: unknown;
}

export const DEFAULT_RELOAD_INTERVAL = '10m';

/**
 * A timer delay above the 32-bit signed integer range fires immediately.
 */
const MAX_RELOAD_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function reloadIntervalMs(input: string): number | null {
  const match = /^(\d+)([smh])$/.exec(input);

  if (match === null) {
    return null;
  }

  const ms = Number(match[1]) * (match[2] === 'h' ? 3_600_000 : match[2] === 'm' ? 60_000 : 1000);

  return ms >= 1000 && ms <= MAX_RELOAD_INTERVAL_MS ? ms : null;
}

export function parseReloadInterval(input: string): number {
  const ms = reloadIntervalMs(input);

  if (ms === null) {
    throw new CliError(`invalid reload interval "${input}", use a value from 1s to 24h like 30s, 10m, or 2h`);
  }

  return ms;
}

export function settingsFile(): string {
  return join(cacheDir(), 'settings.json');
}

let current: Settings = {};

function writeCurrent(): boolean {
  if (!cacheEnabled()) {
    return false;
  }

  writeFileAtomic(settingsFile(), `${JSON.stringify(current, null, 2)}\n`);

  return true;
}

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

  if (settings.openIn !== undefined && !LINK_TARGETS.includes(settings.openIn)) {
    throw new CliError(`"openIn" in ${settingsFile()} must be "github" or "linear"`);
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

  if (settings.trackMentions !== undefined && typeof settings.trackMentions !== 'boolean') {
    throw new CliError(`"trackMentions" in ${settingsFile()} must be true or false`);
  }

  if (settings.notifyMentions !== undefined && typeof settings.notifyMentions !== 'boolean') {
    throw new CliError(`"notifyMentions" in ${settingsFile()} must be true or false`);
  }

  if (settings.teamReviews !== undefined && typeof settings.teamReviews !== 'boolean') {
    throw new CliError(`"teamReviews" in ${settingsFile()} must be true or false`);
  }

  if (settings.notifyTeamReviews !== undefined && typeof settings.notifyTeamReviews !== 'boolean') {
    throw new CliError(`"notifyTeamReviews" in ${settingsFile()} must be true or false`);
  }

  if (settings.teamReviewStats !== undefined && typeof settings.teamReviewStats !== 'boolean') {
    throw new CliError(`"teamReviewStats" in ${settingsFile()} must be true or false`);
  }

  if (settings.notifyChannel !== undefined && !NOTIFY_CHANNELS.includes(settings.notifyChannel)) {
    throw new CliError(`"notifyChannel" in ${settingsFile()} must be "auto", "terminal", "command", or "bell"`);
  }

  if (
    settings.snoozeDuration !== undefined &&
    (typeof settings.snoozeDuration !== 'string' || snoozeDurationMs(settings.snoozeDuration) === null)
  ) {
    throw new CliError(
      `"snoozeDuration" in ${settingsFile()} must be a duration from 1m to 4w like "30m", "2h", or "1d"`,
    );
  }

  current = settings;

  return current;
}

export function saveNoCache(on: boolean): boolean {
  current = { ...current, noCache: on };

  return writeCurrent();
}

export function saveOpenIn(target: LinkTarget): boolean {
  current = { ...current, openIn: target };

  return writeCurrent();
}

export function saveCopyLinks(on: boolean): boolean {
  current = { ...current, copyLinks: on };

  return writeCurrent();
}

export function saveAutoReload(on: boolean): boolean {
  current = { ...current, autoReload: on };

  return writeCurrent();
}

export function saveReloadInterval(value: string): boolean {
  current = { ...current, reloadInterval: value };

  return writeCurrent();
}

export function saveNotifications(on: boolean): boolean {
  current = { ...current, notifications: on };

  return writeCurrent();
}

export function saveTrackMentions(on: boolean): boolean {
  current = { ...current, trackMentions: on };

  return writeCurrent();
}

export function saveNotifyMentions(on: boolean): boolean {
  current = { ...current, notifyMentions: on };

  return writeCurrent();
}

export function saveTeamReviews(on: boolean): boolean {
  current = { ...current, teamReviews: on };

  return writeCurrent();
}

export function saveNotifyTeamReviews(on: boolean): boolean {
  current = { ...current, notifyTeamReviews: on };

  return writeCurrent();
}

export function saveTeamReviewStats(on: boolean): boolean {
  current = { ...current, teamReviewStats: on };

  return writeCurrent();
}

export function saveNotifyChannel(channel: NotifyChannel): boolean {
  current = { ...current, notifyChannel: channel };

  return writeCurrent();
}

export function saveSnoozeDuration(value: string): boolean {
  current = { ...current, snoozeDuration: value };

  return writeCurrent();
}

export function saveTheme(value: unknown): boolean {
  current = { ...current };

  if (value === undefined) {
    delete current.theme;
  } else {
    current.theme = value;
  }

  return writeCurrent();
}

export function resetSettings(): boolean {
  if (!cacheEnabled()) {
    return false;
  }

  current = {};

  rmSync(settingsFile(), { force: true });

  return true;
}

/**
 * Runs after configureCache because a disabled cache reads no settings.
 */
export function applySettings(values: CliValues, explicit: Set<string>): Settings {
  const settings = loadSettings();

  if (!explicit.has('no-cache') && settings.noCache === true) {
    values['no-cache'] = true;
  }

  return settings;
}
