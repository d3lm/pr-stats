import { theme } from '../../theme';
import { blankCells, mergeCells, placeText } from './draw';
import type { Card, Line } from './model';

const SCATTER_WIDTH = 36;
const SCATTER_HEIGHT = 8;

/**
 * Braille dot bits by dot row and dot column inside one character cell.
 * A braille cell holds a two-by-four dot grid, which quadruples the
 * vertical and doubles the horizontal resolution of the plot.
 */
const DOT_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

export interface ScatterSpec {
  title: string;
  subtitle: string;
  points: { x: number; y: number }[];
  /**
   * Formats an x value for the axis labels under the plot.
   */
  formatX: (value: number) => string;
  /**
   * Formats a y value for the axis labels left of the plot.
   */
  formatY: (value: number) => string;
}

/**
 * Maps a value onto its dot index along one log-scaled axis. A flat axis
 * has no range, so every point lands on the middle dot instead.
 */
function dotPos(value: number, min: number, span: number, dots: number): number {
  return span === 0 ? Math.floor(dots / 2) : Math.round(((Math.log1p(value) - Math.log1p(min)) / span) * (dots - 1));
}

/**
 * Builds a scatter card that plots the points as braille dots, with both
 * axes on a log scale because the plotted quantities are heavy-tailed.
 * Log1p handles values of zero. The extreme labels mark the data range,
 * and points that land on the same dot merge into one.
 */
export function buildScatterCard({ title, subtitle, points, formatX, formatY }: ScatterSpec): Card {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.log1p(maxX) - Math.log1p(minX);
  const spanY = Math.log1p(maxY) - Math.log1p(minY);

  const dotsX = SCATTER_WIDTH * 2;
  const dotsY = SCATTER_HEIGHT * 4;

  const grid = Array.from({ length: SCATTER_HEIGHT }, () => Array.from({ length: SCATTER_WIDTH }, () => 0));

  for (const point of points) {
    const dotX = dotPos(point.x, minX, spanX, dotsX);
    const dotY = dotsY - 1 - dotPos(point.y, minY, spanY, dotsY);

    grid[dotY >> 2][dotX >> 1] |= DOT_BITS[dotY & 3][dotX & 1];
  }

  const yWidth = Math.max(formatY(maxY).length, formatY(minY).length);

  const lines = grid.map((row, i): Line => {
    const label = i === 0 ? formatY(maxY) : i === SCATTER_HEIGHT - 1 ? formatY(minY) : '';

    return [
      { text: `${label.padStart(yWidth)} `, fg: theme.muted },
      { text: label === '' ? '│' : '┤', fg: theme.dim },
      {
        text: row.map((bits) => (bits === 0 ? ' ' : String.fromCodePoint(0x28_00 + bits))).join(''),
        fg: theme.chartLine,
      },
    ];
  });

  lines.push([{ text: `${' '.repeat(yWidth)} └${'─'.repeat(SCATTER_WIDTH)}`, fg: theme.dim }]);

  const labelCells = blankCells(yWidth + 2 + SCATTER_WIDTH);
  const maxLabel = formatX(maxX);

  placeText(labelCells, yWidth + 2, formatX(minX), theme.muted);
  placeText(labelCells, yWidth + 2 + SCATTER_WIDTH - maxLabel.length, maxLabel, theme.muted);

  lines.push(mergeCells(labelCells));

  return { title, subtitle, lines };
}
