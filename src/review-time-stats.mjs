#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HELP = `
Usage: review-time-stats.mjs [options]

Options:
  --since <value>     Only include PRs created after this point. Accepts an ISO
                      date (2026-01-01) or a relative value (30d, 8w, 6m, 1y).
                      The default is 90d.
  --repo <name>       Restrict the search to a repository. Repeat the flag for
                      multiple repositories. Accepts "owner/name" or a bare
                      name, which resolves against the owner of the repo in the
                      current directory. Without this flag, all repositories
                      you have access to are searched.
  --user <login>      Compute stats for this user. Defaults to the logged-in
                      gh user.
  --target <value>    Report how many reviews finished within this time.
                      Accepts hours (24h or plain 24), minutes (90m), or days
                      (2d). A day means 24 counted hours, or one working day
                      when --work-hours is set. Open PRs that have already
                      waited longer than the target count as misses.
  --tz <zone>         IANA timezone for the weekend and working-hours math,
                      for example Europe/Berlin. Defaults to your system
                      timezone.
  --work-hours <v>    Count only these working hours instead of full weekdays.
                      Accepts one range like 9-17 or 8:30-16:30, or several
                      comma-separated ranges like 9-18,19:30-20:30. Without
                      this flag, every hour Mon-Fri counts.
  --wall-clock        Measure raw elapsed time, including weekends.
  --include-drafts    Include PRs that are currently drafts. Excluded by default.
  --help              Show this help.
`.trim();

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function gh(args, { input } = {}) {
  try {
    const { stdout } = await execFileAsync('gh', args, {
      maxBuffer: 64 * 1024 * 1024,
      ...(input !== undefined ? { input } : {}),
    });

    return stdout;
  } catch (error) {
    const stderr = error.stderr?.toString().trim();

    fail(`gh ${args.slice(0, 2).join(' ')} failed${stderr ? `\n${stderr}` : ''}`);

    /**
     * Fail() exits the process, so this throw is never reached. It only
     * tells the linter that this branch does not return a value.
     */
    throw error;
  }
}

function parseSince(value) {
  const relative = /^(\d+)([dwmy])$/.exec(value);

  if (relative) {
    const amount = Number(relative[1]);
    const date = new Date();

    if (relative[2] === 'd') {
      date.setDate(date.getDate() - amount);
    }

    if (relative[2] === 'w') {
      date.setDate(date.getDate() - amount * 7);
    }

    if (relative[2] === 'm') {
      date.setMonth(date.getMonth() - amount);
    }

    if (relative[2] === 'y') {
      date.setFullYear(date.getFullYear() - amount);
    }

    return date;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    fail(`invalid --since value "${value}", use an ISO date or 30d/8w/6m/1y`);
  }

  return date;
}

function parseTarget(value) {
  const match = /^(\d+(?:\.\d+)?)([hdm]?)$/.exec(value);

  if (!match) {
    fail(`invalid --target value "${value}", use 24h, 2d, or 90m`);
  }

  const amount = Number(match[1]);

  if (match[2] === 'd') {
    return amount * timeMode.dayHours;
  }

  if (match[2] === 'm') {
    return amount / 60;
  }

  return amount;
}

/**
 * Parses one or more comma-separated working windows, for example "9-17" or
 * "9-18,19:30-20:30". Returns the windows sorted by start time.
 */
function parseWorkHours(value) {
  const windows = value.split(',').map((range) => {
    const match = /^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?$/.exec(range.trim());

    if (!match) {
      fail(`invalid --work-hours range "${range}", use ranges like 9-17, 8:30-16:30, or 9-18,19:30-20:30`);
    }

    const startMin = Number(match[1]) * 60 + Number(match[2] ?? 0);
    const endMin = Number(match[3]) * 60 + Number(match[4] ?? 0);

    if (endMin <= startMin || endMin > 24 * 60 || Number(match[2] ?? 0) > 59 || Number(match[4] ?? 0) > 59) {
      fail(`invalid --work-hours range "${range}"`);
    }

    return { startMin, endMin };
  });

  windows.sort((a, b) => a.startMin - b.startMin);

  for (let i = 1; i < windows.length; i++) {
    if (windows[i].startMin < windows[i - 1].endMin) {
      fail(`--work-hours ranges overlap around ${formatMinutesOfDay(windows[i].startMin)}`);
    }
  }

  return windows;
}

function formatMinutesOfDay(minutes) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Holds how durations are measured. main() fills this in from the flags
 * before any duration is computed.
 */
const timeMode = {
  business: true,
  workWindows: [{ startMin: 0, endMin: 24 * 60 }],
  dayHours: 24,
  formatter: undefined,
};

/**
 * Reports whether every hour of a weekday counts, which is the default.
 * When the user sets --work-hours, only the given windows count.
 */
function isFullDayMode() {
  return timeMode.business && timeMode.dayHours === 24;
}

/**
 * Returns the wall-clock date and time parts of an instant in the
 * configured timezone.
 */
function wallParts(instantMs) {
  const parts = Object.fromEntries(timeMode.formatter.formatToParts(instantMs).map((part) => [part.type, part.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * Finds the UTC instant whose wall-clock time in the configured timezone
 * equals the given target. The target encodes a wall-clock time as a Date.UTC
 * value. Two refinement rounds are enough to converge, including across DST
 * changes.
 */
function utcFromWall(wallTargetMs) {
  let guess = wallTargetMs;

  for (let i = 0; i < 2; i++) {
    const parts = wallParts(guess);

    const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

    guess = wallTargetMs - (wall - guess);
  }

  return guess;
}

/**
 * Sums the milliseconds between two instants that fall inside working hours
 * on weekdays in the configured timezone. Walks the interval one local
 * calendar day at a time and adds the overlap with each of that day's
 * working windows.
 */
function businessMsBetween(start, end) {
  const startMs = start.getTime();
  const endMs = end.getTime();

  if (endMs <= startMs) {
    return 0;
  }

  let total = 0;

  const parts = wallParts(startMs);

  let localDay = Date.UTC(parts.year, parts.month - 1, parts.day);

  while (utcFromWall(localDay) <= endMs) {
    /**
     * LocalDay encodes the local calendar date as a UTC timestamp,
     * so its UTC weekday matches the local weekday.
     */
    const weekday = new Date(localDay).getUTCDay();

    if (weekday !== 0 && weekday !== 6) {
      for (const window of timeMode.workWindows) {
        const windowStart = utcFromWall(localDay + window.startMin * 60_000);
        const windowEnd = utcFromWall(localDay + window.endMin * 60_000);
        const overlapStart = Math.max(windowStart, startMs);
        const overlapEnd = Math.min(windowEnd, endMs);

        if (overlapEnd > overlapStart) {
          total += overlapEnd - overlapStart;
        }
      }
    }

    localDay += 86_400_000;
  }

  return total;
}

function durationHours(start, end) {
  if (!timeMode.business) {
    return (end - start) / 36e5;
  }

  return businessMsBetween(start, end) / 36e5;
}

async function resolveRepos(repos) {
  let defaultOwner;

  const resolved = [];

  for (const repo of repos) {
    if (repo.includes('/')) {
      resolved.push(repo);
      continue;
    }

    if (!defaultOwner) {
      const stdout = await gh(['repo', 'view', '--json', 'owner', '--jq', '.owner.login']);

      defaultOwner = stdout.trim();

      if (!defaultOwner) {
        fail(`cannot resolve owner for "--repo ${repo}", use the owner/name form`);
      }
    }

    resolved.push(`${defaultOwner}/${repo}`);
  }

  return resolved;
}

async function searchPrs({ user, sinceIso, repos, includeDrafts, mode }) {
  const args = [
    'search',
    'prs',
    mode === 'requested' ? '--review-requested' : '--reviewed-by',
    user,
    '--created',
    `>=${sinceIso}`,
    '--limit',
    '1000',
    '--json',
    'number,repository,title,url,createdAt,isDraft,state',
  ];

  if (!includeDrafts) {
    args.push('--draft=false');
  }

  for (const repo of repos) {
    args.push('--repo', repo);
  }

  return JSON.parse(await gh(args));
}

/**
 * Fetches review requests and reviews for a batch of PRs with one GraphQL
 * call. Aliases keep the batch inside a single query.
 */
async function fetchPrDetails(prs) {
  const parts = prs.map((pr, i) => {
    const [owner, name] = pr.repo.split('/');

    return `
      pr${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
        pullRequest(number: ${pr.number}) {
          timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], first: 100) {
            nodes {
              ... on ReviewRequestedEvent {
                createdAt
                requestedReviewer {
                  ... on User { login }
                  ... on Team { slug }
                }
              }
            }
          }
          reviews(first: 100) {
            nodes {
              author { login }
              submittedAt
              state
            }
          }
        }
      }`;
  });

  const query = `query {${parts.join('\n')}}`;
  const stdout = await gh(['api', 'graphql', '-f', `query=${query}`]);
  const data = JSON.parse(stdout).data;

  return prs.map((pr, i) => data[`pr${i}`]?.pullRequest ?? null);
}

function analyzePr(pr, details, user) {
  if (!details) {
    return { kind: 'inaccessible', pr };
  }

  const requests = details.timelineItems.nodes
    .filter((node) => node?.requestedReviewer?.login === user)
    .map((node) => new Date(node.createdAt))
    .toSorted((a, b) => a - b);

  const reviews = details.reviews.nodes
    .filter((node) => node?.author?.login === user && node.submittedAt)
    .map((node) => new Date(node.submittedAt))
    .toSorted((a, b) => a - b);

  if (requests.length === 0) {
    /**
     * The reviewed-by search also returns PRs where you reviewed without a
     * direct request, for example via a team request. There is no personal
     * request timestamp, so these cannot go into the histogram.
     */
    return reviews.length > 0 ? { kind: 'unrequested', pr } : { kind: 'inaccessible', pr };
  }

  const firstRequest = requests[0];

  const firstReviewAfterRequest = reviews.find((review) => review >= firstRequest);

  if (!firstReviewAfterRequest) {
    return { kind: 'pending', pr, requestedAt: firstRequest };
  }

  return {
    kind: 'reviewed',
    pr,
    hours: durationHours(firstRequest, firstReviewAfterRequest),
  };
}

/**
 * Holds the histogram buckets. main() fills this in once the time mode is
 * known, because business buckets scale with the working-day length.
 */
let BUCKETS = [];

function makeBuckets() {
  if (!timeMode.business || isFullDayMode()) {
    return [
      { label: '< 1h', max: 1 },
      { label: '1-4h', max: 4 },
      { label: '4-8h', max: 8 },
      { label: '8-24h', max: 24 },
      { label: '1-2d', max: 48 },
      { label: '2-4d', max: 96 },
      { label: '4-7d', max: 168 },
      { label: '> 7d', max: Infinity },
    ];
  }

  const wd = timeMode.dayHours;

  return [
    { label: '< 1h', max: 1 },
    { label: '1-4h', max: 4 },
    { label: '4h-1wd', max: wd },
    { label: '1-2wd', max: 2 * wd },
    { label: '2-3wd', max: 3 * wd },
    { label: '3-5wd', max: 5 * wd },
    { label: '5-10wd', max: 10 * wd },
    { label: '> 10wd', max: Infinity },
  ];
}

function formatHours(hours) {
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  }

  if (hours < 2 * timeMode.dayHours) {
    return `${hours.toFixed(1)}h`;
  }

  return `${(hours / timeMode.dayHours).toFixed(1)}${timeMode.business && !isFullDayMode() ? 'wd' : 'd'}`;
}

/**
 * Formats a duration as counted hours without converting to days. The PR
 * lists use this so their values compare directly against an hour target.
 */
function formatHoursOnly(hours) {
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  }

  return `${hours.toFixed(1)}h`;
}

/**
 * Returns " (N weeks)" once a duration reaches one week. Returns an empty
 * string otherwise. A week means five counted weekdays, or seven full days in
 * wall-clock mode.
 */
function weeksSuffix(hours) {
  const weekHours = timeMode.business ? 5 * timeMode.dayHours : 7 * 24;

  if (hours < weekHours) {
    return '';
  }

  return ` (${(hours / weekHours).toFixed(1)} weeks)`;
}

function percentile(sorted, percent) {
  const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);

  return sorted[Math.max(0, index)];
}

/**
 * Wraps text in an OSC 8 escape sequence so terminals render it as a
 * clickable hyperlink. Falls back to plain text when the output is not a
 * terminal, for example when piped to a file.
 */
function link(text, url) {
  if (!process.stdout.isTTY) {
    return text;
  }

  return `\u001B]8;;${url}\u001B\\${text}\u001B]8;;\u001B\\`;
}

function printHistogram(title, hoursList) {
  const counts = BUCKETS.map(() => 0);

  for (const hours of hoursList) {
    counts[BUCKETS.findIndex((bucket) => hours < bucket.max)] += 1;
  }

  const maxCount = Math.max(...counts, 1);
  const labelWidth = Math.max(...BUCKETS.map((bucket) => bucket.label.length));

  console.info(`\n${title}`);

  for (const [i, BUCKET] of BUCKETS.entries()) {
    const bar = '█'.repeat(Math.round((counts[i] / maxCount) * 40)) || (counts[i] > 0 ? '▏' : '');

    const pct = hoursList.length > 0 ? Math.round((counts[i] / hoursList.length) * 100) : 0;

    console.info(`  ${BUCKET.label.padEnd(labelWidth)}  ${bar.padEnd(40)} ${String(counts[i]).padStart(4)}  (${pct}%)`);
  }
}

/**
 * Prints the summary line and the target gauge. The percentiles only cover
 * completed reviews. The gauge additionally counts pending reviews that have
 * already waited longer than the target, because those are guaranteed misses
 * no matter when the review lands.
 */
function printStats(hoursList, targetHours, targetLabel, pendingHours = []) {
  const sorted = [...hoursList].toSorted((a, b) => a - b);
  const mean = sorted.reduce((sum, hours) => sum + hours, 0) / sorted.length;

  console.info(
    `\n  min ${formatHours(sorted[0])}` +
      ` | mean ${formatHours(mean)}` +
      ` | p50 ${formatHours(percentile(sorted, 50))}` +
      ` | p90 ${formatHours(percentile(sorted, 90))}` +
      ` | p99 ${formatHours(percentile(sorted, 99))}` +
      ` | max ${formatHours(sorted.at(-1))}`,
  );

  if (targetHours !== undefined) {
    const overdue = pendingHours.filter((hours) => hours > targetHours).length;
    const met = sorted.filter((hours) => hours <= targetHours).length;
    const total = sorted.length + overdue;
    const pct = (met / total) * 100;
    const filled = Math.round((pct / 100) * 30);
    const gauge = '█'.repeat(filled) + '░'.repeat(30 - filled);

    console.info(
      `  target <= ${targetLabel}  ${gauge} ${pct.toFixed(0)}% met` +
        ` (${met}/${total}${overdue > 0 ? `, ${overdue} awaiting review and already over` : ''})`,
    );
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      since: { type: 'string', default: '90d' },
      repo: { type: 'string', multiple: true, default: [] },
      user: { type: 'string' },
      target: { type: 'string' },
      tz: { type: 'string' },
      'work-hours': { type: 'string', default: '0-24' },
      'wall-clock': { type: 'boolean', default: false },
      'include-drafts': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    console.info(HELP);
    return;
  }

  const since = parseSince(values.since);
  const sinceIso = since.toISOString().slice(0, 10);

  const tz = values.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    fail(`invalid --tz value "${tz}", use an IANA zone like Europe/Berlin`);
  }

  const workWindows = parseWorkHours(values['work-hours']);

  const workMinutesPerDay = workWindows.reduce((sum, window) => sum + (window.endMin - window.startMin), 0);

  timeMode.business = !values['wall-clock'];
  timeMode.workWindows = workWindows;
  timeMode.dayHours = timeMode.business ? workMinutesPerDay / 60 : 24;

  timeMode.formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  BUCKETS = makeBuckets();

  const targetHours = values.target !== undefined ? parseTarget(values.target) : undefined;

  /**
   * Echo the target back exactly as the user gave it. A bare number means
   * hours, so only that form gets a unit added.
   */
  const targetLabel =
    values.target !== undefined ? values.target + (/^[\d.]+$/.test(values.target) ? 'h' : '') : undefined;

  const githubUser = await gh(['api', 'user', '--jq', '.login']);
  const user = values.user ?? githubUser.trim();

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
   * Two searches are needed because review-requested only matches pending
   * requests, and reviewed-by covers requests you already completed.
   */
  const [requested, reviewed] = await Promise.all([
    searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'requested' }),
    searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'reviewed' }),
  ]);

  const prByKey = new Map();

  for (const item of [...requested, ...reviewed]) {
    const repo = item.repository.nameWithOwner;

    prByKey.set(`${repo}#${item.number}`, {
      repo,
      number: item.number,
      title: item.title,
      url: item.url,
      state: item.state,
    });
  }

  const prs = [...prByKey.values()];

  if (prs.length === 0) {
    console.info('No matching PRs found.');
    return;
  }

  if (requested.length >= 1000 || reviewed.length >= 1000) {
    console.warn('Warning, a search hit the 1000 result cap, so data may be incomplete. Narrow --since or --repo.');
  }

  console.info(`Found ${prs.length} PRs, fetching review timelines...`);

  const results = [];
  const batchSize = 25;

  for (let offset = 0; offset < prs.length; offset += batchSize) {
    const batch = prs.slice(offset, offset + batchSize);
    const detailsList = await fetchPrDetails(batch);

    for (const [i, element] of batch.entries()) {
      results.push(analyzePr(element, detailsList[i], user));
    }

    process.stdout.write(`\r  ${Math.min(offset + batchSize, prs.length)}/${prs.length}`);
  }

  process.stdout.write('\n');

  const reviewedResults = results.filter((result) => result.kind === 'reviewed');

  const pending = results.filter((result) => result.kind === 'pending' && result.pr.state === 'open');

  const now = new Date();

  for (const result of pending) {
    result.hours = durationHours(result.requestedAt, now);
  }

  const expired = results.filter((result) => result.kind === 'pending' && result.pr.state !== 'open');

  const unrequested = results.filter((result) => result.kind === 'unrequested');

  console.info(
    `\n${reviewedResults.length} reviewed after a direct request, ` +
      `${pending.length} open and awaiting your review, ` +
      `${expired.length} closed or merged without your review, ` +
      `${unrequested.length} reviewed without a direct request (excluded)`,
  );

  if (reviewedResults.length === 0) {
    console.info('Nothing to chart.');
    return;
  }

  const allHours = reviewedResults.map((result) => result.hours);

  const pendingHours = pending.map((result) => result.hours);

  printHistogram(`Time to review, all repos (n=${allHours.length})`, allHours);
  printStats(allHours, targetHours, targetLabel, pendingHours);

  const byRepo = new Map();

  for (const result of reviewedResults) {
    if (!byRepo.has(result.pr.repo)) {
      byRepo.set(result.pr.repo, []);
    }

    byRepo.get(result.pr.repo).push(result.hours);
  }

  if (byRepo.size > 1) {
    const sortedByRepo = [...byRepo.entries()].toSorted((a, b) => {
      return b[1].length - a[1].length;
    });

    for (const [repo, hoursList] of sortedByRepo) {
      printHistogram(`Time to review, ${repo} (n=${hoursList.length})`, hoursList);

      const repoPendingHours = pending.filter((result) => result.pr.repo === repo).map((result) => result.hours);

      printStats(hoursList, targetHours, targetLabel, repoPendingHours);
    }
  }

  if (targetHours !== undefined) {
    const misses = reviewedResults.filter((result) => result.hours > targetHours).toSorted((a, b) => b.hours - a.hours);

    if (misses.length > 0) {
      console.info(`\nReviews that missed the <= ${targetLabel} target`);

      const rows = misses.map((result) => {
        return {
          result,
          duration: `${formatHoursOnly(result.hours).padStart(8)}${weeksSuffix(result.hours)}`,
        };
      });

      const width = Math.max(...rows.map((row) => row.duration.length));

      for (const { result, duration } of rows) {
        const ref = link(`${result.pr.repo}#${result.pr.number}`, result.pr.url);

        console.info(`  ${duration.padEnd(width)}  ${ref}  ${result.pr.title}`);
      }
    }
  }

  if (pending.length > 0) {
    console.info('\nOpen and awaiting your review');

    const rows = pending
      .toSorted((a, b) => a.requestedAt - b.requestedAt)
      .map((result) => {
        return {
          result,
          duration: `${formatHoursOnly(result.hours).padStart(8)}${weeksSuffix(result.hours)}`,
        };
      });

    const width = Math.max(...rows.map((row) => row.duration.length));

    for (const { result, duration } of rows) {
      const ref = link(`${result.pr.repo}#${result.pr.number}`, result.pr.url);

      console.info(`  ${duration.padEnd(width)}  ${ref}  ${result.pr.title}`);
    }
  }
}

await main();
