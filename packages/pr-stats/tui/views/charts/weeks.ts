import { theme } from '../../theme';
import { blankCells, mergeCells, placeText } from './draw';
import type { Line } from './model';

const DAY_MS = 86_400_000;

export const WEEK_MS = 7 * DAY_MS;

export function mondayOf(dayUtcMs: number): number {
  return dayUtcMs - ((new Date(dayUtcMs).getUTCDay() + 6) % 7) * DAY_MS;
}

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Builds the x-axis row for a chart whose columns map to week Mondays.
 * Labels go under evenly spaced points and drop out when they would
 * overlap.
 */
export function weekAxisRow(
  width: number,
  prefix: number,
  points: number,
  columnOf: (point: number) => number,
  mondayOfPoint: (point: number) => number,
): Line {
  const cells = blankCells(width);
  const every = Math.ceil(points / 4);

  let lastEnd = -2;

  for (let point = 0; point < points; point += every) {
    const label = dateLabel(mondayOfPoint(point));
    const at = prefix + columnOf(point);

    if (at >= lastEnd + 2 && at + label.length <= width) {
      placeText(cells, at, label, theme.dim);
      lastEnd = at + label.length;
    }
  }

  return mergeCells(cells);
}
