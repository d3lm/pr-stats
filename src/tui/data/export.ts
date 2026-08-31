import { join } from 'node:path';
import { writeFileAtomic } from '../../cache';
import {
  computeCommentStats,
  computeFirstReviewStats,
  computeMergeStats,
  computeReviewerStats,
  computeReviewStats,
  computeSizeStats,
  firstReviewOf,
  type ReviewerRow,
} from '../../compute';
import {
  parseSizeTarget,
  parseTarget,
  parseWorkDays,
  parseWorkHours,
  resolveTimezone,
  type SizeTarget,
} from '../../flags';
import { configureTimeMode, durationHours } from '../../time';
import { CliError, fail, percentile } from '../../utils';
import { targetLabelOf, type OptionsState } from '../state/options';
import { loadData, type LoadPhase, type RawData, type SizeEntry } from './load';

/**
 * Identifies one PR wherever the report lists PRs.
 */
export interface PrRef {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
}

/**
 * Five-number summary of one series. The unit rides on the field name
 * that holds the summary, hours on the durations, lines on the sizes,
 * and plain counts on the cycles and comments.
 */
export interface Summary {
  count: number;
  mean: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
}

/**
 * The full report the --json flag prints and the settings dialog writes
 * to a file, everything the tabs derive from one load in a serializable
 * shape. Durations respect the configured time mode, so a working-hours
 * setup reports counted hours instead of wall-clock hours.
 */
export interface StatsReport {
  generatedAt: string;
  user: string;
  since: string;
  repos: string[];
  searchCapped: boolean;
  options: {
    workDays: string;
    workHours: string;
    timezone: string;
    wallClock: boolean;
    includeDrafts: boolean;
    reviewTypes: string | null;
    reviewTarget: string | null;
    sizeTarget: string | null;
  };
  review: {
    counts: {
      reviewed: number;
      pending: number;
      reviewing: number;
      closedUnreviewed: number;
      reviewedUnrequested: number;
    };
    reviewTimeHours: Summary | null;
    cyclesPerPr: Summary | null;
    verdicts: { approved: number; changesRequested: number; commented: number; other: number };
    target: { label: string; hours: number; inside: number; over: number; pendingOverdue: number } | null;
    byRepo: { repo: string; reviews: number; p50Hours: number }[];
    reviewed: (PrRef & {
      requestedAt: string;
      reviewedAt: string;
      hours: number;
      verdict: string;
      totalLines: number;
    })[];
    pending: (PrRef & { requestedAt: string; hours: number })[];
    reviewing: (PrRef & { reviewedAt: string; hours: number })[];
  };
  authored: {
    counts: {
      total: number;
      analyzed: number;
      inaccessible: number;
      open: number;
      merged: number;
      closedUnmerged: number;
    };
    sizeLines: Summary | null;
    mergeTimeHours: Summary | null;
    firstReviewHours: Summary | null;
    awaitingFirstReview: number;
    sizeTarget: { label: string; inside: number; over: number } | null;
    reviewers: { leaderboard: ReviewerRow[]; mergedReviewed: number; mergedUnreviewed: number };
    prs: (PrRef & {
      createdAt: string;
      mergedAt: string | null;
      closedAt: string | null;
      firstReviewAt: string | null;
      hoursToMerge: number | null;
      hoursToClose: number | null;
      hoursToFirstReview: number | null;
      files: number;
      additions: number;
      deletions: number;
      totalLines: number;
      comments: { discussion: number; review: number; total: number };
      reviewers: string[];
    })[];
  };
  comments: {
    received: number;
    prsWithoutComments: number;
    perPr: Summary | null;
  };
}

/**
 * Rounds to two decimals, which keeps the JSON readable while an hour
 * still resolves to 36 seconds.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Summarizes one series into count, mean, and the percentiles. Returns
 * null for an empty series, so consumers can tell no data from zeros.
 */
function summarize(values: number[]): Summary | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].toSorted((a, b) => a - b);
  const sum = values.reduce((total, value) => total + value, 0);

  return {
    count: values.length,
    mean: round(sum / values.length),
    p50: round(percentile(sorted, 50)),
    p90: round(percentile(sorted, 90)),
    min: round(sorted[0]),
    max: round(sorted.at(-1) ?? 0),
  };
}

function prRef(pr: PrRef): PrRef {
  return { repo: pr.repo, number: pr.number, title: pr.title, url: pr.url, state: pr.state };
}

/**
 * Returns the hours from creation to merge, following the same outcome
 * rules as the merge stats. A merged PR reports its merge time even
 * though GitHub also marks it closed.
 */
function hoursToMerge(entry: SizeEntry): number | null {
  if (entry.mergedAt === null) {
    return null;
  }

  return round(durationHours(entry.pr.createdAt, entry.mergedAt));
}

/**
 * Returns the hours from creation to a close without a merge. A reopened
 * PR counts as open and reports null even though it still carries its
 * old close time, like in the merge stats.
 */
function hoursToClose(entry: SizeEntry): number | null {
  if (entry.mergedAt !== null || entry.pr.state === 'open' || entry.closedAt === null) {
    return null;
  }

  return round(durationHours(entry.pr.createdAt, entry.closedAt));
}

/**
 * Builds the serializable stats report from one load and the analysis
 * options. Configures the shared time-mode singleton from the options
 * before anything computes, like the view model does, so the durations
 * come out the same as on screen.
 */
export function buildStatsReport(raw: RawData, options: OptionsState): StatsReport {
  const timezone = resolveTimezone(options.tz === '' ? undefined : options.tz);

  configureTimeMode({
    business: !options.wallClock,
    workWindows: parseWorkHours(options.workHours),
    workDays: parseWorkDays(options.workDays),
    tz: timezone,
  });

  const targetHours = options.target === '' ? undefined : parseTarget(options.target);
  const targetLabel = targetLabelOf(options.target);

  const sizeTarget: SizeTarget | undefined =
    options.sizeTarget === '' ? undefined : parseSizeTarget(options.sizeTarget);

  const review = computeReviewStats(raw.reviewResults, { targetHours, now: raw.fetchedAt });
  const merge = computeMergeStats(raw.sizes);
  const reviewers = computeReviewerStats(raw.sizes, raw.user);
  const firstReview = computeFirstReviewStats(raw.sizes, raw.user, { now: raw.fetchedAt });
  const comments = computeCommentStats(raw.sizes);

  const verdictCount = (state: string) => review.reviewed.filter((entry) => entry.verdict === state).length;
  const approved = verdictCount('APPROVED');
  const changesRequested = verdictCount('CHANGES_REQUESTED');
  const commented = verdictCount('COMMENTED');

  let target: StatsReport['review']['target'] = null;

  if (targetHours !== undefined && targetLabel !== undefined) {
    const inside = review.allHours.filter((hours) => hours <= targetHours).length;

    target = {
      label: targetLabel,
      hours: round(targetHours),
      inside,
      over: review.allHours.length - inside,
      pendingOverdue: review.pending.filter((entry) => entry.hours > targetHours).length,
    };
  }

  const sizes = computeSizeStats(raw.sizes, { sizeTarget });

  const sizeTargetReport: StatsReport['authored']['sizeTarget'] =
    sizes.met === undefined || sizes.targetLabel === undefined
      ? null
      : { label: sizes.targetLabel, inside: sizes.met, over: raw.sizes.length - sizes.met };

  return {
    generatedAt: raw.fetchedAt.toISOString(),
    user: raw.user,
    since: raw.sinceIso,
    repos: raw.repos,
    searchCapped: raw.searchCapped,
    options: {
      workDays: options.workDays,
      workHours: options.workHours,
      timezone,
      wallClock: options.wallClock,
      includeDrafts: options.includeDrafts,
      reviewTypes: options.reviewTypes === '' ? null : options.reviewTypes,
      reviewTarget: targetLabel ?? null,
      sizeTarget: options.sizeTarget === '' ? null : options.sizeTarget,
    },
    review: {
      counts: {
        reviewed: review.reviewed.length,
        pending: review.pending.length,
        reviewing: review.reviewing.length,
        closedUnreviewed: review.expired.length,
        reviewedUnrequested: review.unrequested.length,
      },
      reviewTimeHours: summarize(review.allHours),
      cyclesPerPr: summarize(review.cycles),
      verdicts: {
        approved,
        changesRequested,
        commented,
        other: review.reviewed.length - approved - changesRequested - commented,
      },
      target,
      byRepo: review.byRepo.map(([repo, hours]) => {
        return {
          repo,
          reviews: hours.length,
          p50Hours: round(
            percentile(
              hours.toSorted((a, b) => a - b),
              50,
            ),
          ),
        };
      }),
      reviewed: review.reviewed.map((entry) => {
        return {
          ...prRef(entry.pr),
          requestedAt: entry.requestedAt.toISOString(),
          reviewedAt: entry.reviewedAt.toISOString(),
          hours: round(entry.hours),
          verdict: entry.verdict,
          totalLines: entry.lines,
        };
      }),
      pending: review.pending.map((entry) => {
        return { ...prRef(entry.pr), requestedAt: entry.requestedAt.toISOString(), hours: round(entry.hours) };
      }),
      reviewing: review.reviewing.map((entry) => {
        return { ...prRef(entry.pr), reviewedAt: entry.reviewedAt.toISOString(), hours: round(entry.hours) };
      }),
    },
    authored: {
      counts: {
        total: raw.authoredTotal,
        analyzed: raw.sizes.length,
        inaccessible: raw.authoredTotal - raw.sizes.length,
        open: merge.open.length,
        merged: merge.merged.length,
        closedUnmerged: merge.closed.length,
      },
      sizeLines: summarize(raw.sizes.map((entry) => entry.total)),
      mergeTimeHours: summarize(merge.allHours),
      firstReviewHours: summarize(firstReview.allHours),
      awaitingFirstReview: firstReview.awaiting.length,
      sizeTarget: sizeTargetReport,
      reviewers: {
        leaderboard: reviewers.leaderboard,
        mergedReviewed: reviewers.mergedReviewed,
        mergedUnreviewed: reviewers.mergedUnreviewed,
      },
      prs: raw.sizes.map((entry) => {
        const first = firstReviewOf(entry, raw.user);

        return {
          ...prRef(entry.pr),
          createdAt: entry.pr.createdAt.toISOString(),
          mergedAt: entry.mergedAt === null ? null : entry.mergedAt.toISOString(),
          closedAt: entry.closedAt === null ? null : entry.closedAt.toISOString(),
          firstReviewAt: first === null ? null : first.reviewedAt.toISOString(),
          hoursToMerge: hoursToMerge(entry),
          hoursToClose: hoursToClose(entry),
          hoursToFirstReview: first === null ? null : round(first.hours),
          files: entry.files,
          additions: entry.additions,
          deletions: entry.deletions,
          totalLines: entry.total,
          comments: entry.comments,
          reviewers: entry.reviews.flatMap((review) => (review.login === null ? [] : [review.login])),
        };
      }),
    },
    comments: {
      received: comments.totals.reduce((sum, total) => sum + total, 0),
      prsWithoutComments: comments.uncommented,
      perPr: summarize(comments.totals),
    },
  };
}

/**
 * Resolves the file the settings dialog exports to, pr-stats.json in the
 * directory pr-stats was started from. The dialog shows the path on the
 * export row.
 */
export function exportFile(): string {
  return join(process.cwd(), 'pr-stats.json');
}

/**
 * Writes the stats report for the loaded data to the export file,
 * overwriting a previous export.
 */
export function exportStatsFile(raw: RawData, options: OptionsState): void {
  writeFileAtomic(exportFile(), `${JSON.stringify(buildStatsReport(raw, options), null, 2)}\n`);
}

/**
 * Writes one progress line in place on stderr, so a piped stdout stays
 * pure JSON. Progress only renders when stderr is a terminal.
 */
function reportPhase(phase: LoadPhase): void {
  if (!process.stderr.isTTY) {
    return;
  }

  const text = phase.phase === 'search' ? 'searching PRs...' : `fetching PR details ${phase.done}/${phase.total}`;

  process.stderr.write(`\r\u001B[K${text}`);
}

function clearPhase(): void {
  if (process.stderr.isTTY) {
    process.stderr.write('\r\u001B[K');
  }
}

/**
 * Runs the full fetch pipeline and prints the stats report to stdout as
 * JSON, the --json code path that replaces the TUI. Never returns, the
 * process exits once the report is printed or the load failed.
 */
export async function runJsonStats(options: OptionsState, bypassCache: boolean): Promise<never> {
  try {
    const raw = await loadData(options, reportPhase, { bypassCache });

    clearPhase();

    /**
     * Exiting right after a large write can truncate a piped stdout, so
     * the exit waits for the write callback, which fires once the data
     * reached the OS.
     */
    await new Promise<void>((resolve) => {
      process.stdout.write(`${JSON.stringify(buildStatsReport(raw, options), null, 2)}\n`, () => {
        resolve();
      });
    });

    process.exit(0);
  } catch (error) {
    clearPhase();

    if (error instanceof CliError) {
      fail(error.message);
    }

    throw error;
  }
}
