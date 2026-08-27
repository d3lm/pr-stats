import * as asciichart from 'asciichart';
import { zonedStamp } from '../../../time';
import { percentile } from '../../../utils';
import { theme } from '../../theme';
import type { Card, Line } from './model';
import { mondayOf, WEEK_MS, weekAxisRow } from './weeks';

const TREND_POINTS = 40;
const TREND_HEIGHT = 6;

/**
 * Finds where the y-axis ends in an asciichart line, so the label and axis
 * get colored differently from the plotted series. Every line carries
 * exactly one axis character.
 */
function axisSplit(line: string): number {
  const positions = [line.indexOf('┤'), line.indexOf('┼')].filter((at) => at >= 0);

  return positions.length === 0 ? 0 : Math.min(...positions) + 1;
}

export interface TrendSpec {
  title: string;
  /**
   * Holds the dated values the weekly medians are computed from, like
   * review durations or PR sizes.
   */
  entries: { date: Date; value: number }[];
  /**
   * Formats a value for the y-axis labels and the end-of-line annotation.
   */
  format: (value: number) => string;
  /**
   * Clamps values from below before taking the logarithm, so zero values
   * cannot blow up the scale.
   */
  floor: number;
}

/**
 * Builds a trend card as an asciichart line chart of weekly medians on a
 * log scale. Weeks without data carry the previous median forward so the
 * line stays continuous. Long ranges average several weeks per point, and
 * the final value is annotated at the line's end.
 */
export function buildTrendCard({ title, entries, format, floor }: TrendSpec): Card {
  const byWeek = new Map<number, number[]>();

  for (const entry of entries) {
    const monday = mondayOf(zonedStamp(entry.date).dayUtcMs);
    const values = byWeek.get(monday) ?? [];

    values.push(entry.value);
    byWeek.set(monday, values);
  }

  const mondays = [...byWeek.keys()];
  const first = Math.min(...mondays);
  const weekCount = (Math.max(...mondays) - first) / WEEK_MS + 1;

  if (weekCount < 2) {
    return {
      title,
      subtitle: 'weekly median, log scale',
      lines: [[{ text: 'not enough weeks to draw a trend', fg: theme.muted }]],
    };
  }

  const medians: number[] = [];

  for (let week = 0; week < weekCount; week++) {
    const values = byWeek.get(first + week * WEEK_MS);

    if (values !== undefined) {
      medians.push(
        percentile(
          values.toSorted((a, b) => a - b),
          50,
        ),
      );
    } else {
      medians.push(medians.at(-1) ?? 0);
    }
  }

  /**
   * Weeks before the first entry carry nothing forward, so they backfill
   * from the first known median. The first week always has data, which
   * makes this a no-op, but it keeps the series total when that changes.
   */
  const firstKnown = medians.find((value) => value > 0) ?? 0;

  for (let i = 0; i < medians.length && medians[i] === 0; i++) {
    medians[i] = firstKnown;
  }

  const chunk = Math.ceil(weekCount / TREND_POINTS);
  const points: number[] = [];

  for (let offset = 0; offset < medians.length; offset += chunk) {
    const slice = medians.slice(offset, offset + chunk);

    points.push(slice.reduce((sum, value) => sum + value, 0) / slice.length);
  }

  const stretch = Math.max(1, Math.floor(TREND_POINTS / points.length));
  const series = points.flatMap((value) => Array.from({ length: stretch }, () => value));
  const logs = series.map((value) => Math.log2(Math.max(value, floor)));

  let lo = Math.min(...logs);
  let hi = Math.max(...logs);

  /**
   * A flat series has no range, which asciichart cannot scale, so the
   * bounds widen by one octave in both directions and the line renders
   * in the middle.
   */
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }

  const chart = asciichart.plot(logs, {
    height: TREND_HEIGHT,
    min: lo,
    max: hi,
    format: (x) => format(2 ** x).padStart(6),
  });

  /**
   * The annotation row mirrors asciichart's own row math, so the final
   * value lands exactly at the end of the plotted line.
   */
  const ratio = TREND_HEIGHT / (hi - lo);
  const min2 = Math.round(lo * ratio);
  const rows = Math.abs(Math.round(hi * ratio) - min2);
  const lastRow = Math.min(rows, Math.max(0, rows - (Math.round((logs.at(-1) ?? 0) * ratio) - min2)));

  const raw = chart.split('\n');

  const lines = raw.map((line, i): Line => {
    const split = axisSplit(line);

    const spans: Line = [
      { text: line.slice(0, split), fg: theme.muted },
      { text: line.slice(split), fg: theme.chartLine },
    ];

    if (i === lastRow) {
      spans.push({ text: ` ${format(series.at(-1) ?? 0)}`, fg: theme.accent });
    }

    return spans;
  });

  /**
   * The y labels are padded to six characters and asciichart puts the axis
   * two cells later, so the plot begins at column eight.
   */
  const prefix = 8;

  lines.push(
    weekAxisRow(
      prefix + series.length,
      prefix,
      points.length,
      (point) => point * stretch,
      (point) => first + point * chunk * WEEK_MS,
    ),
  );

  const subtitle = chunk === 1 ? 'weekly median, log scale' : `median per ${chunk} weeks, log scale`;

  return { title, subtitle, lines };
}
