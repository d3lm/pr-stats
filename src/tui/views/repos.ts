import { latestReviews, pendingRequests, teamPendingRequests } from '../../compute';
import { emptyMentionReads, mentionItems, splitMentions, type MentionReads } from '../../mentions';
import { splitSnoozed, type Snooze } from '../../snooze';
import type { RawData } from '../data/load';

/**
 * Holds one repository, `owner/*` for every repository of an owner, or null for every repository.
 */
export type RepoScope = string | null;

export interface RepoOption {
  repo: RepoScope;
  label: string;
  detail: string;
}

const OWNER_SUFFIX = '/*';

export function inRepoScope(repo: string, scope: RepoScope): boolean {
  if (scope === null) {
    return true;
  }

  return scope.endsWith(OWNER_SUFFIX) ? repo.startsWith(scope.slice(0, -1)) : repo === scope;
}

export function spansRepos(scope: RepoScope): boolean {
  return scope === null || scope.endsWith(OWNER_SUFFIX);
}

export function scopeLabel(scope: RepoScope): string {
  if (scope === null) {
    return 'All repos';
  }

  return scope.endsWith(OWNER_SUFFIX) ? `All repos in ${scope.slice(0, -OWNER_SUFFIX.length)}` : scope;
}

function totalOf<T extends Record<string, number>>(list: T[], zero: () => T): T {
  const total: Record<string, number> = zero();

  for (const counts of list) {
    for (const [key, count] of Object.entries(counts)) {
      total[key] += count;
    }
  }

  return total as T;
}

/**
 * Adds a row for each owner with several repositories once the data spans several owners, so a
 * whole organization can be picked without changing the search.
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
  const countsByOwner = new Map<string, T[]>();

  for (const [repo, counts] of entries) {
    const owner = repo.slice(0, repo.indexOf('/'));

    countsByOwner.set(owner, [...(countsByOwner.get(owner) ?? []), counts]);
  }

  const owners = countsByOwner.size < 2 ? [] : [...countsByOwner.entries()].filter(([, list]) => list.length > 1);

  return [
    {
      repo: null,
      label: scopeLabel(null),
      detail: detail(
        totalOf(
          entries.map(([, counts]) => counts),
          zero,
        ),
      ),
    },
    ...owners.map(([owner, list]) => {
      const scope = owner + OWNER_SUFFIX;

      return { repo: scope, label: scopeLabel(scope), detail: detail(totalOf(list, zero)) };
    }),
    ...entries.map(([repo, counts]) => {
      return { repo, label: repo, detail: detail(counts) };
    }),
  ];
}

function bump<T extends Record<string, number>>(countsByRepo: Map<string, T>, repo: string, key: keyof T & string) {
  const counts: Record<string, number> | undefined = countsByRepo.get(repo);

  if (counts !== undefined) {
    counts[key] += 1;
  }
}

function countsOf<T>(countsByRepo: Map<string, T>, repo: string, zero: () => T): T {
  let counts = countsByRepo.get(repo);

  if (counts === undefined) {
    counts = zero();

    countsByRepo.set(repo, counts);
  }

  return counts;
}

interface ReviewCounts extends Record<string, number> {
  reviewed: number;
  pending: number;
}

function zeroReview(): ReviewCounts {
  return { reviewed: 0, pending: 0 };
}

function reviewDetail(counts: ReviewCounts): string {
  return `${counts.reviewed} reviewed` + (counts.pending > 0 ? `, ${counts.pending} pending` : '');
}

export function buildReviewRepoOptions(raw: RawData, teamReviewStats = false): RepoOption[] {
  const countsByRepo = new Map<string, ReviewCounts>();

  for (const result of raw.reviewResults) {
    const counts = countsOf(countsByRepo, result.pr.repo, zeroReview);

    if (result.kind === 'reviewed' || (teamReviewStats && result.kind === 'team-reviewed')) {
      counts.reviewed += 1;
    } else if (
      (result.kind === 'pending' || (teamReviewStats && result.kind === 'team-pending')) &&
      result.pr.state === 'open'
    ) {
      counts.pending += 1;
    }
  }

  return pickerOf(countsByRepo, zeroReview, (a, b) => b.reviewed - a.reviewed || b.pending - a.pending, reviewDetail);
}

interface AuthoredCounts extends Record<string, number> {
  authored: number;
}

function zeroAuthored(): AuthoredCounts {
  return { authored: 0 };
}

function sizeDetail(counts: AuthoredCounts): string {
  return `${counts.authored} authored ${counts.authored === 1 ? 'PR' : 'PRs'}`;
}

export function buildSizeRepoOptions(raw: RawData): RepoOption[] {
  const countsByRepo = new Map<string, AuthoredCounts>();

  for (const size of raw.sizes) {
    countsOf(countsByRepo, size.pr.repo, zeroAuthored).authored += 1;
  }

  return pickerOf(countsByRepo, zeroAuthored, (a, b) => b.authored - a.authored, sizeDetail);
}

function reviewRepos<T>(raw: RawData, zero: () => T): Map<string, T> {
  const countsByRepo = new Map<string, T>();

  for (const result of raw.reviewResults) {
    countsOf(countsByRepo, result.pr.repo, zero);
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

function pendingDetail(counts: PendingCounts): string {
  const awaiting = `${counts.awaiting} ${counts.awaiting === 1 ? 'PR' : 'PRs'} awaiting your review`;

  return (
    awaiting +
    (counts.team > 0 ? `, ${counts.team} requested of your team` : '') +
    (counts.snoozed > 0 ? `, ${counts.snoozed} snoozed` : '')
  );
}

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

function reviewedDetail(counts: ReviewedCounts): string {
  return `${counts.reviewed} reviewed ${counts.reviewed === 1 ? 'PR' : 'PRs'} still open`;
}

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

function mentionDetail(counts: MentionCounts): string {
  const unread = `${counts.unread} unread ${counts.unread === 1 ? 'mention' : 'mentions'}`;

  return (
    unread +
    (counts.snoozed > 0 ? `, ${counts.snoozed} snoozed` : '') +
    (counts.read > 0 ? `, ${counts.read} read` : '')
  );
}

export function buildMentionRepoOptions(
  raw: RawData,
  snoozes: readonly Snooze[] = [],
  reads: MentionReads = emptyMentionReads(),
  now = Date.now(),
): RepoOption[] {
  const countsByRepo = new Map<string, MentionCounts>();
  const items = mentionItems(raw.mentions ?? []);

  for (const item of items) {
    countsOf(countsByRepo, item.pr.repo, zeroMentions);
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

interface OpenCounts extends Record<string, number> {
  open: number;
}

function zeroOpen(): OpenCounts {
  return { open: 0 };
}

function openDetail(counts: OpenCounts): string {
  return `${counts.open} open ${counts.open === 1 ? 'PR' : 'PRs'}`;
}

export function buildOpenRepoOptions(raw: RawData): RepoOption[] {
  const countsByRepo = new Map<string, OpenCounts>();

  for (const size of raw.sizes) {
    countsOf(countsByRepo, size.pr.repo, zeroOpen).open += size.pr.state === 'open' ? 1 : 0;
  }

  return pickerOf(countsByRepo, zeroOpen, (a, b) => b.open - a.open, openDetail);
}

interface MergedCounts extends Record<string, number> {
  merged: number;
  closed: number;
}

function zeroMerged(): MergedCounts {
  return { merged: 0, closed: 0 };
}

function mergedDetail(counts: MergedCounts): string {
  return `${counts.merged} merged` + (counts.closed > 0 ? `, ${counts.closed} closed unmerged` : '');
}

export function buildMergedRepoOptions(raw: RawData): RepoOption[] {
  const countsByRepo = new Map<string, MergedCounts>();

  for (const size of raw.sizes) {
    const counts = countsOf(countsByRepo, size.pr.repo, zeroMerged);

    if (size.mergedAt !== null) {
      counts.merged += 1;
    } else if (size.pr.state !== 'open') {
      counts.closed += 1;
    }
  }

  return pickerOf(countsByRepo, zeroMerged, (a, b) => b.merged - a.merged || b.closed - a.closed, mergedDetail);
}

interface CommentCounts extends Record<string, number> {
  prs: number;
  comments: number;
}

function zeroComments(): CommentCounts {
  return { prs: 0, comments: 0 };
}

function commentDetail({ comments, prs }: CommentCounts): string {
  return `${comments} ${comments === 1 ? 'comment' : 'comments'} on ${prs} ${prs === 1 ? 'PR' : 'PRs'}`;
}

export function buildCommentRepoOptions(raw: RawData): RepoOption[] {
  const countsByRepo = new Map<string, CommentCounts>();

  for (const size of raw.sizes) {
    const counts = countsOf(countsByRepo, size.pr.repo, zeroComments);

    counts.prs += 1;
    counts.comments += size.comments.total;
  }

  return pickerOf(countsByRepo, zeroComments, (a, b) => b.comments - a.comments || b.prs - a.prs, commentDetail);
}
