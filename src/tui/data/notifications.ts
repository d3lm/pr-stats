import type { ReviewPr, ReviewResult } from '../../data';

/**
 * Holds the open PRs awaiting your review after one load, keyed by
 * repo#number with the time of the request that opened the pending
 * cycle in milliseconds. The next load diffs its own pending requests
 * against it to find what changed in between.
 */
export type RequestBaseline = Map<string, number>;

export interface ReviewRequestChanges {
  /**
   * Holds the pending requests of this load, which becomes the baseline
   * the next load diffs against.
   */
  baseline: RequestBaseline;
  /**
   * Lists the PRs that newly await your review without a review of
   * yours on them, in the order the results hold them.
   */
  newRequests: ReviewPr[];
  /**
   * Lists the PRs that came back to you after a review you completed,
   * in the order the results hold them.
   */
  reRequests: ReviewPr[];
}

/**
 * Diffs the pending review requests of a fresh load against the baseline
 * of the previous one. A pending result on an open PR that the baseline
 * lacks, or whose request is newer than the one the baseline holds, is a
 * change. It counts as a re-request when the PR also carries a completed
 * request-review cycle of yours and as a new request otherwise. The
 * newer-request rule catches a PR that was pending, got your review, and
 * came back to you all between two loads. A null baseline marks the
 * first result list of a session, the startup snapshot or the first
 * load without one, which only establishes the baseline, so a fresh
 * start never floods the desktop with everything already waiting.
 * Pending results on closed PRs and unrequested reviews never notify,
 * because a closed PR needs nothing and a team request never names you.
 */
export function diffReviewRequests(previous: RequestBaseline | null, results: ReviewResult[]): ReviewRequestChanges {
  const baseline: RequestBaseline = new Map();
  const reviewedKeys = new Set<string>();
  const pending: { key: string; pr: ReviewPr; requestedAt: number }[] = [];

  for (const result of results) {
    const key = `${result.pr.repo}#${result.pr.number}`;

    if (result.kind === 'reviewed') {
      reviewedKeys.add(key);
    } else if (result.kind === 'pending' && result.pr.state === 'open') {
      const requestedAt = result.requestedAt.getTime();

      baseline.set(key, requestedAt);
      pending.push({ key, pr: result.pr, requestedAt });
    }
  }

  if (previous === null) {
    return { baseline, newRequests: [], reRequests: [] };
  }

  const newRequests: ReviewPr[] = [];
  const reRequests: ReviewPr[] = [];

  for (const { key, pr, requestedAt } of pending) {
    const before = previous.get(key);

    if (before !== undefined && before >= requestedAt) {
      continue;
    }

    (reviewedKeys.has(key) ? reRequests : newRequests).push(pr);
  }

  return { baseline, newRequests, reRequests };
}

/**
 * One desktop notification as the notifier sends it.
 */
export interface Notification {
  title: string;
  body: string;
}

/**
 * Number of PRs a notification body lists by reference before it folds
 * the rest into a count, so a busy morning fits the few lines a desktop
 * notification shows.
 */
const MAX_LISTED = 3;

/**
 * The notification the settings dialog's test row sends, so the user can
 * confirm the desktop shows notifications before relying on them.
 */
export const TEST_NOTIFICATION: Notification = {
  title: 'pr-stats',
  body: 'Desktop notifications are working. New review requests show up like this.',
};

/**
 * Turns the changes of one load into at most two notifications, one for
 * the new requests and one for the re-requests. A single PR gets its
 * reference in the title and its PR title as the body, and several PRs
 * get a count in the title with their references listed in the body.
 * The body always leads with a repo#number reference, so it never starts
 * with a dash that a command line could mistake for an option.
 */
export function describeReviewRequests(changes: ReviewRequestChanges): Notification[] {
  const notifications: Notification[] = [];

  if (changes.newRequests.length > 0) {
    notifications.push(describe(changes.newRequests, 'Review requested on', 'new PRs awaiting your review'));
  }

  if (changes.reRequests.length > 0) {
    notifications.push(describe(changes.reRequests, 'Review re-requested on', 'PRs came back for review'));
  }

  return notifications;
}

/**
 * Turns the PRs whose snooze ended while they still await your review
 * into one notification, or none when no PR came back. The shape follows
 * the request notifications, a single PR by reference with its title as
 * the body and several PRs by count with a capped list.
 */
export function describeSnoozeWakeUps(prs: ReviewPr[]): Notification[] {
  if (prs.length === 0) {
    return [];
  }

  return [describe(prs, 'Snooze ended on', 'snoozed PRs are back in your queue')];
}

function describe(prs: ReviewPr[], singleTitle: string, pluralTitle: string): Notification {
  if (prs.length === 1) {
    const [pr] = prs;

    return { title: `${singleTitle} ${refOf(pr)}`, body: pr.title };
  }

  const lines = prs.slice(0, MAX_LISTED).map((pr) => `${refOf(pr)} ${pr.title}`);
  const rest = prs.length - lines.length;

  if (rest > 0) {
    lines.push(`and ${rest} more`);
  }

  return { title: `${prs.length} ${pluralTitle}`, body: lines.join('\n') };
}

function refOf(pr: ReviewPr): string {
  return `${pr.repo}#${pr.number}`;
}
