import { theme } from '../../theme';
import { hbar } from './draw';
import type { Card, Line } from './model';

const GAUGE_BAR_WIDTH = 24;

export interface GaugeSpec {
  title: string;
  subtitle: string;
  /**
   * Holds the rows the gauge splits the total into, like inside versus
   * over a target. The bars scale against the summed counts.
   */
  rows: { label: string; count: number; color: string }[];
}

/**
 * Builds a split gauge card. Each row gets a bar sized by its share of the
 * summed counts, with the percentage and the count alongside.
 */
export function buildGaugeCard({ title, subtitle, rows }: GaugeSpec): Card {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const labelWidth = Math.max(...rows.map((row) => row.label.length));
  const countWidth = String(total).length;

  const lines = rows.map((row): Line => {
    const pct = Math.round((row.count / total) * 100);
    const line: Line = [{ text: `${row.label.padEnd(labelWidth)} `, fg: theme.muted }];

    if (row.count === 0) {
      line.push({ text: ' '.repeat(GAUGE_BAR_WIDTH) });
    } else {
      line.push(...hbar(row.count / total, GAUGE_BAR_WIDTH, row.color));
    }

    line.push(
      { text: `${pct}%`.padStart(5), fg: theme.text },
      { text: String(row.count).padStart(countWidth + 2), fg: theme.muted },
    );

    return line;
  });

  return { title, subtitle, lines };
}
