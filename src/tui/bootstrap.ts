import { configureCache } from '../cache';
import { canonicalWorkDays, HELP, parseCliArgs } from '../flags';
import { configureAuth } from '../github';
import { applySettings, DEFAULT_RELOAD_INTERVAL, type NotifyChannel } from '../settings';
import { DEFAULT_SNOOZE_DURATION, readSnoozes, type Snooze } from '../snooze';
import { CliError, fail } from '../utils';
import { applySavedOptions, FIELDS, validateField, type OptionsState } from './state/options';
import { applyTheme, type ThemeState } from './theme';

export interface BootstrapResult {
  initial: OptionsState;
  /**
   * Holds the options saved in the cache directory, or null when nothing
   * valid is saved. The options modal compares the live options against
   * them to label its save state.
   */
  saved: OptionsState | null;
  /**
   * Mirrors the --no-cache flag, filled in from settings.json when the
   * flag was not given. Loads bypass the cache while it is set, which
   * refetches everything and rewrites the cached entries.
   */
  noCache: boolean;
  /**
   * Mirrors the auto-reload setting from settings.json. While it is set,
   * the TUI reloads its data in the background every reload interval.
   */
  autoReload: boolean;
  /**
   * Holds the reload interval from settings.json, already validated
   * by loadSettings, or the default while the file names none.
   */
  reloadInterval: string;
  /**
   * Mirrors the notifications setting from settings.json. While it is
   * set, fresh loads send desktop notifications for new and re-requested
   * reviews, the first one measured against the startup snapshot.
   */
  notifications: boolean;
  /**
   * Holds the notification channel from settings.json, already
   * validated by loadSettings, or auto while the file names none.
   */
  notifyChannel: NotifyChannel;
  /**
   * Mirrors the copy-links setting from settings.json. While it is set,
   * enter and a click on a PR reference copy the PR's link to the
   * clipboard instead of opening it in the browser.
   */
  copyLinks: boolean;
  /**
   * Holds the default snooze duration from settings.json, already
   * validated by loadSettings, or the default while the file names none.
   */
  snoozeDuration: string;
  /**
   * Holds the snoozes read from the snooze file in the cache directory,
   * expired ones included, so the TUI can wake them up and report the
   * PRs that came back while it was closed.
   */
  snoozes: Snooze[];
  /**
   * Holds the theme parsed from settings.json and already applied, so
   * the settings dialog starts from the saved active theme and the saved
   * custom colors.
   */
  theme: ThemeState;
  /**
   * Mirrors the --json flag. While it is set, the entry point prints the
   * stats report to stdout instead of starting the TUI.
   */
  json: boolean;
}

/**
 * Parses the command-line flags and seeds the option state that every TUI
 * entry point starts from. The flag defaults double as the TUI defaults,
 * so the dev entry accepts the same flags as the published binary,
 * including --debug. The settings and the options saved from the options
 * modal fill in the flags that were not given, and explicit flags always
 * win. The theme overrides from the settings apply here as well, before
 * anything renders.
 *
 * Validates the seeded flags and resolves the debug binary before the
 * screen flips to the alternate buffer, so a bad flag fails with a plain
 * printed error instead of inside the UI.
 */
export function bootstrap(): BootstrapResult {
  const { values, explicit } = parseCliArgs();

  if (values.help) {
    console.info(HELP);
    process.exit(0);
  }

  try {
    configureAuth(values.token, values.debug);
    configureCache(values.debug === undefined);

    // both merges need the configured cache, so they run after configureCache
    const settings = applySettings(values, explicit);
    const saved = applySavedOptions(values, explicit);

    const theme = applyTheme(settings.theme);

    const initial: OptionsState = {
      since: values.since,
      repos: values.repo.join(','),
      user: values.user ?? '',
      target: values.target ?? '',
      targetPercentile: values['target-percentile'] ?? '',
      sizeTarget: values['size-target'] ?? '',
      workDays: canonicalWorkDays(values['work-days']),
      workHours: values['work-hours'],
      tz: values.tz ?? '',
      wallClock: values['wall-clock'],
      includeDrafts: values['include-drafts'],
      reviewTypes: values['review-types'] ?? '',
    };

    for (const field of FIELDS) {
      const value = initial[field.key];

      if (typeof value === 'string') {
        validateField(field.key, value);
      }
    }

    return {
      initial,
      saved,
      noCache: values['no-cache'],
      autoReload: settings.autoReload === true,
      reloadInterval: settings.reloadInterval ?? DEFAULT_RELOAD_INTERVAL,
      notifications: settings.notifications === true,
      notifyChannel: settings.notifyChannel ?? 'auto',
      copyLinks: settings.copyLinks === true,
      snoozeDuration: settings.snoozeDuration ?? DEFAULT_SNOOZE_DURATION,
      snoozes: readSnoozes(),
      theme,
      json: values.json,
    };
  } catch (error) {
    if (error instanceof CliError) {
      fail(error.message);
    }

    throw error;
  }
}
