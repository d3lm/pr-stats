import type { SizeTarget } from './flags';
import type { ReviewPr, ReviewResult, SizeEntry } from './data';
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

export interface ReviewStats {
  reviewed: ReviewedEntry[];
  pending: PendingEntry[];
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
 * carry the target hours for the miss list and the clock for pending
 * durations.
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

  return { reviewed, pending, expired, unrequested, allHours, byRepo, misses };
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
