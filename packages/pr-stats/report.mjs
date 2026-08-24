import asciichart from 'asciichart';
import { isFullDayMode, timeMode } from './time.mjs';
import { percentile } from './utils.mjs';

/**
 * Holds the histogram buckets. initBuckets() fills this in once the time
 * mode is known, because business buckets scale with the working-day length.
 */
let BUCKETS = [];

export function initBuckets() {
  BUCKETS = makeBuckets();
}

function makeBuckets() {
  if (!timeMode.business || isFullDayMode()) {
    return [
      { label: '< 1h', max: 1 },
      { label: '1-4h', max: 4 },
      { label: '4-8h', max: 8 },
      { label: '8-24h', max: 24 },
      { label: '1-2d', max: 48 },
      { label: '2-4d', max: 96 },
      { label: '4-7d', max: 168 },
      { label: '> 7d', max: Infinity },
    ];
  }

  const wd = timeMode.dayHours;

  return [
    { label: '< 1h', max: 1 },
    { label: '1-4h', max: 4 },
    { label: '4h-1wd', max: wd },
    { label: '1-2wd', max: 2 * wd },
    { label: '2-3wd', max: 3 * wd },
    { label: '3-5wd', max: 5 * wd },
    { label: '5-10wd', max: 10 * wd },
    { label: '> 10wd', max: Infinity },
  ];
}

/**
 * Buckets for the changed-lines histogram. The scale is roughly logarithmic
 * because PR sizes are heavy-tailed, so linear buckets would pile almost
 * everything into the first bar.
 */
export const LINE_BUCKETS = [
  { label: '< 50', max: 50 },
  { label: '50-100', max: 100 },
  { label: '100-250', max: 250 },
  { label: '250-500', max: 500 },
  { label: '500-1k', max: 1000 },
  { label: '1k-2.5k', max: 2500 },
  { label: '2.5k-5k', max: 5000 },
  { label: '> 5k', max: Infinity },
];

/**
 * Buckets for the changed-files histogram, on the same roughly logarithmic
 * scale as the line buckets.
 */
export const FILE_BUCKETS = [
  { label: '1-2', max: 3 },
  { label: '3-5', max: 6 },
  { label: '6-10', max: 11 },
  { label: '11-20', max: 21 },
  { label: '21-50', max: 51 },
  { label: '> 50', max: Infinity },
];

function formatHours(hours) {
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  }

  if (hours < 2 * timeMode.dayHours) {
    return `${hours.toFixed(1)}h`;
  }

  return `${(hours / timeMode.dayHours).toFixed(1)}${timeMode.business && !isFullDayMode() ? 'wd' : 'd'}`;
}

/**
 * Formats a duration as counted hours without converting to days. The PR
 * lists use this so their values compare directly against an hour target.
 */
export function formatHoursOnly(hours) {
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  }

  return `${hours.toFixed(1)}h`;
}

/**
 * Returns " (N weeks)" once a duration reaches one week. Returns an empty
 * string otherwise. A week means five counted weekdays, or seven full days in
 * wall-clock mode.
 */
export function weeksSuffix(hours) {
  const weekHours = timeMode.business ? 5 * timeMode.dayHours : 7 * 24;

  if (hours < weekHours) {
    return '';
  }

  return ` (${(hours / weekHours).toFixed(1)} weeks)`;
}

export function printHistogram(title, values, buckets = BUCKETS) {
  const counts = buckets.map(() => 0);

  for (const value of values) {
    counts[buckets.findIndex((bucket) => value < bucket.max)] += 1;
  }

  const maxCount = Math.max(...counts, 1);
  const labelWidth = Math.max(...buckets.map((bucket) => bucket.label.length));

  console.info(`\n${title}`);

  for (const [i, bucket] of buckets.entries()) {
    const bar = '█'.repeat(Math.round((counts[i] / maxCount) * 40)) || (counts[i] > 0 ? '▏' : '');

    const pct = values.length > 0 ? Math.round((counts[i] / values.length) * 100) : 0;

    console.info(`  ${bucket.label.padEnd(labelWidth)}  ${bar.padEnd(40)} ${String(counts[i]).padStart(4)}  (${pct}%)`);
  }
}

/**
 * Prints the summary line and the target gauge. The percentiles only cover
 * completed reviews. The gauge additionally counts pending reviews that have
 * already waited longer than the target, because those are guaranteed misses
 * no matter when the review lands.
 */
export function printStats(hoursList, targetHours, targetLabel, pendingHours = []) {
  const sorted = [...hoursList].toSorted((a, b) => a - b);
  const mean = sorted.reduce((sum, hours) => sum + hours, 0) / sorted.length;

  console.info(
    `\n  min ${formatHours(sorted[0])}` +
      ` | mean ${formatHours(mean)}` +
      ` | p50 ${formatHours(percentile(sorted, 50))}` +
      ` | p90 ${formatHours(percentile(sorted, 90))}` +
      ` | p99 ${formatHours(percentile(sorted, 99))}` +
      ` | max ${formatHours(sorted.at(-1))}`,
  );

  if (targetHours !== undefined) {
    const overdue = pendingHours.filter((hours) => hours > targetHours).length;
    const met = sorted.filter((hours) => hours <= targetHours).length;
    const total = sorted.length + overdue;
    const pct = (met / total) * 100;
    const filled = Math.round((pct / 100) * 30);
    const gauge = '█'.repeat(filled) + '░'.repeat(30 - filled);

    console.info(
      `  target <= ${targetLabel}  ${gauge} ${pct.toFixed(0)}% met` +
        ` (${met}/${total}${overdue > 0 ? `, ${overdue} awaiting review and already over` : ''})`,
    );
  }
}

/**
 * Prints one summary line per size metric. The columns are padded so the
 * percentiles line up across metrics.
 */
export function printSizeStats(title, metrics) {
  const rows = metrics.map(({ label, values }) => {
    const sorted = [...values].toSorted((a, b) => a - b);
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;

    return {
      label,
      cells: [
        ['min', String(sorted[0])],
        ['mean', String(Math.round(mean))],
        ['p50', String(percentile(sorted, 50))],
        ['p90', String(percentile(sorted, 90))],
        ['p99', String(percentile(sorted, 99))],
        ['max', String(sorted.at(-1))],
      ],
    };
  });

  const labelWidth = Math.max(...rows.map((row) => row.label.length));

  const columnWidths = rows[0].cells.map((_, i) => Math.max(...rows.map((row) => row.cells[i][1].length)));

  console.info(`\n${title}`);

  for (const row of rows) {
    const cells = row.cells.map(([name, value], i) => `${name} ${value.padStart(columnWidths[i])}`).join(' | ');

    console.info(`  ${row.label.padEnd(labelWidth)}  ${cells}`);
  }
}

/**
 * Prints one distribution strip per metric. Each strip spans that metric's
 * min to max on a log scale, the shaded box covers p25 to p75, and the solid
 * block marks the median. Log1p handles metrics whose minimum is zero.
 */
export function printQuantileStrips(title, metrics, width = 40) {
  const rows = metrics.map(({ label, values }) => {
    const sorted = [...values].toSorted((a, b) => a - b);
    const min = sorted[0];
    const max = sorted.at(-1);
    const span = Math.log1p(max) - Math.log1p(min);

    const position = (value) => {
      if (span === 0) {
        return 0;
      }

      return Math.round(((Math.log1p(value) - Math.log1p(min)) / span) * (width - 1));
    };

    const cells = Array.from({ length: width }, () => '─');

    cells[0] = '├';
    cells[width - 1] = '┤';

    for (let i = position(percentile(sorted, 25)); i <= position(percentile(sorted, 75)); i++) {
      cells[i] = '▒';
    }

    cells[position(percentile(sorted, 50))] = '█';

    return { label, strip: cells.join(''), min: String(min), max: String(max) };
  });

  const labelWidth = Math.max(...rows.map((row) => row.label.length));
  const minWidth = Math.max(...rows.map((row) => row.min.length));

  console.info(`\n${title}`);

  for (const row of rows) {
    console.info(`  ${row.label.padEnd(labelWidth)}  ${row.min.padStart(minWidth)} ${row.strip} ${row.max}`);
  }
}

/**
 * Formats a count with a k suffix from one thousand upward so the chart axis
 * labels stay short.
 */
function formatCount(value) {
  if (value < 1000) {
    return String(value);
  }

  const scaled = value / 1000;

  return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)}k`;
}

/**
 * Prints a line chart of PR sizes in chronological order. The values are
 * plotted on a log scale because sizes are heavy-tailed, and the axis labels
 * translate back to line counts. The width adapts to the terminal. Long
 * series collapse several PRs into one averaged point, and short series
 * repeat each point so the chart fills the width instead of squashing into
 * one column per PR.
 */
export function printSizeTimeline(values) {
  /**
   * The axis labels and the indent take up around twelve columns. The floor
   * keeps narrow terminals usable and the cap keeps very wide terminals from
   * producing an unreadably long chart.
   */
  const maxPoints = Math.max(40, Math.min((process.stdout.columns ?? 90) - 12, 100));

  let series = values;
  let chunk = 1;

  if (values.length > maxPoints) {
    chunk = Math.ceil(values.length / maxPoints);
    series = [];

    for (let offset = 0; offset < values.length; offset += chunk) {
      const slice = values.slice(offset, offset + chunk);

      series.push(slice.reduce((sum, value) => sum + value, 0) / slice.length);
    }
  }

  const stretch = Math.floor(maxPoints / series.length);

  if (stretch > 1) {
    series = series.flatMap((value) => Array.from({ length: stretch }, () => value));
  }

  const chart = asciichart.plot(
    series.map((value) => Math.log10(value + 1)),
    {
      height: 10,
      format: (x) => formatCount(Math.round(10 ** x - 1)).padStart(7),
    },
  );

  console.info(
    `\nLines changed per authored PR over time (n=${values.length}, log scale` +
      `${chunk > 1 ? `, each point averages ${chunk} PRs` : ''})`,
  );

  console.info(
    chart
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
  );
}
