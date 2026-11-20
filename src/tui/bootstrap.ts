import { configureCache } from '../cache';
import { canonicalWorkDays, HELP, parseCliArgs } from '../flags';
import { configureAuth } from '../github';
import { readMentionReads, type MentionReadsByUser } from '../mentions';
import { applySettings, DEFAULT_RELOAD_INTERVAL, type LinkTarget, type NotifyChannel } from '../settings';
import { DEFAULT_SNOOZE_DURATION, readSnoozes, type Snooze } from '../snooze';
import { CliError, fail } from '../utils';
import { applySavedOptions, FIELDS, validateField, type OptionsState } from './state/options';
import { applyTheme, type ThemeState } from './theme';

export interface BootstrapResult {
  initial: OptionsState;
  saved: OptionsState | null;
  noCache: boolean;
  autoReload: boolean;
  reloadInterval: string;
  notifications: boolean;
  trackMentions: boolean;
  notifyMentions: boolean;
  teamReviews: boolean;
  notifyTeamReviews: boolean;
  teamReviewStats: boolean;
  notifyChannel: NotifyChannel;
  openIn: LinkTarget;
  copyLinks: boolean;
  snoozeDuration: string;
  /**
   * Includes expired snoozes so the TUI can report PRs that came back while it was closed.
   */
  snoozes: Snooze[];
  mentionReads: MentionReadsByUser;
  theme: ThemeState;
  json: boolean;
}

/**
 * Runs before the renderer takes the alternate screen, so a bad flag prints a plain error.
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

    // both merges read from the cache configured above
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
      trackMentions: settings.trackMentions !== false,
      notifyMentions: settings.notifyMentions === true,
      teamReviews: settings.teamReviews !== false,
      notifyTeamReviews: settings.notifyTeamReviews === true,
      teamReviewStats: settings.teamReviewStats === true,
      notifyChannel: settings.notifyChannel ?? 'auto',
      openIn: settings.openIn ?? 'github',
      copyLinks: settings.copyLinks === true,
      snoozeDuration: settings.snoozeDuration ?? DEFAULT_SNOOZE_DURATION,
      snoozes: readSnoozes(),
      mentionReads: readMentionReads(),
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
