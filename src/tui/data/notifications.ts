import { readCacheFile, writeCacheFile } from '../../cache';
import type { MentionedPr, MentionEntry, ReviewPr, ReviewResult } from '../../data';

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
 * Holds what the mention diff knows after one load. The seen set holds
 * the ids of every text that mentioned you in this load and in every
 * earlier one the baseline descends from, so a PR that drops out of the
 * results and comes back does not report its old mentions again. The
 * observation time is when the load that produced the baseline read
 * GitHub, in milliseconds, so the next load can tell a text that was
 * written since from one it had merely not seen before. The unread map
 * holds the PRs, keyed by repo#number, that a load could not read, each
 * with the observation time that still applies to it, because a load
 * that failed to read a PR has not observed it and must not move its
 * cutoff past a mention it never saw. An entry stays until a load reads
 * the PR.
 */
export interface MentionBaseline {
  seen: Set<string>;
  observedAt: number;
  unread: Map<string, number>;
}

export interface MentionChanges {
  /**
   * Holds the mentions of this load, which becomes the baseline the next
   * load diffs against.
   */
  baseline: MentionBaseline;
  /**
   * Lists the PRs with a mention the baseline did not know, in the order
   * the entries hold them.
   */
  newMentions: MentionedPr[];
}

/**
 * Margin the diff allows a text to predate the previous observation and
 * still count as new. The search that finds the mentioned PRs runs on an
 * index that trails the live data by a little, so a PR mentioned shortly
 * before a load can miss that load's search and turn up in the next one.
 * The margin also covers the time the previous load spent between its
 * search and its end, which is when its observation time is taken. A
 * text within the margin can only be a mention that was never reported,
 * because a text the previous load had seen is in the seen set.
 */
const OBSERVATION_MARGIN_MS = 10 * 60 * 1000;

/**
 * Diffs the mentions of a fresh load against the baseline of the previous
 * one. A text is a new mention when the baseline has not seen it and it
 * became visible after the previous observation, less the margin. The
 * first condition keeps a text quiet that was reported before, however
 * often its PR drops out of the results and returns, and however often
 * its author edits it. The second keeps an old text quiet that the
 * baseline never saw, because its PR only now entered the update window
 * after unrelated activity, was cut from the startup snapshot, or was
 * unreadable during the previous load. A null baseline marks the first
 * mention list of a session, the startup snapshot or the first load with
 * mentions, which only establishes the baseline, so turning the setting
 * on never floods the desktop with every mention already there. Closed
 * PRs count like open ones, because a mention on a merged PR still asks
 * for your attention. The observation time is when this load read
 * GitHub, which the returned baseline carries for the next diff.
 *
 * A PR the load could not read comes with null mentions. Its cutoff
 * stays where it was, so the next load that reads it compares its texts
 * against the last observation that covered it, and a mention that
 * arrived while the PR was unreadable still counts once it can be read.
 *
 * The texts the since window cut from an entry join the seen set along
 * with its mentions, so an edit that carries one of them into the window
 * never reports a mention from before the window as new.
 */
export function diffMentions(
  previous: MentionBaseline | null,
  entries: MentionEntry[],
  observedAt: Date,
): MentionChanges {
  const seen = new Set(previous?.seen);
  const unread = new Map(previous?.unread);
  const newMentions: MentionedPr[] = [];

  for (const entry of entries) {
    const key = `${entry.pr.repo}#${entry.pr.number}`;
    const cutoff = previous === null ? observedAt.getTime() : (previous.unread.get(key) ?? previous.observedAt);

    if (entry.mentions === null) {
      unread.set(key, cutoff);

      continue;
    }

    unread.delete(key);

    let isNew = false;

    for (const mention of entry.mentions) {
      if (
        previous !== null &&
        !previous.seen.has(mention.id) &&
        mention.at.getTime() > cutoff - OBSERVATION_MARGIN_MS
      ) {
        isNew = true;
      }

      seen.add(mention.id);
    }

    for (const id of entry.earlier) {
      seen.add(id);
    }

    if (isNew) {
      newMentions.push(entry.pr);
    }
  }

  return { baseline: { seen, observedAt: observedAt.getTime(), unread }, newMentions };
}

/**
 * On-disk shape of the mention baseline, together with the fetch
 * params key it was built for, so a baseline built for other options
 * never seeds a session.
 */
interface StoredMentionBaseline {
  key: string;
  seen: string[];
  observedAt: number;
  unread: [string, number][];
}

/**
 * Writes the mention baseline of the given fetch params key to the cache
 * directory, so the next session continues from it instead of from the
 * startup snapshot alone. The snapshot only holds the last load, which
 * loses the held cutoffs of the PRs that load could not read and the
 * texts of PRs that had dropped out of its results, and the persisted
 * baseline keeps both. A null baseline clears the file, which the loads
 * without mention data use so a stale baseline never seeds the session
 * after the setting comes back on. The seen set grows with every text
 * that ever mentioned you, a few dozen bytes each, which stays small
 * over years of use. Returns false without writing while the cache is
 * disabled.
 */
export function saveMentionBaseline(key: string, baseline: MentionBaseline | null): boolean {
  if (baseline === null) {
    return writeCacheFile('mention-baseline', null);
  }

  const stored: StoredMentionBaseline = {
    key,
    seen: [...baseline.seen],
    observedAt: baseline.observedAt,
    unread: [...baseline.unread],
  };

  return writeCacheFile('mention-baseline', stored);
}

/**
 * Reads the persisted mention baseline back when it was built for the
 * given fetch params key. Returns null for a missing file, a cleared
 * baseline, or one built for other options.
 */
export function loadMentionBaseline(key: string): MentionBaseline | null {
  const stored = readCacheFile('mention-baseline') as StoredMentionBaseline | null;

  if (stored === null || stored.key !== key) {
    return null;
  }

  return { seen: new Set(stored.seen), observedAt: stored.observedAt, unread: new Map(stored.unread) };
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

/**
 * Turns the PRs with a new mention of you into one notification, or none
 * when no mention is new. The shape follows the request notifications, a
 * single PR by reference with its title as the body and several PRs by
 * count with a capped list.
 */
export function describeMentions(changes: MentionChanges): Notification[] {
  if (changes.newMentions.length === 0) {
    return [];
  }

  return [describe(changes.newMentions, 'Mentioned on', 'PRs mention you')];
}

/**
 * The fields of a PR a notification names, which every PR shape the
 * loads produce carries.
 */
interface NotifiablePr {
  repo: string;
  number: number;
  title: string;
}

function describe(prs: NotifiablePr[], singleTitle: string, pluralTitle: string): Notification {
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

function refOf(pr: NotifiablePr): string {
  return `${pr.repo}#${pr.number}`;
}
