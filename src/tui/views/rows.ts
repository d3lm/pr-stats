import type { MentionMark } from '../../mentions';
import { formatHoursOnly, weeksSuffix } from '../../report';

export interface PrRow {
  lead: string;
  ref: string;
  url: string;
  title: string;
  /**
   * Describes the pending review request behind a row of the awaiting or
   * the snoozed queue, with the request time in milliseconds that a
   * snooze records so a later re-request voids it, and whether the row
   * sits in the snoozed queue. Rows of the other lists carry none, which
   * tells the snooze key to leave them alone.
   */
  pending?: { requestedAt: number; snoozed: boolean };
  /**
   * Describes the mention behind a row of the mention inbox, with the
   * mark of the PR's mentions, the time of the newest one and the ids of
   * the texts, which the read mark and a snooze record so a mention the
   * mark did not know brings the PR back, and the state that places the
   * row in the unread, the snoozed, or the read list. The snooze and the
   * read keys act on it.
   */
  mention?: { mark: MentionMark; state: 'unread' | 'snoozed' | 'read' };
  /**
   * Names the team, by its combined org/slug, whose review request the
   * row stands for, on the rows of the team section of the awaiting
   * queue and the snoozed rows that came from it. The panel shows it
   * after the title, so a parked team request stays recognizable.
   */
  team?: string;
  /**
   * Marks a review row whose PR also carries an unread mention of you,
   * which the panel shows as a badge, so the awaiting and the reviewed
   * queues show where a review also answers a question. The inbox rows
   * carry none, because the inbox already sorts the mentions by state.
   */
  mentioned?: boolean;
}

export interface PrList {
  title: string;
  rows: PrRow[];
}

export function durationLead(result: { hours: number }): string {
  return `${formatHoursOnly(result.hours).padStart(8)}${weeksSuffix(result.hours)}`;
}

export function toPrRows(
  entries: { pr: { repo: string; number: number; title: string; url: string } }[],
  leads: string[],
): PrRow[] {
  const width = Math.max(...leads.map((lead) => lead.length));

  return entries.map((entry, i) => {
    return {
      lead: leads[i].padEnd(width),
      ref: `${entry.pr.repo}#${entry.pr.number}`,
      url: entry.pr.url,
      title: entry.pr.title,
    };
  });
}
