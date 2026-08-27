import { formatHoursOnly, weeksSuffix } from '../../report';

export interface PrRow {
  lead: string;
  ref: string;
  url: string;
  title: string;
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
