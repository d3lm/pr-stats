import { computeReviewStats, type PendingEntry, type ReviewingEntry } from '../../compute';
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
 * A tab that renders nothing but PR lists, used by the awaiting-review
 * queue and the open authored PRs.
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
 * the awaiting queue, unsnoozing one of the snoozed queue, and nothing
 * for every other row.
 */
export function snoozeActionOf(row: PrRow | undefined): 'snooze' | 'unsnooze' | null {
  if (row?.pending === undefined) {
    return null;
  }

  return row.pending.snoozed ? 'unsnooze' : 'snooze';
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
 * Builds the awaiting-review tab, the queues of open PRs on your plate,
 * one section each. The awaiting section holds the PRs where a review
 * from you is still pending, longest wait first. The snoozed section
 * holds the pending PRs a snooze parks until its wake-up time, soonest
 * wake-up first, each leading with that time instead of the wait. The
 * reviewed section holds the PRs you already reviewed that are still open
 * without a new request, longest since your review first, so a PR you
 * commented on stays visible until it merges or closes. Call this after
 * the time mode is configured, because the durations depend on it.
 * Passing a repo narrows every section to that repo, and the grouped flag
 * splits each section into one indented sub-list per repo instead. The
 * snoozes decide which pending PRs sit in the snoozed section at the
 * given time, which defaults to the current time because a snooze ends
 * on the wall clock rather than at the fetch.
 */
export function buildPendingReviewView(
  raw: RawData,
  repo: string | null = null,
  grouped = false,
  snoozes: readonly Snooze[] = [],
  now = Date.now(),
): QueueView {
  const stats = computeReviewStats(raw.reviewResults, { now: raw.fetchedAt });

  const inScope = <T extends { pr: { repo: string } }>(entries: T[]) =>
    repo === null ? entries : entries.filter((entry) => entry.pr.repo === repo);

  const { awaiting, snoozed } = splitSnoozed(inScope(stats.pending), snoozes, now);
  const reviewing = inScope(stats.reviewing);

  if (awaiting.length === 0 && snoozed.length === 0 && reviewing.length === 0) {
    return { empty: 'No PRs are awaiting your review, and none you reviewed are still open.', sections: [] };
  }

  const split = repo === null && grouped;

  const sectionOf = <T extends { pr: { repo: string } }>(
    title: string,
    entries: T[],
    rowsOf: (group: T[]) => PrRow[],
  ): QueueSection =>
    split ? { title, rows: [], lists: groupedLists(entries, rowsOf) } : { title, rows: rowsOf(entries), lists: [] };

  const snoozedRowsOf = (group: (PendingEntry & { until: number })[]) => snoozedRows(group, now);

  return {
    empty: null,
    sections: [
      ...(awaiting.length === 0
        ? []
        : [sectionOf(`Awaiting your review (n=${awaiting.length})`, awaiting, awaitingRows)]),
      ...(snoozed.length === 0 ? [] : [sectionOf(`Snoozed (n=${snoozed.length})`, snoozed, snoozedRowsOf)]),
      ...(reviewing.length === 0 ? [] : [sectionOf(`Reviewed (n=${reviewing.length})`, reviewing, rowsOf)]),
    ],
  };
}

/**
 * Builds the rows of the awaiting queue, each carrying the request time
 * the snooze key records.
 */
function awaitingRows(group: PendingEntry[]): PrRow[] {
  return rowsOf(group).map((row, i) => {
    return { ...row, pending: { requestedAt: group[i].requestedAt.getTime(), snoozed: false } };
  });
}

/**
 * Builds the rows of the snoozed queue, each leading with its wake-up
 * time and marked as snoozed so the snooze key unsnoozes it.
 */
function snoozedRows(group: (PendingEntry & { until: number })[], now: number): PrRow[] {
  return toPrRows(
    group,
    group.map((entry) => `until ${formatWakeTime(entry.until, now)}`),
  ).map((row, i) => {
    return { ...row, pending: { requestedAt: group[i].requestedAt.getTime(), snoozed: true } };
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

function rowsOf(group: (PendingEntry | ReviewingEntry)[]) {
  return toPrRows(
    group,
    group.map((entry) => durationLead(entry)),
  );
}
