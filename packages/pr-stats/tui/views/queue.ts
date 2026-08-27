import { computeReviewStats, type PendingEntry } from '../../compute';
import { durationHours } from '../../time';
import type { RawData, SizeEntry } from '../data/load';
import { durationLead, toPrRows, type PrList, type PrRow } from './rows';

/**
 * A tab that renders nothing but PR lists, used by the awaiting-review
 * queue and the open authored PRs.
 */
export interface QueueView {
  empty: string | null;
  lists: PrList[];
}

/**
 * Flattens a queue view's lists into the row sequence its cursor moves
 * over, in render order.
 */
export function queueRows(view: QueueView): PrRow[] {
  return view.lists.flatMap((list) => list.rows);
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
 * Builds the awaiting-review tab, the queue of open PRs where a review
 * from you is still pending, longest wait first. Call this after the time
 * mode is configured, because the waiting durations depend on it. Passing
 * a repo narrows the queue to that repo, and the grouped flag splits the
 * aggregate queue into one list per repo instead.
 */
export function buildPendingReviewView(raw: RawData, repo: string | null = null, grouped = false): QueueView {
  const { pending } = computeReviewStats(raw.reviewResults, { now: raw.fetchedAt });
  const entries = repo === null ? pending : pending.filter((entry) => entry.pr.repo === repo);

  if (entries.length === 0) {
    return { empty: 'No PRs are awaiting your review.', lists: [] };
  }

  if (repo === null && grouped) {
    return { empty: null, lists: groupedLists(entries, rowsOf) };
  }

  return {
    empty: null,
    lists: [{ title: `Open and awaiting your review (n=${entries.length})`, rows: rowsOf(entries) }],
  };
}

/**
 * Builds the open-PRs tab, the list of your authored PRs that are still
 * open, oldest first. Each row leads with the age since the PR was created
 * and its size. Call this after the time mode is configured, because the
 * ages depend on it. Passing a repo narrows the list to that repo, and the
 * grouped flag splits the aggregate list into one list per repo instead.
 * Inaccessible authored PRs never make it into the size entries, so they
 * stay off this list too.
 */
export function buildOpenAuthoredView(raw: RawData, repo: string | null = null, grouped = false): QueueView {
  const open = raw.sizes
    .filter((entry) => entry.pr.state === 'open' && (repo === null || entry.pr.repo === repo))
    .toSorted((a, b) => a.pr.createdAt.getTime() - b.pr.createdAt.getTime());

  if (open.length === 0) {
    return { empty: 'No open authored PRs found.', lists: [] };
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

  if (repo === null && grouped) {
    return { empty: null, lists: groupedLists(open, rowsOf) };
  }

  return {
    empty: null,
    lists: [{ title: `Your open authored PRs (n=${open.length})`, rows: rowsOf(open) }],
  };
}

function rowsOf(group: PendingEntry[]) {
  return toPrRows(
    group,
    group.map((entry) => durationLead(entry)),
  );
}
