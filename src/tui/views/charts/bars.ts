import { theme } from '../../theme';
import { hbar } from './draw';
import type { Card, Line } from './model';

const BAR_WIDTH = 24;

/**
 * Number of rows a bars card renders before folding the rest into one
 * muted overflow line, so a dataset spanning many rows cannot grow the
 * card without bound. The x key lifts the cap, which the view builders
 * pass down through the expanded flag.
 */
export const MAX_BARS = 8;

export interface BarsSpec {
  title: string;
  subtitle: string;
  /**
   * Holds the rows to compare, one bar per row. The bars scale against
   * the largest value, so the rows compare on one common scale, unlike
   * the per-row scales of the spread card.
   */
  rows: { label: string; value: number; detail: string }[];
  /**
   * Formats a row value for the column next to the bar.
   */
  format: (value: number) => string;
  /**
   * Lifts the row cap so every row renders, driven by the x key on the
   * stats tabs.
   */
  expanded?: boolean;
}

/**
 * Builds a comparison card of labeled horizontal bars on one common
 * scale, with the formatted value and a muted detail next to each bar.
 * The largest value renders in the accent color. Rows beyond the cap
 * collapse into a single overflow line that names the x key, and the
 * expanded flag lifts the cap.
 */
export function buildBarsCard({ title, subtitle, rows, format, expanded = false }: BarsSpec): Card {
  const shown = expanded ? rows : rows.slice(0, MAX_BARS);
  const max = Math.max(...shown.map((row) => row.value), 0);
  const labelWidth = Math.max(...shown.map((row) => row.label.length));
  const valueWidth = Math.max(...shown.map((row) => format(row.value).length));

  const lines = shown.map((row): Line => {
    const line: Line = [{ text: `${row.label.padEnd(labelWidth)} `, fg: theme.muted }];

    if (row.value <= 0 || max <= 0) {
      line.push({ text: ' '.repeat(BAR_WIDTH) });
    } else {
      line.push(...hbar(row.value / max, BAR_WIDTH, row.value === max ? theme.accent : theme.chartBar));
    }

    line.push(
      { text: ` ${format(row.value).padStart(valueWidth)}`, fg: theme.text },
      { text: `  ${row.detail}`, fg: theme.dim },
    );

    return line;
  });

  if (rows.length > shown.length) {
    lines.push([{ text: `+ ${rows.length - shown.length} more · x expands`, fg: theme.dim }]);
  }

  return { title, subtitle, lines };
}
