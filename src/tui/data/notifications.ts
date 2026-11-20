import { readCacheFile, writeCacheFile } from '../../cache';
import type { MentionedPr, MentionEntry, ReviewPr, ReviewResult } from '../../data';

export type RequestBaseline = Map<string, number>;

export interface ReviewRequestChanges {
  baseline: RequestBaseline;
  newRequests: ReviewPr[];
  reRequests: ReviewPr[];
  teamRequests: ReviewPr[];
}

export function diffReviewRequests(
  previous: RequestBaseline | null,
  results: ReviewResult[],
  includeTeam = false,
): ReviewRequestChanges {
  const baseline: RequestBaseline = new Map();
  const reviewedKeys = new Set<string>();
  const pending: { key: string; pr: ReviewPr; requestedAt: number; team: boolean }[] = [];

  for (const result of results) {
    const key = `${result.pr.repo}#${result.pr.number}`;

    if (result.kind === 'reviewed') {
      reviewedKeys.add(key);
    } else if ((result.kind === 'pending' || result.kind === 'team-pending') && result.pr.state === 'open') {
      const requestedAt = result.requestedAt.getTime();

      baseline.set(key, requestedAt);
      pending.push({ key, pr: result.pr, requestedAt, team: result.kind === 'team-pending' });
    }
  }

  if (previous === null) {
    return { baseline, newRequests: [], reRequests: [], teamRequests: [] };
  }

  const newRequests: ReviewPr[] = [];
  const reRequests: ReviewPr[] = [];
  const teamRequests: ReviewPr[] = [];

  for (const { key, pr, requestedAt, team } of pending) {
    const before = previous.get(key);

    if (before !== undefined && before >= requestedAt) {
      continue;
    }

    if (team) {
      if (includeTeam) {
        teamRequests.push(pr);
      }

      continue;
    }

    const requests = reviewedKeys.has(key) ? reRequests : newRequests;

    requests.push(pr);
  }

  return { baseline, newRequests, reRequests, teamRequests };
}

export interface MentionBaseline {
  seen: Set<string>;
  observedAt: number;
  unread: Map<string, number>;
}

export interface MentionChanges {
  baseline: MentionBaseline;
  newMentions: MentionedPr[];
}

/**
 * The mention search index trails live data, so a mention shortly before a load can first appear in
 * the next one.
 */
const OBSERVATION_MARGIN_MS = 10 * 60 * 1000;

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

interface StoredMentionBaseline {
  key: string;
  seen: string[];
  observedAt: number;
  unread: [string, number][];
}

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

export function loadMentionBaseline(key: string): MentionBaseline | null {
  const stored = readCacheFile('mention-baseline') as StoredMentionBaseline | null;

  if (stored === null || stored.key !== key) {
    return null;
  }

  return { seen: new Set(stored.seen), observedAt: stored.observedAt, unread: new Map(stored.unread) };
}

export interface Notification {
  title: string;
  body: string;
}

const MAX_LISTED = 3;

export const TEST_NOTIFICATION: Notification = {
  title: 'pr-stats',
  body: 'Desktop notifications are working. New review requests show up like this.',
};

export function describeReviewRequests(changes: ReviewRequestChanges): Notification[] {
  const notifications: Notification[] = [];

  if (changes.newRequests.length > 0) {
    notifications.push(describe(changes.newRequests, 'Review requested on', 'new PRs awaiting your review'));
  }

  if (changes.reRequests.length > 0) {
    notifications.push(describe(changes.reRequests, 'Review re-requested on', 'PRs came back for review'));
  }

  if (changes.teamRequests.length > 0) {
    notifications.push(
      describe(changes.teamRequests, 'Review requested of your team on', 'new PRs requested of your team'),
    );
  }

  return notifications;
}

export function describeSnoozeWakeUps(prs: ReviewPr[]): Notification[] {
  if (prs.length === 0) {
    return [];
  }

  return [describe(prs, 'Snooze ended on', 'snoozed PRs are back in your queue')];
}

export function describeMentions(changes: MentionChanges): Notification[] {
  if (changes.newMentions.length === 0) {
    return [];
  }

  return [describe(changes.newMentions, 'Mentioned on', 'PRs mention you')];
}

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
