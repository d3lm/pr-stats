import type { Bucket } from '../../../report';
import { percentile } from '../../../utils';
import { theme } from '../../theme';
import { blankCells, hbar, mergeCells, placeText } from './draw';
import type { Card, Line } from './model';

const HIST_BAR_WIDTH = 36;

function axisStep(maxCount: number): number {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000, 5000]) {
    if (maxCount / step <= 5) {
      return step;
    }
  }

  return 10_000;
}

export interface HistogramSpec {
  title: string;
  subtitle: string;
  values: number[];
  buckets: Bucket[];
  format: (value: number) => string;
}

export function buildHistogramCard({ title, subtitle, values, buckets, format }: HistogramSpec): Card {
  const counts = buckets.map(() => 0);

  for (const value of values) {
    counts[buckets.findIndex((bucket) => value < bucket.max)] += 1;
  }

  const sorted = [...values].toSorted((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const medianIndex = buckets.findIndex((bucket) => p50 < bucket.max);

  const step = axisStep(Math.max(...counts, 1));
  const axisMax = Math.max(step, Math.ceil(Math.max(...counts, 1) / step) * step);
  const labelWidth = Math.max(...buckets.map((bucket) => bucket.label.length));

  const lines = buckets.map((bucket, i): Line => {
    const line: Line = [{ text: `${bucket.label.padEnd(labelWidth)} `, fg: theme.muted }];

    if (counts[i] === 0) {
      line.push({ text: ' '.repeat(HIST_BAR_WIDTH) }, { text: '   0', fg: theme.dim });

      return line;
    }

    line.push(
      ...hbar(counts[i] / axisMax, HIST_BAR_WIDTH, i === medianIndex ? theme.accent : theme.chartBar),
      { text: String(counts[i]).padStart(4), fg: theme.text },
      { text: `${Math.round((counts[i] / values.length) * 100)}%`.padStart(5), fg: theme.muted },
    );

    if (i === medianIndex) {
      line.push({ text: `  ← p50 ${format(p50)}`, fg: theme.accent });
    }

    return line;
  });

  const tickCells = blankCells(labelWidth + 1 + HIST_BAR_WIDTH);
  const numberCells = blankCells(labelWidth + 1 + HIST_BAR_WIDTH + 4);

  let lastEnd = -2;

  for (let value = 0; value <= axisMax; value += step) {
    const at = labelWidth + 1 + Math.round((value / axisMax) * (HIST_BAR_WIDTH - 1));

    if (at >= lastEnd + 2) {
      placeText(tickCells, at, '╵', theme.dim);
      placeText(numberCells, at, String(value), theme.dim);

      lastEnd = at + String(value).length;
    }
  }

  lines.push(mergeCells(tickCells), mergeCells(numberCells));

  return { title, subtitle, lines };
}
