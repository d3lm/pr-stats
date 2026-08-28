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
 * Builds the entries for the repo picker on the review tab. Returns an
 * empty array when the data spans at most one repo, in which case the tab
 * skips the picker and renders the charts directly.
 */
export function buildReviewRepoOptions(raw: RawData): RepoOption[] {
  const countsByRepo = new Map<string, { reviewed: number; pending: number }>();

  for (const result of raw.reviewResults) {
    const counts = countsByRepo.get(result.pr.repo) ?? { reviewed: 0, pending: 0 };

    if (result.kind === 'reviewed') {
      counts.reviewed += 1;
    } else if (result.kind === 'pending' && result.pr.state === 'open') {
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
 * Formats the picker detail for one repo on the awaiting-review tab.
 */
function pendingDetail(count: number): string {
  return `${count} ${count === 1 ? 'PR' : 'PRs'} awaiting your review`;
}

/**
 * Builds the entries for the repo picker on the awaiting-review tab. The
 * repos mirror the review tab's picker, every repo with review activity,
 * so this tab shows its picker whenever that tab does, and the details
 * count the open PRs still awaiting a review, which can be zero. Returns
 * an empty array when the data spans at most one repo, in which case the
 * tab skips the picker and renders the queue directly.
 */
export function buildPendingRepoOptions(raw: RawData): RepoOption[] {
  const countByRepo = new Map<string, number>();

  for (const result of raw.reviewResults) {
    const pending = result.kind === 'pending' && result.pr.state === 'open' ? 1 : 0;

    countByRepo.set(result.pr.repo, (countByRepo.get(result.pr.repo) ?? 0) + pending);
  }

  if (countByRepo.size < 2) {
    return [];
  }

  const entries = [...countByRepo.entries()].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  return [
    { repo: null, label: 'All repos', detail: pendingDetail(total) },
    ...entries.map(([repo, count]) => {
      return { repo, label: repo, detail: pendingDetail(count) };
    }),
  ];
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
