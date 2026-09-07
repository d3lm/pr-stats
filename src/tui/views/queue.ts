import { prKey } from '../../cache';
import { latestReviews, pendingRequests, type LatestReview, type PendingRequest } from '../../compute';
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
import { durationLead, toPrRows, type PrList, type PrRow } from './rows';

/**
 * One titled section of a queue tab. The flat view renders the rows
 * right under the section title, and the grouped view renders one
 * indented sub-list per repo instead, so exactly one of rows and lists
 * carries the section's content.
 */
export interface QueueSection {
  title: string;
  rows: PrRow[];
  lists: PrList[];
}

/**
 * A tab that renders nothing but PR lists, used by the three sub-tabs of
 * the Awaiting you tab and the open authored PRs.
 */
export interface QueueView {
  empty: string | null;
  sections: QueueSection[];
}

/**
 * Flattens a queue view's sections into the row sequence its cursor
 * moves over, in render order.
 */
export function queueRows(view: QueueView): PrRow[] {
  return view.sections.flatMap((section) => [...section.rows, ...section.lists.flatMap((list) => list.rows)]);
}

/**
 * Returns the row under the cursor of a queue view, or undefined while
 * the view is missing or shows no rows. The cursor clamps to the last row
 * like the panel does, so a cursor that outlived a shrinking list resolves
 * to the row the panel highlights.
 */
export function queueRowAt(view: QueueView | null, cursor: number): PrRow | undefined {
  const rows = view === null ? [] : queueRows(view);

  return rows[Math.min(cursor, rows.length - 1)];
}

/**
 * Resolves what the snooze key does to the given row, snoozing a PR of
 * the awaiting queue or an unread mention, unsnoozing a row of the
 * snoozed queue, and nothing for every other row. A read mention has
 * nothing to park, so the key leaves it alone too.
 */
export function snoozeActionOf(row: PrRow | undefined): 'snooze' | 'unsnooze' | null {
  if (row?.pending !== undefined) {
    return row.pending.snoozed ? 'unsnooze' : 'snooze';
  }

  if (row?.mention === undefined || row.mention.state === 'read') {
    return null;
  }

  return row.mention.state === 'snoozed' ? 'unsnooze' : 'snooze';
}

/**
 * Resolves what the read key does to the given row, marking an unread or
 * a snoozed mention read, marking a read mention unread again, and
 * nothing for every row outside the mention inbox.
 */
export function mentionActionOf(row: PrRow | undefined): 'read' | 'unread' | null {
  if (row?.mention === undefined) {
    return null;
  }

  return row.mention.state === 'read' ? 'unread' : 'read';
}

/**
 * Lists the rows of the unread mentions the view shows, which the
 * read-all key marks read in one go. The snoozed mentions stay out,
 * because a snooze already parks them until a time you picked.
 */
export function unreadMentionRows(view: QueueView | null): PrRow[] {
  return view === null ? [] : queueRows(view).filter((row) => row.mention?.state === 'unread');
}

/**
 * Splits queue entries into one titled list per repo, largest group first
 * with ties broken by name, matching the repo picker order. The rows of
 * each group keep the order of the given entries.
 */
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

/**
 * Applies the repo scope of a queue tab, every entry for the aggregate
 * and the entries of one repo otherwise.
 */
function inScopeOf<T extends { pr: { repo: string } }>(entries: T[], repo: string | null): T[] {
  return repo === null ? entries : entries.filter((entry) => entry.pr.repo === repo);
}

/**
 * Builds one titled section, flat or split into one indented sub-list
 * per repo when the aggregate view is grouped.
 */
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

/**
 * Collects the refs of the PRs with an unread mention, which the review
 * queues badge so they show where a review also answers a question. The
 * mention snoozes park a mention, so a snoozed one counts as handled.
 */
function unreadMentionRefs(raw: RawData, snoozes: readonly Snooze[], reads: MentionReads, now: number): Set<string> {
  const { unread } = splitMentions(mentionItems(raw.mentions ?? []), reads, snoozes, now);

  return new Set(unread.map((item) => prKey(item.pr.repo, item.pr.number)));
}

/**
 * Marks the sub-tabs of the Awaiting you tab that hold something to act
 * on, so the sub-tab bar can flag them while another sub-tab is open.
 * The awaiting sub-tab has work while a PR awaits your review outside a
 * snooze, and the mentions sub-tab while a mention is unread. The
 * reviewed sub-tab never asks for anything, so it carries no flag.
 */
export interface QueueAlerts {
  pending: boolean;
  mentions: boolean;
}

/**
 * Resolves which sub-tabs of the Awaiting you tab hold something to act
 * on, across every repo rather than the opened scope, so the flags show
 * work that waits behind another repo scope too. The snoozes and the
 * read state decide what counts as waiting at the given time, which
 * defaults to the current time like the queue views. The flags need no
 * durations, so this never measures one.
 */
export function queueAlerts(
  raw: RawData,
  snoozes: readonly Snooze[] = [],
  reads: MentionReads = emptyMentionReads(),
  now = Date.now(),
): QueueAlerts {
  const { awaiting } = splitSnoozed(pendingRequests(raw.reviewResults), snoozes, now);
  const { unread } = splitMentions(mentionItems(raw.mentions ?? []), reads, snoozes, now);

  return { pending: awaiting.length > 0, mentions: unread.length > 0 };
}

/**
 * Builds the awaiting sub-tab of the Awaiting you tab, the queue of open
 * PRs where a review from you is still pending. The awaiting section
 * lists them longest wait first, and the snoozed section holds the ones
 * a review snooze parks until its wake-up time, soonest wake-up first,
 * each leading with that time instead of the wait. A row whose PR also
 * has an unread mention carries the mention badge, because the review
 * request and the mention are two separate asks and the badge shows
 * where one visit covers both.
 *
 * Call this after the time mode is configured, because the durations
 * depend on it. Passing a repo narrows every section to that repo, and
 * the grouped flag splits each section into one indented sub-list per
 * repo instead. The snoozes decide which pending PRs sit in the snoozed
 * section at the given time, which defaults to the current time because
 * a snooze ends on the wall clock rather than at the fetch, and the read
 * state decides which rows carry the badge.
 */
export function buildPendingReviewView(
  raw: RawData,
  repo: string | null = null,
  grouped = false,
  snoozes: readonly Snooze[] = [],
  reads: MentionReads = emptyMentionReads(),
  now = Date.now(),
): QueueView {
  const { awaiting, snoozed } = splitSnoozed(inScopeOf(pendingRequests(raw.reviewResults), repo), snoozes, now);

  if (awaiting.length === 0 && snoozed.length === 0) {
    return { empty: 'No PRs are awaiting your review.', sections: [] };
  }

  const split = repo === null && grouped;
  const mentioned = unreadMentionRefs(raw, snoozes, reads, now);

  const awaitingRowsOf = (group: PendingRequest[]) =>
    waitRows(group, (entry) => entry.requestedAt, raw.fetchedAt).map((row, i) => {
      return {
        ...row,
        pending: { requestedAt: group[i].requestedAt.getTime(), snoozed: false },
        ...badgeOf(row, mentioned),
      };
    });

  const snoozedRowsOf = (group: (PendingRequest & { until: number })[]) =>
    wakeRows(group, now).map((row, i) => {
      return {
        ...row,
        pending: { requestedAt: group[i].requestedAt.getTime(), snoozed: true },
        ...badgeOf(row, mentioned),
      };
    });

  return {
    empty: null,
    sections: [
      ...(awaiting.length === 0
        ? []
        : [sectionOf(`Awaiting your review (n=${awaiting.length})`, awaiting, awaitingRowsOf, split)]),
      ...(snoozed.length === 0 ? [] : [sectionOf(`Snoozed (n=${snoozed.length})`, snoozed, snoozedRowsOf, split)]),
    ],
  };
}

/**
 * Builds the reviewed sub-tab of the Awaiting you tab, the open PRs you
 * already reviewed that carry no new request, longest since your review
 * first, so a PR you commented on stays visible until it merges or
 * closes. A row whose PR has an unread mention carries the mention badge
 * like the awaiting queue. Call this after the time mode is configured,
 * because the durations depend on it. Passing a repo narrows the list to
 * that repo, and the grouped flag splits it into one indented sub-list
 * per repo instead.
 */
export function buildReviewedView(
  raw: RawData,
  repo: string | null = null,
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
    sections: [sectionOf(`Reviewed (n=${reviewing.length})`, reviewing, reviewedRowsOf, repo === null && grouped)],
  };
}

/**
 * Builds the mentions sub-tab of the Awaiting you tab, the inbox of the
 * PRs that mention you. The unread section lists the PRs with a mention
 * you have not handled, newest mention first, each leading with the time
 * since that mention. The snoozed section holds the mentions a mention
 * snooze parks until its wake-up time, soonest wake-up first, each
 * leading with that time. The read section closes the tab with the
 * mentions you marked read, newest first, so a mark can be undone from
 * there. Without mention data, which the tracking setting decides, the
 * tab says how to turn the tracking on.
 *
 * Call this after the time mode is configured, because the durations
 * depend on it. Passing a repo narrows every section to that repo, and
 * the grouped flag splits each section into one indented sub-list per
 * repo instead. The snoozes and the read state decide where each mention
 * sits at the given time, which defaults to the current time because a
 * snooze ends on the wall clock rather than at the fetch.
 */
export function buildMentionsView(
  raw: RawData,
  repo: string | null = null,
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

  const split = repo === null && grouped;

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

/**
 * Resolves the badge fields of a review row, the mentioned mark when its
 * PR has an unread mention and nothing otherwise, so a row without a
 * badge carries no field at all.
 */
function badgeOf(row: PrRow, mentioned: ReadonlySet<string>): { mentioned?: true } {
  return mentioned.has(row.ref) ? { mentioned: true } : {};
}

/**
 * Builds the rows of a snoozed section, each leading with its wake-up
 * time, for the caller to mark with the request or the mention it parks.
 */
function wakeRows(group: { pr: ReviewPr | MentionedPr; until: number }[], now: number): PrRow[] {
  return toPrRows(
    group,
    group.map((item) => `until ${formatWakeTime(item.until, now)}`),
  );
}

/**
 * Builds the rows of the unread or the read mentions, each leading with
 * the time since the PR's newest mention, measured to the fetch like the
 * waits of the awaiting queue, and carrying the mention for the snooze
 * and the read keys.
 */
function mentionRows(group: MentionItem[], state: 'unread' | 'read', fetchedAt: Date): PrRow[] {
  return toPrRows(
    group,
    group.map((item) => durationLead({ hours: durationHours(new Date(item.mentionedAt), fetchedAt) })),
  ).map((row, i) => {
    return { ...row, mention: { mark: markOf(group[i]), state } };
  });
}

/**
 * Builds the open-PRs tab, the list of your authored PRs that are still
 * open, oldest first, as one section. Each row leads with the age since
 * the PR was created and its size. Call this after the time mode is
 * configured, because the ages depend on it. Passing a repo narrows the
 * list to that repo, and the grouped flag splits the section into one
 * indented sub-list per repo instead. Inaccessible authored PRs never
 * make it into the size entries, so they stay off this list too.
 */
export function buildOpenAuthoredView(raw: RawData, repo: string | null = null, grouped = false): QueueView {
  const open = raw.sizes
    .filter((entry) => entry.pr.state === 'open' && (repo === null || entry.pr.repo === repo))
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

  if (repo === null && grouped) {
    return { empty: null, sections: [{ title, rows: [], lists: groupedLists(open, rowsOf) }] };
  }

  return { empty: null, sections: [{ title, rows: rowsOf(open), lists: [] }] };
}

/**
 * Builds the rows of a review queue section, each leading with the time
 * from the given start of its entry to the fetch, the wait of a pending
 * request or the time since your review. The durations are measured
 * here, for the rows on screen alone, rather than for every result of
 * the data.
 */
function waitRows<T extends { pr: ReviewPr }>(group: T[], startOf: (entry: T) => Date, fetchedAt: Date): PrRow[] {
  return toPrRows(
    group,
    group.map((entry) => durationLead({ hours: durationHours(startOf(entry), fetchedAt) })),
  );
}
