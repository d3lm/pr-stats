import { zonedStamp } from '../../../time';
import { theme } from '../../theme';
import type { Card, Line } from './model';
import { mondayOf, WEEK_MS, weekAxisRow } from './weeks';

const CUM_WIDTH = 36;
const CUM_HEIGHT = 8;

/**
 * Maps an instant onto its week's encoded Monday in the configured
 * timezone.
 */
function weekOf(date: Date): number {
  return mondayOf(zonedStamp(date).dayUtcMs);
}

export interface CumulativeSpec {
  title: string;
  /**
   * Holds the event series to accumulate, one line per series. Later
   * series draw over earlier ones where they share a cell, so put the
   * series that should win the color last.
   */
  series: { label: string; dates: Date[]; color: string }[];
  /**
   * Trails the legend in the subtitle, naming what accumulates, like
   * "cumulative PRs by week".
   */
  legend: string;
}

/**
 * Builds a cumulative line chart of the given event series, one running
 * total per series on a shared linear scale, so the gap between the lines
 * shows the backlog. The lines draw with the same box-drawing characters
 * the trend cards use, which reads as a solid stroke where braille dots
 * would fall apart into speckles. Weeks are interpolated linearly and
 * steep segments fill with vertical bars, which keeps each line
 * continuous.
 */
export function buildCumulativeCard({ title, series, legend }: CumulativeSpec): Card {
  const subtitle: Line = series.flatMap((entry, i) => [
    { text: `${i === 0 ? '' : '  '}──`, fg: entry.color },
    { text: ` ${entry.label}`, fg: theme.muted },
  ]);

  subtitle.push({ text: `, ${legend}`, fg: theme.muted });

  const mondays = series.flatMap((entry) => entry.dates.map((date) => weekOf(date)));
  const first = Math.min(...mondays);
  const weekCount = (Math.max(...mondays) - first) / WEEK_MS + 1;

  if (weekCount < 2) {
    return { title, subtitle, lines: [[{ text: 'not enough weeks to draw a trend', fg: theme.muted }]] };
  }

  const totals = series.map((entry) => {
    const weekly = Array.from({ length: weekCount }, () => 0);

    for (const date of entry.dates) {
      weekly[(weekOf(date) - first) / WEEK_MS] += 1;
    }

    let running = 0;

    return weekly.map((count) => (running += count));
  });

  const maxY = Math.max(...totals.map((cumulative) => cumulative.at(-1) ?? 0), 1);

  const grid: ({ ch: string; fg: string } | null)[][] = Array.from({ length: CUM_HEIGHT }, () =>
    Array.from({ length: CUM_WIDTH }, () => null),
  );

  for (const [i, cumulative] of totals.entries()) {
    /**
     * Row of the line in each column, with row zero at the top. Values
     * between weekly totals interpolate linearly, like the trend cards.
     */
    const rows = Array.from({ length: CUM_WIDTH }, (_, x) => {
      const weekPos = (x / (CUM_WIDTH - 1)) * (weekCount - 1);
      const week = Math.floor(weekPos);
      const nextWeek = Math.min(week + 1, weekCount - 1);
      const value = cumulative[week] + (cumulative[nextWeek] - cumulative[week]) * (weekPos - week);

      return CUM_HEIGHT - 1 - Math.round((value / maxY) * (CUM_HEIGHT - 1));
    });

    const color = series[i].color;

    /**
     * Each column draws the step toward the next column the way
     * asciichart does, a dash on a flat run and a corner pair joined by
     * vertical bars on a rise or fall, so the stroke stays connected.
     */
    for (let x = 0; x < CUM_WIDTH; x++) {
      const here = rows[x];
      const next = rows[Math.min(x + 1, CUM_WIDTH - 1)];

      if (here === next) {
        grid[here][x] = { ch: '─', fg: color };
        continue;
      }

      grid[next][x] = { ch: next < here ? '╭' : '╰', fg: color };
      grid[here][x] = { ch: next < here ? '╯' : '╮', fg: color };

      for (let row = Math.min(here, next) + 1; row < Math.max(here, next); row++) {
        grid[row][x] = { ch: '│', fg: color };
      }
    }
  }

  const topLabel = String(maxY);
  const yWidth = topLabel.length;

  const lines = grid.map((row, i): Line => {
    const label = i === 0 ? topLabel : i === CUM_HEIGHT - 1 ? '0' : '';

    const line: Line = [
      { text: `${label.padStart(yWidth)} `, fg: theme.muted },
      { text: label === '' ? '│' : '┤', fg: theme.dim },
    ];

    for (const cell of row) {
      line.push(cell === null ? { text: ' ' } : { text: cell.ch, fg: cell.fg });
    }

    return line;
  });

  lines.push(
    [{ text: `${' '.repeat(yWidth)} └${'─'.repeat(CUM_WIDTH)}`, fg: theme.dim }],
    weekAxisRow(
      yWidth + 2 + CUM_WIDTH,
      yWidth + 2,
      weekCount,
      (week) => Math.round((week / (weekCount - 1)) * (CUM_WIDTH - 1)),
      (week) => first + week * WEEK_MS,
    ),
  );

  return { title, subtitle, lines };
}
