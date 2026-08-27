import { percentile } from '../../../utils';
import { theme } from '../../theme';
import { blankCells, mergeCells, placeText } from './draw';
import type { Line } from './model';

export interface Distribution {
  /**
   * Holds the min, p50, p90, p99, max, and mean summary that renders
   * right-aligned next to the section title.
   */
  stats: Line;
  lines: Line[];
}

/**
 * Candidate durations in hours for the scale row under the review time
 * distribution axis. Only the candidates inside the data range render,
 * thinned to avoid overlaps.
 */
export const DURATION_TICKS = [5 / 60, 0.25, 0.5, 1, 2, 4, 8, 24, 48, 96, 168, 336, 720, 2160];

/**
 * Candidate counts for the scale row under the PR size distribution axis,
 * on the same round-number spirit as the duration ticks.
 */
export const COUNT_TICKS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000];

export interface DistributionSpec {
  values: number[];
  width: number;
  /**
   * Formats a value for the quantile labels and the summary line.
   */
  format: (value: number) => string;
  /**
   * Holds the candidate values for the scale row under the axis. Only the
   * candidates inside the data range render, thinned to avoid overlaps.
   */
  ticks: number[];
  /**
   * Builds the fallback label when every value is identical, from the
   * value count and the formatted value.
   */
  flat: (count: number, value: string) => string;
}

/**
 * Builds a full-width distribution strip. The axis spans min to max on a
 * log scale with the median as a dot and p90 as a cross, the quantile
 * labels sit above their positions, and round values mark the scale below.
 */
export function buildDistribution({ values, width, format, ticks, flat }: DistributionSpec): Distribution {
  const sorted = [...values].toSorted((a, b) => a - b);
  const min = sorted[0];
  const max = sorted.at(-1) ?? min;
  const p50 = percentile(sorted, 50);
  const p90 = percentile(sorted, 90);
  const p99 = percentile(sorted, 99);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;

  const stats: Line = [
    { text: 'min ', fg: theme.muted },
    { text: format(min), fg: theme.text },
    { text: '   p50 ', fg: theme.muted },
    { text: format(p50), fg: theme.accent },
    { text: '   p90 ', fg: theme.muted },
    { text: format(p90), fg: theme.accent },
    { text: '   p99 ', fg: theme.muted },
    { text: format(p99), fg: theme.text },
    { text: '   max ', fg: theme.muted },
    { text: format(max), fg: theme.text },
    { text: '   mean ', fg: theme.muted },
    { text: format(mean), fg: theme.text },
  ];

  const span = Math.log1p(max) - Math.log1p(min);

  if (span === 0) {
    return { stats, lines: [[{ text: flat(sorted.length, format(min)), fg: theme.muted }]] };
  }

  const pos = (value: number) => Math.round(((Math.log1p(value) - Math.log1p(min)) / span) * (width - 1));

  const labelCells = blankCells(width);
  const connectorCells = blankCells(width);
  const axisCells = blankCells(width);
  const scaleCells = blankCells(width);

  for (let i = 0; i < width; i++) {
    axisCells[i] = { ch: '─', fg: theme.dim };
  }

  const markers = [
    { text: `min ${format(min)}`, at: 0, align: 'left' as const, fg: theme.muted },
    { text: `p50 ${format(p50)}`, at: pos(p50), align: 'center' as const, fg: theme.accent },
    { text: `p90 ${format(p90)}`, at: pos(p90), align: 'center' as const, fg: theme.text },
    { text: `max ${format(max)}`, at: width - 1, align: 'right' as const, fg: theme.muted },
  ];

  let lastEnd = 0;

  for (const marker of markers) {
    const desired =
      marker.align === 'left'
        ? marker.at
        : marker.align === 'right'
          ? marker.at - marker.text.length + 1
          : marker.at - Math.floor(marker.text.length / 2);

    const start = Math.min(Math.max(desired, lastEnd), width - marker.text.length);

    if (start < lastEnd) {
      continue;
    }

    placeText(labelCells, start, marker.text, marker.fg);

    /**
     * Only the interior markers draw a connector. The axis end caps already
     * mark min and max, and a connector stacked on a cap would recolor the
     * top of its vertical stroke.
     */
    if (marker.align === 'center') {
      placeText(connectorCells, Math.min(Math.max(marker.at, 0), width - 1), '╷', marker.fg);
    }

    lastEnd = start + marker.text.length + 2;
  }

  let scaleEnd = -3;

  for (const tick of ticks) {
    if (tick <= min || tick >= max) {
      continue;
    }

    const label = format(tick);
    const at = Math.min(Math.max(pos(tick) - Math.floor(label.length / 2), 0), width - label.length);

    if (at >= scaleEnd + 3) {
      placeText(scaleCells, at, label, theme.dim);
      placeText(axisCells, pos(tick), '┬', theme.dim);
      scaleEnd = at + label.length;
    }
  }

  placeText(axisCells, 0, '├', theme.dim);
  placeText(axisCells, width - 1, '┤', theme.dim);
  placeText(axisCells, pos(p90), '┼', theme.text);
  placeText(axisCells, pos(p50), '●', theme.accent);

  return {
    stats,
    lines: [mergeCells(labelCells), mergeCells(connectorCells), mergeCells(axisCells), mergeCells(scaleCells)],
  };
}
