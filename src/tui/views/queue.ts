import { prKey } from '../../cache';
import {
  latestReviews,
  pendingRequests,
  teamPendingRequests,
  type LatestReview,
  type PendingRequest,
  type TeamPendingRequest,
} from '../../compute';
import type { MentionedPr, ReviewPr } from '../../data';
import {
  emptyMentionReads,
  markOf,
  mentionItems,
  splitMentions,
  type MentionItem,
  type MentionReads,
} from '../../mentions';
import { formatWakeTime, splitSnoozed, type Snooze } from '../../snooze';
import { durationHours } from '../../time';
import type { RawData, SizeEntry } from '../data/load';
import { inRepoScope, spansRepos, type RepoScope } from './repos';
import { durationLead, toPrRows, type PrList, type PrRow } from './rows';

export interface QueueSection {
  title: string;
  rows: PrRow[];
  lists: PrList[];
}

export interface QueueView {
  empty: string | null;
  sections: QueueSection[];
}

export function queueRows(view: QueueView): PrRow[] {
  return view.sections.flatMap((section) => [...section.rows, ...section.lists.flatMap((list) => list.rows)]);
}

/**
 * Clamps like the panel does, so a stale cursor resolves to the highlighted row.
 */
export function queueRowAt(view: QueueView | null, cursor: number): PrRow | undefined {
  const rows = view === null ? [] : queueRows(view);

  return rows[Math.min(cursor, rows.length - 1)];
}

export function snoozeActionOf(row: PrRow | undefined): 'snooze' | 'unsnooze' | null {
  if (row?.pending !== undefined) {
    return row.pending.snoozed ? 'unsnooze' : 'snooze';
  }

  if (row?.mention === undefined || row.mention.state === 'read') {
    return null;
  }

  return row.mention.state === 'snoozed' ? 'unsnooze' : 'snooze';
}

export function mentionActionOf(row: PrRow | undefined): 'read' | 'unread' | null {
  if (row?.mention === undefined) {
    return null;
  }

  return row.mention.state === 'read' ? 'unread' : 'read';
}

export function unreadMentionRows(view: QueueView | null): PrRow[] {
  return view === null ? [] : queueRows(view).filter((row) => row.mention?.state === 'unread');
}

function groupedLists<T extends { pr: { repo: string } }>(entries: T[], rowsOf: (group: T[]) => PrRow[]): PrList[] {
  const groups = new Map<string, T[]>();

  for (const entry of entries) {
    const group = groups.get(entry.pr.repo) ?? [];

    group.push(entry);
    groups.set(entry.pr.repo, group);
  }

  return [...groups.entries()]
    .toSorted((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([repo, group]) => {
      return { title: `${repo} (n=${group.length})`, rows: rowsOf(group) };
    });
}

function inScopeOf<T extends { pr: { repo: string } }>(entries: T[], repo: RepoScope): T[] {
  return entries.filter((entry) => inRepoScope(entry.pr.repo, repo));
}

function sectionOf<T extends { pr: { repo: string } }>(
  title: string,
  entries: T[],
  rowsOf: (group: T[]) => PrRow[],
  split: boolean,
): QueueSection {
  return split
    ? { title, rows: [], lists: groupedLists(entries, rowsOf) }
    : { title, rows: rowsOf(entries), lists: [] };
}

function unreadMentionRefs(raw: RawData, snoozes: readonly Snooze[], reads: MentionReads, now: number): Set<string> {
  const { unread } = splitMentions(mentionItems(raw.mentions ?? []), reads, snoozes, now);

  return new Set(unread.map((item) => prKey(item.pr.repo, item.pr.number)));
}

export interface QueueAlerts {
  pending: boolean;
  mentions: boolean;
}

export function queueAlerts(
  raw: RawData,
  snoozes: readonly Snooze[] = [],
  reads: MentionReads = emptyMentionReads(),
  now = Date.now(),
  teamReviews = true,
): QueueAlerts {
  const { awaiting } = splitSnoozed(pendingRequests(raw.reviewResults), snoozes, now);
  const { awaiting: team } = splitSnoozed(teamReviews ? teamPendingRequests(raw.reviewResults) : [], snoozes, now);
  const { unread } = splitMentions(mentionItems(raw.mentions ?? []), reads, snoozes, now);

  return { pending: awaiting.length > 0 || team.length > 0, mentions: unread.length > 0 };
}

export function buildPendingReviewView(
  raw: RawData,
  repo: RepoScope = null,
  grouped = false,
  snoozes: readonly Snooze[] = [],
  reads: MentionReads = emptyMentionReads(),
  now = Date.now(),
  teamReviews = true,
): QueueView {
  const { awaiting, snoozed } = splitSnoozed(inScopeOf(pendingRequests(raw.reviewResults), repo), snoozes, now);

  const { awaiting: team, snoozed: snoozedTeam } = splitSnoozed(
    inScopeOf(teamReviews ? teamPendingRequests(raw.reviewResults) : [], repo),
    snoozes,
    now,
  );

  if (awaiting.length === 0 && team.length === 0 && snoozed.length === 0 && snoozedTeam.length === 0) {
    return { empty: 'No PRs are awaiting your review.', sections: [] };
  }

  const split = grouped && spansRepos(repo);
  const mentioned = unreadMentionRefs(raw, snoozes, reads, now);

  const awaitingRowsOf = (group: PendingRequest[]) =>
    waitRows(group, (entry) => entry.requestedAt, raw.fetchedAt).map((row, i) => {
      return {
        ...row,
        pending: { requestedAt: group[i].requestedAt.getTime(), snoozed: false },
        ...badgeOf(row, mentioned),
      };
    });

  const teamRowsOf = (group: TeamPendingRequest[]) =>
    awaitingRowsOf(group).map((row, i) => {
      return { ...row, team: group[i].team };
    });

  const parked = [...snoozed, ...snoozedTeam].toSorted((a, b) => a.until - b.until);

  const snoozedRowsOf = (group: (PendingRequest & { until: number; team?: string })[]) =>
    wakeRows(group, now).map((row, i) => {
      const { team: parkedTeam } = group[i];

      return {
        ...row,
        pending: { requestedAt: group[i].requestedAt.getTime(), snoozed: true },
        ...badgeOf(row, mentioned),
        ...(parkedTeam === undefined ? {} : { team: parkedTeam }),
      };
    });

  return {
    empty: null,
    sections: [
      ...(awaiting.length === 0
        ? []
        : [sectionOf(`Awaiting your review (n=${awaiting.length})`, awaiting, awaitingRowsOf, split)]),
      ...(team.length === 0 ? [] : [sectionOf(`Requested of your team (n=${team.length})`, team, teamRowsOf, split)]),
      ...(parked.length === 0 ? [] : [sectionOf(`Snoozed (n=${parked.length})`, parked, snoozedRowsOf, split)]),
    ],
  };
}

export function buildReviewedView(
  raw: RawData,
  repo: RepoScope = null,
  grouped = false,
  snoozes: readonly Snooze[] = [],
  reads: MentionReads = emptyMentionReads(),
  now = Date.now(),
): QueueView {
  const reviewing = inScopeOf(latestReviews(raw.reviewResults), repo);

  if (reviewing.length === 0) {
    return { empty: 'No PRs you reviewed are still open.', sections: [] };
  }

  const mentioned = unreadMentionRefs(raw, snoozes, reads, now);

  const reviewedRowsOf = (group: LatestReview[]) =>
    waitRows(group, (entry) => entry.reviewedAt, raw.fetchedAt).map((row) => {
      return { ...row, ...badgeOf(row, mentioned) };
    });

  return {
    empty: null,
    sections: [sectionOf(`Reviewed (n=${reviewing.length})`, reviewing, reviewedRowsOf, grouped && spansRepos(repo))],
  };
}

/**
 * Defaults the clock to now because a snooze ends on the wall clock rather than at the fetch.
 */
export function buildMentionsView(
  raw: RawData,
  repo: RepoScope = null,
  grouped = false,
  snoozes: readonly Snooze[] = [],
  reads: MentionReads = emptyMentionReads(),
  now = Date.now(),
): QueueView {
  if (raw.mentions === null) {
    return {
      empty: 'Mention tracking is off. Turn on Track mentions in the settings (S) to list the PRs that mention you.',
      sections: [],
    };
  }

  const { unread, snoozed, read } = splitMentions(inScopeOf(mentionItems(raw.mentions), repo), reads, snoozes, now);

  if (unread.length === 0 && snoozed.length === 0 && read.length === 0) {
    return { empty: 'No PR mentions you.', sections: [] };
  }

  const split = grouped && spansRepos(repo);

  const unreadRowsOf = (group: MentionItem[]) => mentionRows(group, 'unread', raw.fetchedAt);
  const readRowsOf = (group: MentionItem[]) => mentionRows(group, 'read', raw.fetchedAt);

  const snoozedRowsOf = (group: (MentionItem & { until: number })[]) =>
    wakeRows(group, now).map((row, i) => {
      return { ...row, mention: { mark: markOf(group[i]), state: 'snoozed' as const } };
    });

  return {
    empty: null,
    sections: [
      ...(unread.length === 0 ? [] : [sectionOf(`Unread (n=${unread.length})`, unread, unreadRowsOf, split)]),
      ...(snoozed.length === 0 ? [] : [sectionOf(`Snoozed (n=${snoozed.length})`, snoozed, snoozedRowsOf, split)]),
      ...(read.length === 0 ? [] : [sectionOf(`Read (n=${read.length})`, read, readRowsOf, split)]),
    ],
  };
}

function badgeOf(row: PrRow, mentioned: ReadonlySet<string>): { mentioned?: true } {
  return mentioned.has(row.ref) ? { mentioned: true } : {};
}

function wakeRows(group: { pr: ReviewPr | MentionedPr; until: number }[], now: number): PrRow[] {
  return toPrRows(
    group,
    group.map((item) => `until ${formatWakeTime(item.until, now)}`),
  );
}

function mentionRows(group: MentionItem[], state: 'unread' | 'read', fetchedAt: Date): PrRow[] {
  return toPrRows(
    group,
    group.map((item) => durationLead({ hours: durationHours(new Date(item.mentionedAt), fetchedAt) })),
  ).map((row, i) => {
    return { ...row, mention: { mark: markOf(group[i]), state } };
  });
}

export function buildOpenAuthoredView(raw: RawData, repo: RepoScope = null, grouped = false): QueueView {
  const open = raw.sizes
    .filter((entry) => entry.pr.state === 'open' && inRepoScope(entry.pr.repo, repo))
    .toSorted((a, b) => a.pr.createdAt.getTime() - b.pr.createdAt.getTime());

  if (open.length === 0) {
    return { empty: 'No open authored PRs found.', sections: [] };
  }

  const rowsOf = (group: SizeEntry[]) => {
    const ages = group.map((entry) => durationLead({ hours: durationHours(entry.pr.createdAt, raw.fetchedAt) }));
    const ageWidth = Math.max(...ages.map((age) => age.length));

    return toPrRows(
      group,
      group.map(
        (entry, i) => `${ages[i].padEnd(ageWidth)}  +${entry.additions}/-${entry.deletions}, ${entry.files} files`,
      ),
    );
  };

  const title = `Your open authored PRs (n=${open.length})`;

  if (grouped && spansRepos(repo)) {
    return { empty: null, sections: [{ title, rows: [], lists: groupedLists(open, rowsOf) }] };
  }

  return { empty: null, sections: [{ title, rows: rowsOf(open), lists: [] }] };
}

function waitRows<T extends { pr: ReviewPr }>(group: T[], startOf: (entry: T) => Date, fetchedAt: Date): PrRow[] {
  return toPrRows(
    group,
    group.map((entry) => durationLead({ hours: durationHours(startOf(entry), fetchedAt) })),
  );
}
