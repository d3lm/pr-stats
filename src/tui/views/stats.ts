import { computeCommentStats, computeReviewStats, computeSizeStats } from '../../compute';
import { COMMENT_BUCKETS, currentBuckets, FILE_BUCKETS, formatCount, LINE_BUCKETS } from '../../report';
import { percentile } from '../../utils';
import type { RawData } from '../data/load';
import { theme } from '../theme';
import { buildDistribution, COUNT_TICKS, DURATION_TICKS, type Distribution } from './charts/distribution';
import { buildGaugeCard } from './charts/gauge';
import { buildHeatmapCard } from './charts/heatmap';
import { buildHistogramCard } from './charts/histogram';
import { formatDuration, type Card, type Line } from './charts/model';
import { buildScatterCard } from './charts/scatter';
import { buildSpreadCard } from './charts/spread';
import { buildTrendCard } from './charts/trend';
import { buildVolumeCard } from './charts/volume';
import { durationLead, toPrRows, type PrList } from './rows';

/**
 * Everything a stats tab renders, shared between the review tab and the
 * size tab so both go through the same panel.
 */
export interface StatsView {
  empty: string | null;
  /**
   * Holds the pinned summary cells above the charts, rendered as one row
   * with the cells spread across the width.
   */
  strip: Line[];
  /**
   * Holds the headline percentiles that render right-aligned in the scope
   * row, or null when there is nothing to summarize.
   */
  headline: Line | null;
  /**
   * Titles the full-width distribution strip at the top of the scroll
   * area.
   */
  distributionTitle: string;
  /**
   * The message shown in place of the card grid when there is nothing to
   * chart.
   */
  noCharts: string;
  /**
   * Holds the chart cards for the two columns of the responsive grid. On
   * narrow terminals the panel stacks left before right.
   */
  left: Card[];
  right: Card[];
  distribution: Distribution | null;
  lists: PrList[];
}

/**
 * Builds one strip cell, a bold count followed by its muted label. With
 * dimWhenZero set, a zero count renders fully dim so the quiet cells
 * recede.
 */
function countCell(count: number, label: string, dimWhenZero = false): Line {
  const dim = dimWhenZero && count === 0;

  return [
    { text: String(count), fg: dim ? theme.dim : theme.text, bold: true },
    { text: ` ${label}`, fg: dim ? theme.dim : theme.muted },
  ];
}

/**
 * Builds everything the review tab renders. Call this after the time mode
 * is configured, because durations and buckets depend on it. Passing a
 * repo narrows every chart and list to that repo. The width argument sizes
 * the full-width distribution strip to the visible pane.
 */
export function buildReviewView(
  raw: RawData,
  targetHours: number | undefined,
  targetLabel: string | undefined,
  repo: string | null = null,
  width = 100,
): StatsView {
  const results = repo === null ? raw.reviewResults : raw.reviewResults.filter((result) => result.pr.repo === repo);
  const stats = computeReviewStats(results, { targetHours, now: raw.fetchedAt });

  const strip = [
    countCell(stats.reviewed.length, 'reviewed on request'),
    countCell(stats.pending.length, 'awaiting you', true),
    countCell(stats.expired.length, 'closed unreviewed', true),
    [{ text: `${stats.unrequested.length} reviewed unasked (excluded)`, fg: theme.dim }],
  ];

  const base = {
    strip,
    headline: null,
    distributionTitle: 'Review time distribution',
    noCharts: 'No completed reviews to chart.',
    left: [],
    right: [],
    distribution: null,
  };

  if (results.length === 0) {
    return { empty: 'No reviewed or review-requested PRs found.', ...base, lists: [] };
  }

  const lists: PrList[] = [];

  if (targetHours !== undefined && stats.misses.length > 0) {
    lists.push({
      title: `Reviews that missed the <= ${targetLabel} target`,
      rows: toPrRows(stats.misses, stats.misses.map(durationLead)),
    });
  }

  if (stats.reviewed.length === 0) {
    return { empty: null, ...base, lists };
  }

  const sorted = [...stats.allHours].toSorted((a, b) => a - b);
  const total = raw.reviewResults.filter((result) => result.kind === 'reviewed').length;

  const headline: Line = [
    { text: 'p50 ', fg: theme.muted },
    { text: formatDuration(percentile(sorted, 50)), fg: theme.accent },
    { text: '   p90 ', fg: theme.muted },
    { text: formatDuration(percentile(sorted, 90)), fg: theme.accent },
    { text: `   ${stats.reviewed.length} of ${total} reviews`, fg: theme.muted },
  ];

  const requestDates = [...stats.reviewed, ...stats.pending].map((entry) => entry.requestedAt);
  const reviewDates = stats.reviewed.map((entry) => entry.reviewedAt);

  const left = [
    buildHistogramCard({
      title: 'Time to review',
      subtitle: 'elapsed time, request → review',
      values: stats.allHours,
      buckets: currentBuckets(),
      format: formatDuration,
    }),
    buildHeatmapCard({
      title: 'When you review',
      subtitle: 'reviews submitted, weekday × hour, local time',
      grid: reviewDates,
      columns: [
        { label: 'rev', dates: reviewDates },
        { label: 'req', dates: requestDates, muted: true },
      ],
      legend: 'reviews in that hour',
    }),
  ];

  const right = [
    buildTrendCard({
      title: 'Review time trend',
      entries: stats.reviewed.map((entry) => {
        return { date: entry.reviewedAt, value: entry.hours };
      }),
      format: formatDuration,
      floor: 1 / 60,
    }),
    buildVolumeCard('Reviews completed per week', reviewDates),
  ];

  if (targetHours !== undefined && targetLabel !== undefined) {
    const inside = stats.allHours.filter((value) => value <= targetHours).length;

    /**
     * Pending reviews that have already waited past the target are
     * guaranteed misses no matter when the review lands, so they join the
     * denominator.
     */
    const overdue = stats.pending.filter((entry) => entry.hours > targetHours).length;

    left.push(
      buildGaugeCard({
        title: 'Service level',
        subtitle: `reviewed within ${targetLabel}`,
        rows: [
          { label: `inside ${targetLabel}`, count: inside, color: theme.accent },
          { label: `over ${targetLabel}`, count: stats.allHours.length - inside, color: theme.chartDim },
          ...(overdue > 0 ? [{ label: 'awaiting and already over', count: overdue, color: theme.warn }] : []),
        ],
      }),
    );
  }

  /**
   * The strip spans the scroll area's content width, which is the terminal
   * width minus one column of left padding and the two-column right
   * padding that holds the scrollbar gutter. That right-aligns its end
   * with the stats row above it and keeps a one-column gap to the
   * overlaid scrollbar.
   */
  const distribution = buildDistribution({
    values: stats.allHours,
    width: Math.max(width - 3, 40),
    format: formatDuration,
    ticks: DURATION_TICKS,
    flat: (count, value) => `all ${count} ${count === 1 ? 'review' : 'reviews'} took ${value}`,
  });

  return { empty: null, ...base, headline, left, right, distribution, lists };
}

/**
 * Builds everything the size tab renders. Passing a repo narrows every
 * chart and list to that repo. The width argument sizes the full-width
 * distribution strip to the visible pane.
 */
export function buildSizeView(
  raw: RawData,
  sizeTarget: { lines?: number; files?: number } | undefined,
  repo: string | null = null,
  width = 100,
): StatsView {
  const base = {
    strip: [] as Line[],
    headline: null,
    distributionTitle: 'PR size distribution',
    noCharts: 'No authored PRs to chart.',
    left: [],
    right: [],
    distribution: null,
    lists: [],
  };

  if (raw.authoredTotal === 0) {
    return { empty: 'No authored PRs found.', ...base };
  }

  const sizes = repo === null ? raw.sizes : raw.sizes.filter((size) => size.pr.repo === repo);

  if (sizes.length === 0) {
    return { empty: 'No accessible authored PRs to analyze.', ...base };
  }

  const open = sizes.filter((size) => size.pr.state === 'open').length;

  const strip = [
    countCell(sizes.length, 'PRs analyzed'),
    countCell(open, 'open', true),
    countCell(sizes.length - open, 'merged or closed', true),
  ];

  /**
   * Inaccessible PRs never make it into the size entries, so their count
   * is only known across all repos and the cell stays off the per-repo
   * views.
   */
  if (repo === null) {
    strip.push([{ text: `${raw.authoredTotal - raw.sizes.length} inaccessible (excluded)`, fg: theme.dim }]);
  }

  const stats = computeSizeStats(sizes, { sizeTarget });
  const totals = sizes.map((size) => size.total);
  const sorted = [...totals].toSorted((a, b) => a - b);
  const created = sizes.map((size) => size.pr.createdAt);

  const headline: Line = [
    { text: 'p50 ', fg: theme.muted },
    { text: `${count(percentile(sorted, 50))} lines`, fg: theme.accent },
    { text: '   p90 ', fg: theme.muted },
    { text: `${count(percentile(sorted, 90))} lines`, fg: theme.accent },
    { text: `   ${sizes.length} of ${raw.sizes.length} PRs`, fg: theme.muted },
  ];

  const left = [
    buildHistogramCard({
      title: 'PR size',
      subtitle: 'total lines changed per authored PR',
      values: totals,
      buckets: LINE_BUCKETS,
      format: count,
    }),
    buildHistogramCard({
      title: 'Files touched',
      subtitle: 'files changed per authored PR',
      values: sizes.map((size) => size.files),
      buckets: FILE_BUCKETS,
      format: count,
    }),
    buildHeatmapCard({
      title: 'When you open PRs',
      subtitle: 'PRs opened, weekday × hour, local time',
      grid: created,
      columns: [{ label: 'opened', dates: created }],
      legend: 'PRs opened in that hour',
    }),
  ];

  const right = [
    buildTrendCard({
      title: 'PR size trend',
      entries: sizes.map((size) => {
        return { date: size.pr.createdAt, value: size.total };
      }),
      format: count,
      floor: 1,
    }),
    buildVolumeCard('PRs opened per week', created),
    buildSpreadCard('Size spread', stats.metrics, count),
  ];

  if (stats.met !== undefined && stats.targetLabel !== undefined) {
    left.push(
      buildGaugeCard({
        title: 'Size target',
        subtitle: `authored within ${stats.targetLabel}`,
        rows: [
          { label: 'inside target', count: stats.met, color: theme.accent },
          { label: 'over target', count: sizes.length - stats.met, color: theme.chartDim },
        ],
      }),
    );
  }

  const distribution = buildDistribution({
    values: totals,
    width: Math.max(width - 3, 40),
    format: count,
    ticks: COUNT_TICKS,
    flat: (n, value) => `all ${n} ${n === 1 ? 'PR' : 'PRs'} changed ${value} lines`,
  });

  const lists: PrList[] = [];

  if (sizeTarget !== undefined && stats.misses.length > 0) {
    lists.push({
      title: 'Authored PRs over the size target',
      rows: toPrRows(
        stats.misses,
        stats.misses.map((size) => `+${size.additions}/-${size.deletions}, ${size.files} files`),
      ),
    });
  }

  return { empty: null, ...base, strip, headline, left, right, distribution, lists };
}

/**
 * Builds everything the comments tab renders, from the comment counts
 * that ride along on the size entries. Passing a repo narrows every chart
 * and list to that repo. The width argument sizes the full-width
 * distribution strip to the visible pane.
 */
export function buildCommentView(raw: RawData, repo: string | null = null, width = 100): StatsView {
  const base = {
    strip: [] as Line[],
    headline: null,
    distributionTitle: 'Comments per PR distribution',
    noCharts: 'No authored PRs to chart.',
    left: [],
    right: [],
    distribution: null,
    lists: [],
  };

  if (raw.authoredTotal === 0) {
    return { empty: 'No authored PRs found.', ...base };
  }

  const sizes = repo === null ? raw.sizes : raw.sizes.filter((size) => size.pr.repo === repo);

  if (sizes.length === 0) {
    return { empty: 'No accessible authored PRs to analyze.', ...base };
  }

  const stats = computeCommentStats(sizes);
  const received = stats.totals.reduce((sum, total) => sum + total, 0);

  const strip = [
    countCell(sizes.length, 'PRs analyzed'),
    countCell(received, 'comments received'),
    countCell(stats.uncommented, 'without comments', true),
  ];

  /**
   * Inaccessible PRs never make it into the entries, so their count is
   * only known across all repos and the cell stays off the per-repo
   * views, like on the size tab.
   */
  if (repo === null) {
    strip.push([{ text: `${raw.authoredTotal - raw.sizes.length} inaccessible (excluded)`, fg: theme.dim }]);
  }

  const sorted = [...stats.totals].toSorted((a, b) => a - b);
  const created = sizes.map((size) => size.pr.createdAt);

  const headline: Line = [
    { text: 'p50 ', fg: theme.muted },
    { text: `${count(percentile(sorted, 50))} comments`, fg: theme.accent },
    { text: '   p90 ', fg: theme.muted },
    { text: `${count(percentile(sorted, 90))} comments`, fg: theme.accent },
    { text: `   ${sizes.length} of ${raw.sizes.length} PRs`, fg: theme.muted },
  ];

  const left = [
    buildHistogramCard({
      title: 'Comments per PR',
      subtitle: 'discussion plus review comments per authored PR',
      values: stats.totals,
      buckets: COMMENT_BUCKETS,
      format: count,
    }),
    buildScatterCard({
      title: 'Comments vs size',
      subtitle: 'comments against lines changed, log scale',
      points: sizes.map((size) => {
        return { x: size.total, y: size.comments.total };
      }),
      formatX: count,
      formatY: count,
    }),
    buildSpreadCard('Comment spread', stats.metrics, count),
  ];

  const right = [
    buildTrendCard({
      title: 'Comment trend',
      entries: sizes.map((size) => {
        return { date: size.pr.createdAt, value: size.comments.total };
      }),
      format: count,
      floor: 1,
    }),
    buildVolumeCard('Comments received per week', created, stats.totals),
    buildGaugeCard({
      title: 'Feedback rate',
      subtitle: 'authored PRs that received comments',
      rows: [
        { label: 'commented', count: sizes.length - stats.uncommented, color: theme.accent },
        { label: 'no comments', count: stats.uncommented, color: theme.chartDim },
      ],
    }),
  ];

  const distribution = buildDistribution({
    values: stats.totals,
    width: Math.max(width - 3, 40),
    format: count,
    ticks: COUNT_TICKS,
    flat: (n, value) => `all ${n} ${n === 1 ? 'PR' : 'PRs'} received ${value} comments`,
  });

  const lists: PrList[] = [];

  if (stats.top.length > 0) {
    const top = stats.top.slice(0, 5);

    lists.push({
      title: 'Most commented PRs',
      rows: toPrRows(
        top,
        top.map((size) => {
          return `${String(size.comments.total).padStart(3)} comments (${size.comments.discussion} discussion, ${size.comments.review} review)`;
        }),
      ),
    });
  }

  return { empty: null, ...base, strip, headline, left, right, distribution, lists };
}

function count(value: number): string {
  return formatCount(Math.round(value));
}
