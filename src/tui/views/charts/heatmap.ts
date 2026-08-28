import { zonedStamp } from '../../../time';
import { theme } from '../../theme';
import type { Card, Line } from './model';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function heatColor(count: number): string {
  if (count === 1) {
    return theme.heat[0];
  }

  if (count === 2) {
    return theme.heat[1];
  }

  return count <= 4 ? theme.heat[2] : theme.heat[3];
}

export interface HeatmapSpec {
  title: string;
  subtitle: string;
  /**
   * Holds the events the weekday-by-hour grid counts, one date per event.
   */
  grid: Date[];
  /**
   * Describes the count columns to the right of the grid, each counting
   * its own dates per weekday. A muted column renders its counts in the
   * muted color to mark it as secondary.
   */
  columns: { label: string; dates: Date[]; muted?: boolean }[];
  /**
   * Names what one grid cell counts in the legend, like "reviews in that
   * hour".
   */
  legend: string;
}

/**
 * Builds a weekday-by-hour heatmap card in the style of the GitHub
 * contribution grid. Each cell covers one local hour and the hours are
 * grouped into four six-hour blocks.
 */
export function buildHeatmapCard({ title, subtitle, grid, columns, legend }: HeatmapSpec): Card {
  const cells = WEEKDAY_LABELS.map(() => Array.from({ length: 24 }, () => 0));

  for (const date of grid) {
    const { weekday, hour } = zonedStamp(date);

    cells[(weekday + 6) % 7][hour] += 1;
  }

  const counts = columns.map((column) => {
    const byDay = WEEKDAY_LABELS.map(() => 0);

    for (const date of column.dates) {
      byDay[(zonedStamp(date).weekday + 6) % 7] += 1;
    }

    return byDay;
  });

  const columnWidths = columns.map((column) => column.label.length + 2);

  const header: Line = [
    {
      text: `    ${['00    03', '06    09', '12    15', '18    21'].map((label) => label.padEnd(12)).join(' ')}`,
      fg: theme.dim,
    },
    { text: columns.map((column, i) => column.label.padStart(columnWidths[i])).join(''), fg: theme.dim },
  ];

  const lines: Line[] = [header];

  for (const [day, label] of WEEKDAY_LABELS.entries()) {
    const line: Line = [{ text: `${label} `, fg: theme.muted }];

    for (let hour = 0; hour < 24; hour++) {
      const count = cells[day][hour];

      line.push(count === 0 ? { text: '  ' } : { text: '  ', bg: heatColor(count) });

      if (hour % 6 === 5 && hour < 23) {
        line.push({ text: '│', fg: theme.border });
      }
    }

    for (const [i, column] of columns.entries()) {
      const count = counts[i][day];

      line.push({
        text: (count === 0 ? '·' : String(count)).padStart(columnWidths[i]),
        fg: count === 0 ? theme.dim : column.muted === true ? theme.muted : theme.text,
      });
    }

    lines.push(line);
  }

  lines.push(
    [{ text: ' ' }],
    [
      { text: '    ' },
      { text: '  ', bg: theme.heat[0] },
      { text: ' 1  ', fg: theme.muted },
      { text: '  ', bg: theme.heat[1] },
      { text: ' 2  ', fg: theme.muted },
      { text: '  ', bg: theme.heat[2] },
      { text: ' 3-4  ', fg: theme.muted },
      { text: '  ', bg: theme.heat[3] },
      { text: ' 5+', fg: theme.muted },
      { text: `   ${legend}`, fg: theme.dim },
    ],
  );

  return { title, subtitle, lines };
}
