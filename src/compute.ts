import type { ReviewPr, ReviewResult, SizeEntry } from './data';
import type { SizeTarget } from './flags';
import { durationHours } from './time';

export interface ReviewedEntry {
  pr: ReviewPr;
  requestedAt: Date;
  reviewedAt: Date;
  hours: number;
}

export interface PendingEntry {
  pr: ReviewPr;
  requestedAt: Date;
  hours: number;
}

export interface ReviewingEntry {
  pr: ReviewPr;
  reviewedAt: Date;
  hours: number;
}

export interface ReviewStats {
  reviewed: ReviewedEntry[];
  pending: PendingEntry[];
  /**
   * Holds the open PRs you already reviewed that have no unanswered
   * re-request, one entry per PR with your latest review time, longest
   * since that review first. A re-requested PR sits in the pending queue
   * instead, so the two queues never share a PR.
   */
  reviewing: ReviewingEntry[];
  expired: ReviewResult[];
  unrequested: ReviewResult[];
  allHours: number[];
  byRepo: [string, number[]][];
  misses: ReviewedEntry[];
}

/**
 * Derives the review-time statistics from classified raw results. This is
 * pure computation over data already in memory, so the caller can rerun it
 * with a different time mode or target without refetching. Configure the
 * time mode before calling, because durations depend on it. The options
 * carry the target hours for the miss list and the clock for the pending
 * and reviewing durations.
 */
export function computeReviewStats(
  results: ReviewResult[],
  { targetHours, now = new Date() }: { targetHours?: number; now?: Date } = {},
): ReviewStats {
  const reviewed: ReviewedEntry[] = [];
  const pending: PendingEntry[] = [];

  for (const result of results) {
    if (result.kind === 'reviewed') {
      reviewed.push({
        pr: result.pr,
        requestedAt: result.requestedAt,
        reviewedAt: result.reviewedAt,
        hours: durationHours(result.requestedAt, result.reviewedAt),
      });
    } else if (result.kind === 'pending' && result.pr.state === 'open') {
      pending.push({ pr: result.pr, requestedAt: result.requestedAt, hours: durationHours(result.requestedAt, now) });
    }
  }

  pending.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());

  /**
   * The reviewing queue collapses the per-cycle results back into one
   * entry per open PR, keeping the latest review time. Unrequested
   * results count too, because a review without a personal request still
   * puts the PR on your plate until it closes.
   */
  const pendingKeys = new Set(pending.map((entry) => `${entry.pr.repo}#${entry.pr.number}`));
  const latestReviews = new Map<string, { pr: ReviewPr; reviewedAt: Date }>();

  for (const result of results) {
    if ((result.kind !== 'reviewed' && result.kind !== 'unrequested') || result.pr.state !== 'open') {
      continue;
    }

    const key = `${result.pr.repo}#${result.pr.number}`;

    if (pendingKeys.has(key)) {
      continue;
    }

    const latest = latestReviews.get(key);

    if (latest === undefined || result.reviewedAt > latest.reviewedAt) {
      latestReviews.set(key, { pr: result.pr, reviewedAt: result.reviewedAt });
    }
  }

  const reviewing = [...latestReviews.values()]
    .map(({ pr, reviewedAt }) => {
      return { pr, reviewedAt, hours: durationHours(reviewedAt, now) };
    })
    .toSorted((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime());

  const expired = results.filter((result) => result.kind === 'pending' && result.pr.state !== 'open');
  const unrequested = results.filter((result) => result.kind === 'unrequested');
  const allHours = reviewed.map((result) => result.hours);

  const hoursByRepo = new Map<string, number[]>();

  for (const result of reviewed) {
    const hours = hoursByRepo.get(result.pr.repo) ?? [];

    hours.push(result.hours);
    hoursByRepo.set(result.pr.repo, hours);
  }

  const byRepo = [...hoursByRepo.entries()].toSorted((a, b) => b[1].length - a[1].length);

  const misses =
    targetHours === undefined
      ? []
      : reviewed.filter((result) => result.hours > targetHours).toSorted((a, b) => b.hours - a.hours);

  return { reviewed, pending, reviewing, expired, unrequested, allHours, byRepo, misses };
}

export interface SizeMetric {
  label: string;
  values: number[];
}

export interface SizeStats {
  metrics: SizeMetric[];
  timelineTotals: number[];
  met: number | undefined;
  misses: SizeEntry[];
  targetLabel: string | undefined;
}

/**
 * Derives the size statistics from fetched PR sizes. Like the review
 * computation, this is pure and can rerun against cached sizes when the
 * size target changes. The options carry the line and file budgets for the
 * target gauge.
 */
export function computeSizeStats(sizes: SizeEntry[], { sizeTarget }: { sizeTarget?: SizeTarget } = {}): SizeStats {
  const metrics = [
    { label: 'files changed', values: sizes.map((size) => size.files) },
    { label: 'lines added', values: sizes.map((size) => size.additions) },
    { label: 'lines removed', values: sizes.map((size) => size.deletions) },
    { label: 'lines total', values: sizes.map((size) => size.total) },
  ];

  const timelineTotals = [...sizes]
    .toSorted((a, b) => a.pr.createdAt.getTime() - b.pr.createdAt.getTime())
    .map((size) => size.total);

  if (sizeTarget === undefined) {
    return { metrics, timelineTotals, met: undefined, misses: [], targetLabel: undefined };
  }

  const meetsTarget = (size: SizeEntry) =>
    (sizeTarget.lines === undefined || size.total <= sizeTarget.lines) &&
    (sizeTarget.files === undefined || size.files <= sizeTarget.files);

  const targetLabel = [
    ...(sizeTarget.lines === undefined ? [] : [`<= ${sizeTarget.lines} lines`]),
    ...(sizeTarget.files === undefined ? [] : [`<= ${sizeTarget.files} files`]),
  ].join(', ');

  const met = sizes.filter((size) => meetsTarget(size)).length;

  const misses = sizes.filter((size) => !meetsTarget(size)).toSorted((a, b) => b.total - a.total);

  return { metrics, timelineTotals, met, misses, targetLabel };
}

export interface MergedEntry {
  entry: SizeEntry;
  mergedAt: Date;
  hours: number;
}

export interface ClosedEntry {
  entry: SizeEntry;
  closedAt: Date;
  hours: number;
}

export interface MergeStats {
  /**
   * Holds the merged PRs, most recently merged first, each with the time
   * from creation to merge.
   */
  merged: MergedEntry[];
  /**
   * Holds the PRs that were closed without a merge, most recently closed
   * first, each with the time from creation to close.
   */
  closed: ClosedEntry[];
  /**
   * Holds the PRs that are still open.
   */
  open: SizeEntry[];
  /**
   * Holds the time to merge of every merged PR, in merged order.
   */
  allHours: number[];
}

/**
 * Splits the authored PRs by outcome and derives the merge durations.
 * Like the other compute functions, this is pure computation over data
 * already in memory, so configure the time mode before calling because
 * the durations depend on it. A merged PR counts as merged even though
 * GitHub also reports it closed, and a reopened PR counts as open even
 * though it still carries its old close time. A closed PR without a
 * close time cannot happen on GitHub and gets dropped.
 */
export function computeMergeStats(sizes: SizeEntry[]): MergeStats {
  const merged: MergedEntry[] = [];
  const closed: ClosedEntry[] = [];
  const open: SizeEntry[] = [];

  for (const entry of sizes) {
    if (entry.mergedAt !== null) {
      merged.push({ entry, mergedAt: entry.mergedAt, hours: durationHours(entry.pr.createdAt, entry.mergedAt) });
    } else if (entry.pr.state === 'open') {
      open.push(entry);
    } else if (entry.closedAt !== null) {
      closed.push({ entry, closedAt: entry.closedAt, hours: durationHours(entry.pr.createdAt, entry.closedAt) });
    }
  }

  merged.sort((a, b) => b.mergedAt.getTime() - a.mergedAt.getTime());
  closed.sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime());

  return { merged, closed, open, allHours: merged.map((result) => result.hours) };
}

export interface CommentStats {
  /**
   * Holds one labeled series per comment kind, discussion, review, and
   * their total, in the shape the spread and summary formatters share
   * with the size metrics.
   */
  metrics: SizeMetric[];
  /**
   * Holds the total comment count of every PR, in input order.
   */
  totals: number[];
  /**
   * Counts the PRs that received no comments at all.
   */
  uncommented: number;
  /**
   * Holds the commented PRs sorted by total comments, most first.
   */
  top: SizeEntry[];
}

/**
 * Derives the comment statistics from fetched PR entries. The comment
 * counts ride along on the size fetch, so this is pure computation over
 * data already in memory, like the other compute functions.
 */
export function computeCommentStats(sizes: SizeEntry[]): CommentStats {
  const metrics = [
    { label: 'discussion comments', values: sizes.map((size) => size.comments.discussion) },
    { label: 'review comments', values: sizes.map((size) => size.comments.review) },
    { label: 'all comments', values: sizes.map((size) => size.comments.total) },
  ];

  const totals = sizes.map((size) => size.comments.total);
  const uncommented = totals.filter((total) => total === 0).length;

  const top = sizes.filter((size) => size.comments.total > 0).toSorted((a, b) => b.comments.total - a.comments.total);

  return { metrics, totals, uncommented, top };
}
