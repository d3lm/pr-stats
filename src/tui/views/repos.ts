import { latestReviews, pendingRequests, teamPendingRequests } from '../../compute';
import { emptyMentionReads, mentionItems, splitMentions, type MentionReads } from '../../mentions';
import { splitSnoozed, type Snooze } from '../../snooze';
import type { RawData } from '../data/load';

export interface RepoOption {
  /**
   * Holds the repo the entry opens, where null selects the aggregate view
   * across every repo.
   */
  repo: string | null;
  label: string;
  detail: string;
}

/**
 * Formats the picker detail for one repo on the review tab.
 */
function reviewDetail(counts: { reviewed: number; pending: number }): string {
  return `${counts.reviewed} reviewed` + (counts.pending > 0 ? `, ${counts.pending} pending` : '');
}

/**
 * Formats the picker detail for one repo on the size tab.
 */
function sizeDetail(count: number): string {
  return `${count} authored ${count === 1 ? 'PR' : 'PRs'}`;
}

/**
 * Builds the entries for the repo picker on the review tab. The team flag
 * mirrors the team stats setting and counts the cycles a team of yours
 * was asked for into the details, so a repo that only reaches you through
 * a team does not read as zero while the charts count it. Returns an
 * empty array when the data spans at most one repo, in which case the tab
 * skips the picker and renders the charts directly.
 */
export function buildReviewRepoOptions(raw: RawData, teamReviewStats = false): RepoOption[] {
  const countsByRepo = new Map<string, { reviewed: number; pending: number }>();

  for (const result of raw.reviewResults) {
    const counts = countsByRepo.get(result.pr.repo) ?? { reviewed: 0, pending: 0 };

    if (result.kind === 'reviewed' || (teamReviewStats && result.kind === 'team-reviewed')) {
      counts.reviewed += 1;
    } else if (
      (result.kind === 'pending' || (teamReviewStats && result.kind === 'team-pending')) &&
      result.pr.state === 'open'
    ) {
      counts.pending += 1;
    }

    countsByRepo.set(result.pr.repo, counts);
  }

  if (countsByRepo.size < 2) {
    return [];
  }

  const entries = [...countsByRepo.entries()].toSorted(
    (a, b) => b[1].reviewed - a[1].reviewed || b[1].pending - a[1].pending || a[0].localeCompare(b[0]),
  );

  const totals = { reviewed: 0, pending: 0 };

  for (const [, counts] of entries) {
    totals.reviewed += counts.reviewed;
    totals.pending += counts.pending;
  }

  return [
    { repo: null, label: 'All repos', detail: reviewDetail(totals) },
    ...entries.map(([repo, counts]) => {
      return { repo, label: repo, detail: reviewDetail(counts) };
    }),
  ];
}

/**
 * Builds the entries for the repo picker on the size tab. Returns an empty
 * array when the analyzed PRs span at most one repo, in which case the tab
 * skips the picker and renders the charts directly.
 */
export function buildSizeRepoOptions(raw: RawData): RepoOption[] {
  const countByRepo = new Map<string, number>();

  for (const size of raw.sizes) {
    countByRepo.set(size.pr.repo, (countByRepo.get(size.pr.repo) ?? 0) + 1);
  }

  if (countByRepo.size < 2) {
    return [];
  }

  const entries = [...countByRepo.entries()].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return [
    { repo: null, label: 'All repos', detail: sizeDetail(raw.sizes.length) },
    ...entries.map(([repo, count]) => {
      return { repo, label: repo, detail: sizeDetail(count) };
    }),
  ];
}

/**
 * Builds a picker from per-repo counts, All repos with the totals first
 * and then every repo in the given order, each described by the detail
 * formatter. Returns an empty array below two repos, in which case the
 * tab skips the picker and renders its content directly.
 */
function pickerOf<T extends Record<string, number>>(
  countsByRepo: Map<string, T>,
  zero: () => T,
  order: (a: T, b: T) => number,
  detail: (counts: T) => string,
): RepoOption[] {
  if (countsByRepo.size < 2) {
    return [];
  }

  const entries = [...countsByRepo.entries()].toSorted((a, b) => order(a[1], b[1]) || a[0].localeCompare(b[0]));
  const totals: Record<string, number> = zero();

  for (const [, counts] of entries) {
    for (const [key, count] of Object.entries(counts)) {
      totals[key] += count;
    }
  }

  return [
    { repo: null, label: 'All repos', detail: detail(totals as T) },
    ...entries.map(([repo, counts]) => {
      return { repo, label: repo, detail: detail(counts) };
    }),
  ];
}

/**
 * Adds one to the given count of the given repo. The maps are filled
 * with every repo of the data before the counting starts, so a repo the
 * map lacks cannot occur and is left alone rather than invented.
 */
function bump<T extends Record<string, number>>(countsByRepo: Map<string, T>, repo: string, key: keyof T & string) {
  const counts: Record<string, number> | undefined = countsByRepo.get(repo);

  if (counts !== undefined) {
    counts[key] += 1;
  }
}

/**
 * Collects one zeroed counts object per repo with review activity, so
 * the pickers of the awaiting and the reviewed sub-tabs list the same
 * repos as the review tab's picker.
 */
function reviewRepos<T>(raw: RawData, zero: () => T): Map<string, T> {
  const countsByRepo = new Map<string, T>();

  for (const result of raw.reviewResults) {
    if (!countsByRepo.has(result.pr.repo)) {
      countsByRepo.set(result.pr.repo, zero());
    }
  }

  return countsByRepo;
}

interface PendingCounts extends Record<string, number> {
  awaiting: number;
  team: number;
  snoozed: number;
}

function zeroPending(): PendingCounts {
  return { awaiting: 0, team: 0, snoozed: 0 };
}

/**
 * Formats the picker detail for one repo on the awaiting sub-tab.
 */
function pendingDetail(counts: PendingCounts): string {
  const awaiting = `${counts.awaiting} ${counts.awaiting === 1 ? 'PR' : 'PRs'} awaiting your review`;

  return (
    awaiting +
    (counts.team > 0 ? `, ${counts.team} requested of your team` : '') +
    (counts.snoozed > 0 ? `, ${counts.snoozed} snoozed` : '')
  );
}

/**
 * Builds the entries for the repo picker on the awaiting sub-tab of the
 * Awaiting you tab. The repos mirror the review tab's picker, every repo
 * with review activity, so this tab shows its picker whenever that tab
 * does. The details count the open PRs still awaiting a review, which
 * can be zero, next to the ones requested of a team of yours and the
 * snoozed ones of either kind. The snoozes decide which pending PRs
 * count as snoozed at the given time, which defaults to the current time
 * like the queue view, and the team flag mirrors the team setting, so
 * the team requests stay out of the counts while the queue hides them.
 * Returns an empty array when the data spans at most one repo, in which
 * case the tab skips the picker and renders the queue directly.
 */
export function buildPendingRepoOptions(
  raw: RawData,
  snoozes: readonly Snooze[] = [],
  now = Date.now(),
  teamReviews = true,
): RepoOption[] {
  const countsByRepo = reviewRepos(raw, zeroPending);

  if (countsByRepo.size < 2) {
    return [];
  }

  const { awaiting, snoozed } = splitSnoozed(pendingRequests(raw.reviewResults), snoozes, now);

  const { awaiting: team, snoozed: snoozedTeam } = splitSnoozed(
    teamReviews ? teamPendingRequests(raw.reviewResults) : [],
    snoozes,
    now,
  );

  for (const entry of awaiting) {
    bump(countsByRepo, entry.pr.repo, 'awaiting');
  }

  for (const entry of team) {
    bump(countsByRepo, entry.pr.repo, 'team');
  }

  for (const entry of [...snoozed, ...snoozedTeam]) {
    bump(countsByRepo, entry.pr.repo, 'snoozed');
  }

  return pickerOf(
    countsByRepo,
    zeroPending,
    (a, b) => b.awaiting - a.awaiting || b.team - a.team || b.snoozed - a.snoozed,
    pendingDetail,
  );
}

interface ReviewedCounts extends Record<string, number> {
  reviewed: number;
}

function zeroReviewed(): ReviewedCounts {
  return { reviewed: 0 };
}

/**
 * Formats the picker detail for one repo on the reviewed sub-tab.
 */
function reviewedDetail(counts: ReviewedCounts): string {
  return `${counts.reviewed} reviewed ${counts.reviewed === 1 ? 'PR' : 'PRs'} still open`;
}

/**
 * Builds the entries for the repo picker on the reviewed sub-tab of the
 * Awaiting you tab. The repos mirror the review tab's picker like the
 * awaiting sub-tab, and the details count the open PRs you already
 * reviewed, which can be zero. Returns an empty array when the data
 * spans at most one repo, in which case the tab skips the picker and
 * renders the list directly.
 */
export function buildReviewedRepoOptions(raw: RawData): RepoOption[] {
  const countsByRepo = reviewRepos(raw, zeroReviewed);

  if (countsByRepo.size < 2) {
    return [];
  }

  for (const entry of latestReviews(raw.reviewResults)) {
    bump(countsByRepo, entry.pr.repo, 'reviewed');
  }

  return pickerOf(countsByRepo, zeroReviewed, (a, b) => b.reviewed - a.reviewed, reviewedDetail);
}

interface MentionCounts extends Record<string, number> {
  unread: number;
  snoozed: number;
  read: number;
}

function zeroMentions(): MentionCounts {
  return { unread: 0, snoozed: 0, read: 0 };
}

/**
 * Formats the picker detail for one repo on the mentions sub-tab.
 */
function mentionDetail(counts: MentionCounts): string {
  const unread = `${counts.unread} unread ${counts.unread === 1 ? 'mention' : 'mentions'}`;

  return (
    unread +
    (counts.snoozed > 0 ? `, ${counts.snoozed} snoozed` : '') +
    (counts.read > 0 ? `, ${counts.read} read` : '')
  );
}

/**
 * Builds the entries for the repo picker on the mentions sub-tab of the
 * Awaiting you tab, every repo with a PR that mentions you, most unread
 * first. The details count the unread mentions, which can be zero, next
 * to the snoozed and the read ones. The snoozes and the read state decide
 * where each mention counts at the given time, which defaults to the
 * current time like the queue view. Returns an empty array when the
 * mentions span at most one repo, or while the data holds no mentions,
 * in which case the tab skips the picker and renders the inbox directly.
 */
export function buildMentionRepoOptions(
  raw: RawData,
  snoozes: readonly Snooze[] = [],
  reads: MentionReads = emptyMentionReads(),
  now = Date.now(),
): RepoOption[] {
  const countsByRepo = new Map<string, MentionCounts>();
  const items = mentionItems(raw.mentions ?? []);

  for (const item of items) {
    if (!countsByRepo.has(item.pr.repo)) {
      countsByRepo.set(item.pr.repo, zeroMentions());
    }
  }

  if (countsByRepo.size < 2) {
    return [];
  }

  const { unread, snoozed, read } = splitMentions(items, reads, snoozes, now);

  for (const [state, group] of [
    ['unread', unread],
    ['snoozed', snoozed],
    ['read', read],
  ] as const) {
    for (const item of group) {
      bump(countsByRepo, item.pr.repo, state);
    }
  }

  return pickerOf(
    countsByRepo,
    zeroMentions,
    (a, b) => b.unread - a.unread || b.snoozed - a.snoozed || b.read - a.read,
    mentionDetail,
  );
}

/**
 * Formats the picker detail for one repo on the open-PRs tab.
 */
function openDetail(count: number): string {
  return `${count} open ${count === 1 ? 'PR' : 'PRs'}`;
}

/**
 * Builds the entries for the repo picker on the open-PRs tab. The repos
 * mirror the size tab's picker, every repo with an analyzed authored PR,
 * so this tab shows its picker whenever that tab does, and the details
 * count your authored PRs that are still open, which can be zero. Returns
 * an empty array when the analyzed PRs span at most one repo, in which
 * case the tab skips the picker and renders the list directly.
 */
export function buildOpenRepoOptions(raw: RawData): RepoOption[] {
  const countByRepo = new Map<string, number>();

  for (const size of raw.sizes) {
    const open = size.pr.state === 'open' ? 1 : 0;

    countByRepo.set(size.pr.repo, (countByRepo.get(size.pr.repo) ?? 0) + open);
  }

  if (countByRepo.size < 2) {
    return [];
  }

  const entries = [...countByRepo.entries()].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  return [
    { repo: null, label: 'All repos', detail: openDetail(total) },
    ...entries.map(([repo, count]) => {
      return { repo, label: repo, detail: openDetail(count) };
    }),
  ];
}

/**
 * Formats the picker detail for one repo on the merged sub-tab of the
 * Your PRs tab.
 */
function mergedDetail(counts: { merged: number; closed: number }): string {
  return `${counts.merged} merged` + (counts.closed > 0 ? `, ${counts.closed} closed unmerged` : '');
}

/**
 * Builds the entries for the repo picker on the merged sub-tab of the
 * Your PRs tab. The repos mirror the size tab's picker, every repo with
 * an analyzed authored PR, so this sub-tab shows its picker whenever the
 * open sub-tab does, and the details count the merged and the
 * closed-unmerged PRs, which can both be zero. Returns an empty array
 * when the analyzed PRs span at most one repo, in which case the sub-tab
 * skips the picker and renders the charts directly.
 */
export function buildMergedRepoOptions(raw: RawData): RepoOption[] {
  const countsByRepo = new Map<string, { merged: number; closed: number }>();

  for (const size of raw.sizes) {
    const counts = countsByRepo.get(size.pr.repo) ?? { merged: 0, closed: 0 };

    if (size.mergedAt !== null) {
      counts.merged += 1;
    } else if (size.pr.state !== 'open') {
      counts.closed += 1;
    }

    countsByRepo.set(size.pr.repo, counts);
  }

  if (countsByRepo.size < 2) {
    return [];
  }

  const entries = [...countsByRepo.entries()].toSorted(
    (a, b) => b[1].merged - a[1].merged || b[1].closed - a[1].closed || a[0].localeCompare(b[0]),
  );

  const totals = { merged: 0, closed: 0 };

  for (const [, counts] of entries) {
    totals.merged += counts.merged;
    totals.closed += counts.closed;
  }

  return [
    { repo: null, label: 'All repos', detail: mergedDetail(totals) },
    ...entries.map(([repo, counts]) => {
      return { repo, label: repo, detail: mergedDetail(counts) };
    }),
  ];
}

/**
 * Formats the picker detail for one repo on the comments tab.
 */
function commentDetail(comments: number, prs: number): string {
  return `${comments} ${comments === 1 ? 'comment' : 'comments'} on ${prs} ${prs === 1 ? 'PR' : 'PRs'}`;
}

/**
 * Builds the entries for the repo picker on the comments tab. Returns an
 * empty array when the analyzed PRs span at most one repo, in which case
 * the tab skips the picker and renders the charts directly.
 */
export function buildCommentRepoOptions(raw: RawData): RepoOption[] {
  const countsByRepo = new Map<string, { prs: number; comments: number }>();

  for (const size of raw.sizes) {
    const counts = countsByRepo.get(size.pr.repo) ?? { prs: 0, comments: 0 };

    counts.prs += 1;
    counts.comments += size.comments.total;
    countsByRepo.set(size.pr.repo, counts);
  }

  if (countsByRepo.size < 2) {
    return [];
  }

  const entries = [...countsByRepo.entries()].toSorted(
    (a, b) => b[1].comments - a[1].comments || b[1].prs - a[1].prs || a[0].localeCompare(b[0]),
  );

  const totals = { prs: 0, comments: 0 };

  for (const [, counts] of entries) {
    totals.prs += counts.prs;
    totals.comments += counts.comments;
  }

  return [
    { repo: null, label: 'All repos', detail: commentDetail(totals.comments, totals.prs) },
    ...entries.map(([repo, counts]) => {
      return { repo, label: repo, detail: commentDetail(counts.comments, counts.prs) };
    }),
  ];
}
