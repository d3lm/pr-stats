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
