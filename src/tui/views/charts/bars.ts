import { theme } from '../../theme';
import { hbar } from './draw';
import type { Card, Line } from './model';

const BAR_WIDTH = 24;

export const MAX_BARS = 8;

export interface BarsSpec {
  title: string;
  subtitle: string;
  rows: { label: string; value: number; detail: string }[];
  format: (value: number) => string;
  expanded?: boolean;
}

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
