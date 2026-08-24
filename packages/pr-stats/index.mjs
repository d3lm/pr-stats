#!/usr/bin/env node

import { analyzeAuthoredSizes, analyzeReviewTimes } from './analyze.mjs';
import {
  HELP,
  parseCharts,
  parseCliArgs,
  parseReports,
  parseSince,
  parseSizeTarget,
  parseTarget,
  parseWorkHours,
  resolveTimezone,
} from './cli.mjs';
import { configureAuth, fetchCurrentUser, resolveRepos, searchPrs } from './github.mjs';
import { initBuckets } from './report.mjs';
import { configureTimeMode, isFullDayMode, timeMode } from './time.mjs';
import { formatMinutesOfDay } from './utils.mjs';

async function main() {
  const values = parseCliArgs();

  if (values.help) {
    console.info(HELP);
    return;
  }

  configureAuth(values.token);

  const since = parseSince(values.since);
  const sinceIso = since.toISOString().slice(0, 10);
  const tz = resolveTimezone(values.tz);
  const workWindows = parseWorkHours(values['work-hours']);

  configureTimeMode({ business: !values['wall-clock'], workWindows, tz });
  initBuckets();

  /**
   * ParseTarget scales day suffixes with the working-day length, so it must
   * run after the time mode is configured.
   */
  const targetHours = values.target !== undefined ? parseTarget(values.target) : undefined;

  /**
   * Echo the target back exactly as the user gave it. A bare number means
   * hours, so only that form gets a unit added.
   */
  const targetLabel =
    values.target !== undefined ? values.target + (/^[\d.]+$/.test(values.target) ? 'h' : '') : undefined;

  const sizeTarget = values['size-target'] !== undefined ? parseSizeTarget(values['size-target']) : undefined;
  const charts = parseCharts(values.charts);
  const reports = parseReports(values.reports);

  const user = values.user ?? (await fetchCurrentUser());
  const repos = await resolveRepos(values.repo);
  const includeDrafts = values['include-drafts'];

  console.info(
    `Searching PRs since ${sinceIso} for @${user}` +
      (repos.length > 0 ? ` in ${repos.join(', ')}` : ' across all accessible repos') +
      (includeDrafts ? ' (drafts included)' : ''),
  );

  if (isFullDayMode()) {
    console.info(`Durations count all hours Mon-Fri and skip weekends in ${tz}.`);
  } else if (timeMode.business) {
    const windowsText = workWindows
      .map((window) => `${formatMinutesOfDay(window.startMin)}-${formatMinutesOfDay(window.endMin)}`)
      .join(', ');

    console.info(`Durations count working hours only, Mon-Fri ${windowsText} in ${tz} (1wd = ${timeMode.dayHours}h)`);
  } else {
    console.info('Durations are wall-clock time.');
  }

  /**
   * Two searches feed the review analysis because review-requested only
   * matches pending requests, and reviewed-by covers requests you already
   * completed. The authored search feeds the size analysis. Searches for
   * reports that were not selected are skipped entirely.
   */
  const [requested, reviewed, authored] = await Promise.all([
    reports.has('review-time') ? searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'requested' }) : [],
    reports.has('review-time') ? searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'reviewed' }) : [],
    reports.has('size') ? searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'authored' }) : [],
  ]);

  if (reports.has('review-time')) {
    await analyzeReviewTimes({ requested, reviewed, user, targetHours, targetLabel });
  }

  if (reports.has('size')) {
    await analyzeAuthoredSizes({ authored, sizeTarget, charts });
  }
}

await main();
