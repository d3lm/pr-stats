import { percentile } from '../../../utils';
import { theme } from '../../theme';
import { blankCells, mergeCells } from './draw';
import type { Card, Line } from './model';

const SPREAD_STRIP_WIDTH = 32;

/**
 * Builds a spread card, one quantile strip per metric. Each strip spans
 * that metric's min to max on a log scale, the shaded box covers p25 to
 * p75, and the accent block marks the median. Log1p handles metrics whose
 * minimum is zero.
 */
export function buildSpreadCard(
  title: string,
  metrics: { label: string; values: number[] }[],
  format: (value: number) => string,
): Card {
  const rows = metrics.map(({ label, values }) => {
    const sorted = [...values].toSorted((a, b) => a - b);
    const min = sorted[0];
    const max = percentile(sorted, 100);
    const span = Math.log1p(max) - Math.log1p(min);

    const pos = (value: number) => {
      if (span === 0) {
        return 0;
      }

      return Math.round(((Math.log1p(value) - Math.log1p(min)) / span) * (SPREAD_STRIP_WIDTH - 1));
    };

    const cells = blankCells(SPREAD_STRIP_WIDTH);

    for (let i = 0; i < SPREAD_STRIP_WIDTH; i++) {
      cells[i] = { ch: '─', fg: theme.dim };
    }

    cells[0] = { ch: '├', fg: theme.dim };
    cells[SPREAD_STRIP_WIDTH - 1] = { ch: '┤', fg: theme.dim };

    for (let i = pos(percentile(sorted, 25)); i <= pos(percentile(sorted, 75)); i++) {
      cells[i] = { ch: '▒', fg: theme.chartBar };
    }

    cells[pos(percentile(sorted, 50))] = { ch: '█', fg: theme.accent };

    return { label, cells, min: format(min), max: format(max) };
  });

  const labelWidth = Math.max(...rows.map((row) => row.label.length));
  const minWidth = Math.max(...rows.map((row) => row.min.length));

  const lines = rows.map((row): Line => {
    return [
      { text: `${row.label.padEnd(labelWidth)} `, fg: theme.muted },
      { text: `${row.min.padStart(minWidth)} `, fg: theme.text },
      ...mergeCells(row.cells),
      { text: ` ${row.max}`, fg: theme.text },
    ];
  });

  return { title, subtitle: '▒ p25-p75, █ p50, log scale', lines };
}
