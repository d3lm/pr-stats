import type { ReviewPr, ReviewResult, SizeEntry } from './data';
import type { SizeTarget } from './flags';
import { durationHours } from './time';

export interface ReviewedEntry {
  pr: ReviewPr;
  requestedAt: Date;
  reviewedAt: Date;
  hours: number;
  verdict: string;
  lines: number;
}

export interface PendingRequest {
  pr: ReviewPr;
  requestedAt: Date;
}

export interface PendingEntry extends PendingRequest {
  hours: number;
}

export interface TeamPendingRequest extends PendingRequest {
  team: string;
}

export interface TeamPendingEntry extends TeamPendingRequest {
  hours: number;
}

export interface LatestReview {
  pr: ReviewPr;
  reviewedAt: Date;
}

export interface ReviewingEntry extends LatestReview {
  hours: number;
}

export function pendingRequests(results: ReviewResult[]): PendingRequest[] {
  const pending: PendingRequest[] = [];

  for (const result of results) {
    if (result.kind === 'pending' && result.pr.state === 'open') {
      pending.push({ pr: result.pr, requestedAt: result.requestedAt });
    }
  }

  return pending.toSorted((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
}

export function teamPendingRequests(results: ReviewResult[]): TeamPendingRequest[] {
  const pending: TeamPendingRequest[] = [];

  for (const result of results) {
    if (result.kind === 'team-pending' && result.pr.state === 'open') {
      pending.push({ pr: result.pr, requestedAt: result.requestedAt, team: result.team });
    }
  }

  return pending.toSorted((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
}

export function latestReviews(results: ReviewResult[]): LatestReview[] {
  const pendingKeys = new Set<string>();

  for (const result of results) {
    if ((result.kind === 'pending' || result.kind === 'team-pending') && result.pr.state === 'open') {
      pendingKeys.add(`${result.pr.repo}#${result.pr.number}`);
    }
  }

  const latest = new Map<string, LatestReview>();

  for (const result of results) {
    if (
      (result.kind !== 'reviewed' && result.kind !== 'team-reviewed' && result.kind !== 'unrequested') ||
      result.pr.state !== 'open'
    ) {
      continue;
    }

    const key = `${result.pr.repo}#${result.pr.number}`;

    if (pendingKeys.has(key)) {
      continue;
    }

    const known = latest.get(key);

    if (known === undefined || result.reviewedAt > known.reviewedAt) {
      latest.set(key, { pr: result.pr, reviewedAt: result.reviewedAt });
    }
  }

  return [...latest.values()].toSorted((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime());
}

export interface ReviewStats {
  reviewed: ReviewedEntry[];
  pending: PendingEntry[];
  reviewing: ReviewingEntry[];
  expired: ReviewResult[];
  unrequested: ReviewResult[];
  /**
   * Holds team cycles even when includeTeam is off, so the strip can report what the flag leaves out.
   */
  teamReviewed: ReviewedEntry[];
  teamPending: TeamPendingEntry[];
  allHours: number[];
  byRepo: [string, number[]][];
  misses: ReviewedEntry[];
  cycles: number[];
}

export function computeReviewStats(
  results: ReviewResult[],
  {
    targetHours,
    now = new Date(),
    includeTeam = false,
  }: { targetHours?: number; now?: Date; includeTeam?: boolean } = {},
): ReviewStats {
  const reviewed: ReviewedEntry[] = [];
  const teamReviewed: ReviewedEntry[] = [];

  for (const result of results) {
    if (result.kind === 'reviewed' || result.kind === 'team-reviewed') {
      const entry = {
        pr: result.pr,
        requestedAt: result.requestedAt,
        reviewedAt: result.reviewedAt,
        hours: durationHours(result.requestedAt, result.reviewedAt),
        verdict: result.verdict,
        lines: result.lines,
      };

      if (result.kind === 'team-reviewed') {
        teamReviewed.push(entry);
      }

      if (includeTeam || result.kind === 'reviewed') {
        reviewed.push(entry);
      }
    }
  }

  const teamPending = teamPendingRequests(results).map((entry) => {
    return { ...entry, hours: durationHours(entry.requestedAt, now) };
  });

  const pending: PendingEntry[] = pendingRequests(results).map((entry) => {
    return { ...entry, hours: durationHours(entry.requestedAt, now) };
  });

  if (includeTeam) {
    pending.push(...teamPending);
    pending.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
  }

  const reviewing = latestReviews(results).map((entry) => {
    return { ...entry, hours: durationHours(entry.reviewedAt, now) };
  });

  const expired = results.filter(
    (result) =>
      (result.kind === 'pending' || (includeTeam && result.kind === 'team-pending')) && result.pr.state !== 'open',
  );

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

  const cyclesByPr = new Map<string, number>();

  for (const result of reviewed) {
    const key = `${result.pr.repo}#${result.pr.number}`;

    cyclesByPr.set(key, (cyclesByPr.get(key) ?? 0) + 1);
  }

  return {
    reviewed,
    pending,
    reviewing,
    expired,
    unrequested,
    teamReviewed,
    teamPending,
    allHours,
    byRepo,
    misses,
    cycles: [...cyclesByPr.values()],
  };
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
  merged: MergedEntry[];
  closed: ClosedEntry[];
  open: SizeEntry[];
  allHours: number[];
}

/**
 * GitHub reports a merged PR as closed too, and a reopened PR keeps its old close time.
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

export interface ReviewerRow {
  login: string;
  prs: number;
  reviews: number;
}

export interface ReviewerStats {
  leaderboard: ReviewerRow[];
  mergedReviewed: number;
  mergedUnreviewed: number;
}

/**
 * GitHub records the author's inline replies as reviews too.
 */
export function computeReviewerStats(sizes: SizeEntry[], author: string): ReviewerStats {
  const byLogin = new Map<string, { prs: number; reviews: number }>();

  let mergedReviewed = 0;
  let mergedUnreviewed = 0;

  for (const entry of sizes) {
    const others = entry.reviews.flatMap((review) =>
      review.login === null || review.login === author ? [] : [review.login],
    );

    for (const login of others) {
      const counts = byLogin.get(login) ?? { prs: 0, reviews: 0 };

      counts.reviews += 1;

      byLogin.set(login, counts);
    }

    const distinct = new Set(others);

    for (const login of distinct) {
      const counts = byLogin.get(login);

      if (counts !== undefined) {
        counts.prs += 1;
      }
    }

    if (entry.mergedAt !== null) {
      if (others.length > 0) {
        mergedReviewed += 1;
      } else {
        mergedUnreviewed += 1;
      }
    }
  }

  const leaderboard = [...byLogin.entries()]
    .map(([login, counts]) => {
      return { login, ...counts };
    })
    .toSorted((a, b) => b.prs - a.prs || b.reviews - a.reviews || a.login.localeCompare(b.login));

  return { leaderboard, mergedReviewed, mergedUnreviewed };
}

export interface FirstReviewEntry {
  entry: SizeEntry;
  reviewedAt: Date;
  hours: number;
}

export interface AwaitingFirstReview {
  entry: SizeEntry;
  hours: number;
}

export interface FirstReviewStats {
  received: FirstReviewEntry[];
  awaiting: AwaitingFirstReview[];
  allHours: number[];
}

export function firstReviewOf(entry: SizeEntry, author: string): { reviewedAt: Date; hours: number } | null {
  let earliest: Date | null = null;

  for (const review of entry.reviews) {
    if (review.login === null || review.login === author || review.submittedAt === null) {
      continue;
    }

    if (earliest === null || review.submittedAt < earliest) {
      earliest = review.submittedAt;
    }
  }

  if (earliest === null) {
    return null;
  }

  return { reviewedAt: earliest, hours: durationHours(entry.pr.createdAt, earliest) };
}

export function computeFirstReviewStats(
  sizes: SizeEntry[],
  author: string,
  { now = new Date() }: { now?: Date } = {},
): FirstReviewStats {
  const received: FirstReviewEntry[] = [];
  const awaiting: AwaitingFirstReview[] = [];

  for (const entry of sizes) {
    const first = firstReviewOf(entry, author);

    if (first !== null) {
      received.push({ entry, ...first });
    } else if (entry.pr.state === 'open') {
      awaiting.push({ entry, hours: durationHours(entry.pr.createdAt, now) });
    }
  }

  awaiting.sort((a, b) => a.entry.pr.createdAt.getTime() - b.entry.pr.createdAt.getTime());

  return { received, awaiting, allHours: received.map((result) => result.hours) };
}

export interface CommentStats {
  metrics: SizeMetric[];
  totals: number[];
  uncommented: number;
  top: SizeEntry[];
}

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
