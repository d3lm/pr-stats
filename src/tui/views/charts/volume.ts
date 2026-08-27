import { zonedStamp } from '../../../time';
import { theme } from '../../theme';
import type { Card, Line } from './model';
import { mondayOf, WEEK_MS, weekAxisRow } from './weeks';

const VOLUME_ROWS = 4;
const VOLUME_MAX_BARS = 18;

/**
 * Eighth-height block characters for the top of a column, indexed by how
 * many eighths of the boundary row are filled.
 */
const V_PARTIALS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * Builds a per-week column chart of the given events. Each column is one
 * week, long ranges group several weeks per column, and the busiest
 * column is highlighted. Weights turn the columns from event counts into
 * per-week sums, one weight per date, like comment counts per PR.
 */
export function buildVolumeCard(title: string, dates: Date[], weights?: number[]): Card {
  const mondays = dates.map((date) => mondayOf(zonedStamp(date).dayUtcMs));
  const first = Math.min(...mondays);
  const weekCount = (Math.max(...mondays) - first) / WEEK_MS + 1;

  const weekly = Array.from({ length: weekCount }, () => 0);

  for (const [i, monday] of mondays.entries()) {
    weekly[(monday - first) / WEEK_MS] += weights?.[i] ?? 1;
  }

  const chunk = Math.ceil(weekCount / VOLUME_MAX_BARS);
  const bars: number[] = [];

  for (let offset = 0; offset < weekly.length; offset += chunk) {
    bars.push(weekly.slice(offset, offset + chunk).reduce((sum, value) => sum + value, 0));
  }

  const maxCount = Math.max(...bars, 1);
  const maxIndex = bars.indexOf(maxCount);
  const yWidth = String(maxCount).length;
  const mid = Math.round(maxCount / 2);

  const lines: Line[] = [];

  for (let row = 0; row < VOLUME_ROWS; row++) {
    const labelValue = row === 0 ? maxCount : row === VOLUME_ROWS / 2 && mid > 0 && mid < maxCount ? mid : null;

    const line: Line =
      labelValue === null
        ? [{ text: `${' '.repeat(yWidth + 1)}│`, fg: theme.dim }]
        : [{ text: `${String(labelValue).padStart(yWidth)} ┤`, fg: theme.dim }];

    for (const [bar, count] of bars.entries()) {
      const cells = (count / maxCount) * VOLUME_ROWS;
      const fromBottom = VOLUME_ROWS - row;

      let text = '  ';

      if (cells >= fromBottom) {
        text = '██';
      } else if (cells > fromBottom - 1) {
        const eighth = Math.max(1, Math.min(8, Math.round((cells - (fromBottom - 1)) * 8)));

        text = V_PARTIALS[eighth].repeat(2);
      }

      line.push({
        text: `${text}${bar < bars.length - 1 ? ' ' : ''}`,
        fg: bar === maxIndex ? theme.accent : theme.chartBar,
      });
    }

    lines.push(line);
  }

  lines.push(
    weekAxisRow(
      yWidth + 2 + bars.length * 3,
      yWidth + 2,
      bars.length,
      (bar) => bar * 3,
      (bar) => first + bar * chunk * WEEK_MS,
    ),
  );

  const total = weights === undefined ? dates.length : weights.reduce((sum, weight) => sum + weight, 0);
  const subtitle = `${weekCount} ${weekCount === 1 ? 'week' : 'weeks'} · ${total} total`;

  return { title, subtitle, lines };
}
