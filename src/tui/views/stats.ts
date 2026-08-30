import {
  computeCommentStats,
  computeFirstReviewStats,
  computeMergeStats,
  computeReviewerStats,
  computeReviewStats,
  computeSizeStats,
  type MergeStats,
  type ReviewedEntry,
} from '../../compute';
import { COMMENT_BUCKETS, currentBuckets, CYCLE_BUCKETS, FILE_BUCKETS, formatCount, LINE_BUCKETS } from '../../report';
import { classifyInstant, durationHours, hasWorkWindows, zonedStamp } from '../../time';
import { percentile } from '../../utils';
import type { RawData } from '../data/load';
import { theme } from '../theme';
import { buildBarsCard, MAX_BARS } from './charts/bars';
import { buildCumulativeCard } from './charts/cumulative';
import { buildDistribution, COUNT_TICKS, DURATION_TICKS, type Distribution } from './charts/distribution';
import { buildGaugeCard } from './charts/gauge';
import { buildHeatmapCard } from './charts/heatmap';
import { buildHistogramCard } from './charts/histogram';
import { formatDuration, type Card, type Line, type Span } from './charts/model';
import { buildScatterCard } from './charts/scatter';
import { buildSpreadCard } from './charts/spread';
import { buildTrendCard } from './charts/trend';
import { buildVolumeCard } from './charts/volume';
import { mondayOf, WEEK_MS } from './charts/weeks';
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
   * Holds the chart cards in display order. The panel deals them into
   * the responsive grid row by row, left cell first, so consecutive
   * cards share a row and a conditional card never leaves a hole. On
   * narrow terminals the cards stack in this order.
   */
  cards: Card[];
  distribution: Distribution | null;
  lists: PrList[];
  /**
   * Reports whether the tab has a capped card the x key can expand or an
   * expanded one it can collapse, so the footer only hints the key when
   * it does something.
   */
  expandable: boolean;
  /**
   * Mirrors whether the capped cards render expanded, so the footer
   * words the x hint as expand or collapse.
   */
  expanded: boolean;
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
 * Turns an encoded Monday back into an instant that zonedStamp maps into
 * the same week in every configured timezone. Noon UTC stays inside the
 * same local week for every offset the world uses, while midnight would
 * slip one week back in timezones behind UTC.
 */
function mondayNoon(monday: number): Date {
  return new Date(monday + 12 * 3_600_000);
}

/**
 * Sums dated values into one entry per week for the linear trends, dated
 * on each week's Monday. Weeks without data get a zero entry, because a
 * quiet week really contributes nothing, unlike the median trends where
 * a gap carries the previous value forward.
 */
function weeklySums(entries: { date: Date; value: number }[]): { date: Date; value: number }[] {
  const byWeek = new Map<number, number>();

  for (const entry of entries) {
    const monday = mondayOf(zonedStamp(entry.date).dayUtcMs);

    byWeek.set(monday, (byWeek.get(monday) ?? 0) + entry.value);
  }

  const mondays = [...byWeek.keys()];
  const first = Math.min(...mondays);
  const last = Math.max(...mondays);
  const result: { date: Date; value: number }[] = [];

  for (let monday = first; monday <= last; monday += WEEK_MS) {
    result.push({ date: mondayNoon(monday), value: byWeek.get(monday) ?? 0 });
  }

  return result;
}

/**
 * Builds one merge-rate entry per creation week, the merged share of that
 * week's concluded PRs as a percentage. Open PRs stay out of the rate
 * because their outcome is not known yet, so a week whose PRs are all
 * still open gets no entry and the trend carries the previous rate
 * forward.
 */
function mergeRateEntries(stats: MergeStats): { date: Date; value: number }[] {
  const byWeek = new Map<number, { merged: number; concluded: number }>();

  const add = (createdAt: Date, merged: boolean) => {
    const monday = mondayOf(zonedStamp(createdAt).dayUtcMs);
    const counts = byWeek.get(monday) ?? { merged: 0, concluded: 0 };

    counts.concluded += 1;
    counts.merged += merged ? 1 : 0;

    byWeek.set(monday, counts);
  };

  for (const result of stats.merged) {
    add(result.entry.pr.createdAt, true);
  }

  for (const result of stats.closed) {
    add(result.entry.pr.createdAt, false);
  }

  return [...byWeek.entries()].map(([monday, counts]) => {
    return { date: mondayNoon(monday), value: (counts.merged / counts.concluded) * 100 };
  });
}

/**
 * Builds the off-hours gauge over the given instants, split by the
 * configured working calendar in the configured timezone. With working
 * windows set, the weekday rows split into work hours and after hours,
 * and without them weekdays form a single row against the weekend.
 */
function buildOffHoursCard(subtitle: string, dates: Date[]): Card {
  const counts = { work: 0, after: 0, weekend: 0 };

  for (const date of dates) {
    counts[classifyInstant(date)] += 1;
  }

  const rows = hasWorkWindows()
    ? [
        { label: 'work hours', count: counts.work, color: theme.accent },
        { label: 'after hours', count: counts.after, color: theme.warn },
        { label: 'weekend', count: counts.weekend, color: theme.chartDim },
      ]
    : [
        { label: 'weekday', count: counts.work + counts.after, color: theme.accent },
        { label: 'weekend', count: counts.weekend, color: theme.chartDim },
      ];

  return buildGaugeCard({ title: 'Off-hours share', subtitle, rows });
}

/**
 * Builds the verdict gauge over the completed review cycles. The three
 * regular GitHub review states get one row each, and anything else, like
 * a dismissed review, folds into an other row that only shows when it
 * has entries. Every row renders in the chart bar color with the most
 * common verdict in the accent color, like the bars card, so the card
 * stays within the theme's hue instead of mixing the status colors.
 */
function buildVerdictCard(reviewed: ReviewedEntry[]): Card {
  const countOf = (state: string) => reviewed.filter((entry) => entry.verdict === state).length;
  const approved = countOf('APPROVED');
  const changes = countOf('CHANGES_REQUESTED');
  const commented = countOf('COMMENTED');
  const other = reviewed.length - approved - changes - commented;

  const counts = [
    { label: 'approved', count: approved },
    { label: 'changes requested', count: changes },
    { label: 'commented', count: commented },
    ...(other > 0 ? [{ label: 'other', count: other }] : []),
  ];

  const max = Math.max(...counts.map((row) => row.count));

  return buildGaugeCard({
    title: 'Review verdicts',
    subtitle: 'how your requested reviews concluded',
    rows: counts.map((row) => {
      return { ...row, color: row.count === max ? theme.accent : theme.chartBar };
    }),
  });
}

/**
 * The configured review target the review tab reports against. The hours
 * and label come from the review target option, and the percentile names
 * which percentile of the review times the headline checks against the
 * target.
 */
export interface ReviewTarget {
  hours: number;
  label: string;
  percentile: number;
}

/**
 * Builds the headline segment that reports how far the target percentile
 * of the review times sits under or over the configured target. Meeting
 * the target exactly counts as within it, matching the service-level
 * gauge.
 */
function targetStatus(sorted: number[], target: ReviewTarget): Span {
  const margin = target.hours - percentile(sorted, target.percentile);

  if (margin < 0) {
    return { text: `   ${formatDuration(-margin)} over the ${target.label} target`, fg: theme.error };
  }

  const lead = margin === 0 ? 'at' : `${formatDuration(margin)} under`;

  return { text: `   ${lead} the ${target.label} target`, fg: theme.success };
}

/**
 * Builds everything the review tab renders. Call this after the time mode
 * is configured, because durations and buckets depend on it. The target
 * drives the miss list, the service-level gauge, and the headline's
 * target status. Passing a repo narrows every chart and list to that
 * repo. The width argument sizes the full-width distribution strip to the
 * visible pane, and the expanded flag lifts the row cap of the by-repo
 * comparison.
 */
export function buildReviewView(
  raw: RawData,
  target: ReviewTarget | undefined,
  repo: string | null = null,
  width = 100,
  expanded = false,
): StatsView {
  const results = repo === null ? raw.reviewResults : raw.reviewResults.filter((result) => result.pr.repo === repo);
  const stats = computeReviewStats(results, { targetHours: target?.hours, now: raw.fetchedAt });

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
    cards: [],
    distribution: null,
    expandable: false,
    expanded,
  };

  if (results.length === 0) {
    return { empty: 'No reviewed or review-requested PRs found.', ...base, lists: [] };
  }

  const lists: PrList[] = [];

  if (target !== undefined && stats.misses.length > 0) {
    lists.push({
      title: `Reviews that missed the <= ${target.label} target`,
      rows: toPrRows(stats.misses, stats.misses.map(durationLead)),
    });
  }

  /**
   * The pending-age histogram only needs open requests, so it renders
   * even when no review has completed yet and the other charts stay
   * away.
   */
  const pendingCard =
    stats.pending.length === 0
      ? null
      : buildHistogramCard({
          title: 'Pending request age',
          subtitle: 'how long open requests have waited',
          values: stats.pending.map((entry) => entry.hours),
          buckets: currentBuckets(),
          format: formatDuration,
        });

  if (stats.reviewed.length === 0) {
    return { empty: null, ...base, cards: pendingCard === null ? [] : [pendingCard], lists };
  }

  const sorted = [...stats.allHours].toSorted((a, b) => a - b);
  const total = raw.reviewResults.filter((result) => result.kind === 'reviewed').length;

  /**
   * The headline pairs the median with the target percentile, which stays
   * p90 without a target. With a target set, the percentile the target
   * checks takes the status color and a segment spells out how far it
   * sits under or over the target, so the pinned row answers the target
   * question at a glance.
   */
  const secondPercentile = target === undefined || target.percentile === 50 ? 90 : target.percentile;

  const percentileColor = (percent: number): string => {
    if (target === undefined || percent !== target.percentile) {
      return theme.accent;
    }

    return percentile(sorted, target.percentile) <= target.hours ? theme.success : theme.error;
  };

  const headline: Line = [
    { text: 'p50 ', fg: theme.muted },
    { text: formatDuration(percentile(sorted, 50)), fg: percentileColor(50) },
    { text: `   p${secondPercentile} `, fg: theme.muted },
    { text: formatDuration(percentile(sorted, secondPercentile)), fg: percentileColor(secondPercentile) },
    ...(target === undefined ? [] : [targetStatus(sorted, target)]),
    { text: `   ${stats.reviewed.length} of ${total} reviews`, fg: theme.muted },
  ];

  const requestDates = [...stats.reviewed, ...stats.pending].map((entry) => entry.requestedAt);
  const reviewDates = stats.reviewed.map((entry) => entry.reviewedAt);

  /**
   * The age at request measures how long a PR already existed before the
   * review request reached you, over the same completed and pending
   * cycles the other request charts cover.
   */
  const requestAges = [...stats.reviewed, ...stats.pending].map((entry) =>
    durationHours(entry.pr.createdAt, entry.requestedAt),
  );

  /**
   * The service-level gauge only renders with a configured target, and it
   * leads the card grid because target adherence is the tab's headline
   * question once a target is set. Pending reviews that have already
   * waited past the target are guaranteed misses no matter when the
   * review lands, so they join the denominator.
   */
  let serviceCard: Card | null = null;

  if (target !== undefined) {
    const inside = stats.allHours.filter((value) => value <= target.hours).length;
    const overdue = stats.pending.filter((entry) => entry.hours > target.hours).length;

    serviceCard = buildGaugeCard({
      title: 'Service level',
      subtitle: `reviewed within ${target.label}`,
      rows: [
        { label: `inside ${target.label}`, count: inside, color: theme.accent },
        { label: `over ${target.label}`, count: stats.allHours.length - inside, color: theme.chartDim },
        ...(overdue > 0 ? [{ label: 'awaiting and already over', count: overdue, color: theme.warn }] : []),
      ],
    });
  }

  /**
   * The by-repo comparison only makes sense on the aggregate view with
   * more than one repo, because a single repo compares against nothing
   * and the drilled-in views already scope every chart.
   */
  const byRepoCard =
    repo === null && stats.byRepo.length > 1
      ? buildBarsCard({
          title: 'Review time by repo',
          subtitle: 'median review time, slowest first',
          rows: stats.byRepo
            .map(([name, hours]) => {
              return {
                label: name,
                value: percentile(
                  hours.toSorted((a, b) => a - b),
                  50,
                ),
                detail: `n=${hours.length}`,
              };
            })
            .toSorted((a, b) => b.value - a.value),
          format: formatDuration,
          expanded,
        })
      : null;

  const cards = [
    ...(serviceCard === null ? [] : [serviceCard]),
    buildHistogramCard({
      title: 'Time to review',
      subtitle: 'elapsed time, request → review',
      values: stats.allHours,
      buckets: currentBuckets(),
      format: formatDuration,
    }),
    buildTrendCard({
      title: 'Review time trend',
      entries: stats.reviewed.map((entry) => {
        return { date: entry.reviewedAt, value: entry.hours };
      }),
      format: formatDuration,
      floor: 1 / 60,
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
    buildVolumeCard('Reviews completed per week', reviewDates),
    buildScatterCard({
      title: 'Review time vs size',
      subtitle: 'time to review against lines changed, log scale',
      points: stats.reviewed.map((entry) => {
        return { x: entry.lines, y: entry.hours };
      }),
      formatX: count,
      formatY: formatDuration,
    }),
    buildHistogramCard({
      title: 'Review cycles per PR',
      subtitle: 'completed request → review rounds per PR',
      values: stats.cycles,
      buckets: CYCLE_BUCKETS,
      format: count,
    }),
    buildHistogramCard({
      title: 'PR age at request',
      subtitle: 'elapsed time, PR created → review requested',
      values: requestAges,
      buckets: currentBuckets(),
      format: formatDuration,
    }),
    buildVerdictCard(stats.reviewed),
    ...(pendingCard === null ? [] : [pendingCard]),
    buildOffHoursCard('reviews submitted, local time', reviewDates),
    ...(byRepoCard === null ? [] : [byRepoCard]),
  ];

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

  return {
    empty: null,
    ...base,
    headline,
    cards,
    distribution,
    lists,
    expandable: byRepoCard !== null && stats.byRepo.length > MAX_BARS,
  };
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
    cards: [],
    distribution: null,
    lists: [],
    expandable: false,
    expanded: false,
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

  /**
   * The target gauge only renders with a configured size target.
   */
  const targetCard =
    stats.met !== undefined && stats.targetLabel !== undefined
      ? buildGaugeCard({
          title: 'Size target',
          subtitle: `authored within ${stats.targetLabel}`,
          rows: [
            { label: 'inside target', count: stats.met, color: theme.accent },
            { label: 'over target', count: sizes.length - stats.met, color: theme.chartDim },
          ],
        })
      : null;

  const cards = [
    buildHistogramCard({
      title: 'PR size',
      subtitle: 'total lines changed per authored PR',
      values: totals,
      buckets: LINE_BUCKETS,
      format: count,
    }),
    buildTrendCard({
      title: 'PR size trend',
      entries: sizes.map((size) => {
        return { date: size.pr.createdAt, value: size.total };
      }),
      format: count,
      floor: 1,
    }),
    buildHistogramCard({
      title: 'Files touched',
      subtitle: 'files changed per authored PR',
      values: sizes.map((size) => size.files),
      buckets: FILE_BUCKETS,
      format: count,
    }),
    buildTrendCard({
      title: 'Net lines trend',
      entries: weeklySums(
        sizes.map((size) => {
          return { date: size.pr.createdAt, value: size.additions - size.deletions };
        }),
      ),
      format: netCount,
      scale: 'linear',
      valueLabel: 'net lines',
    }),
    buildHeatmapCard({
      title: 'When you open PRs',
      subtitle: 'PRs opened, weekday × hour, local time',
      grid: created,
      columns: [{ label: 'opened', dates: created }],
      legend: 'PRs opened in that hour',
    }),
    buildVolumeCard('PRs opened per week', created),
    ...(targetCard === null ? [] : [targetCard]),
    buildSpreadCard('Size spread', stats.metrics, count),
  ];

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

  return { empty: null, ...base, strip, headline, cards, distribution, lists };
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
    cards: [],
    distribution: null,
    lists: [],
    expandable: false,
    expanded: false,
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

  const cards = [
    buildHistogramCard({
      title: 'Comments per PR',
      subtitle: 'discussion plus review comments per authored PR',
      values: stats.totals,
      buckets: COMMENT_BUCKETS,
      format: count,
    }),
    buildTrendCard({
      title: 'Comment trend',
      entries: sizes.map((size) => {
        return { date: size.pr.createdAt, value: size.comments.total };
      }),
      format: count,
      floor: 1,
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
    buildVolumeCard('Comments received per week', created, stats.totals),
    buildSpreadCard('Comment spread', stats.metrics, count),
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

  return { empty: null, ...base, strip, headline, cards, distribution, lists };
}

/**
 * Builds everything the merged sub-tab of the Your PRs tab renders, the
 * outcome counts of your authored PRs, the merge-time charts over the
 * merged ones, and the first-review charts over the PRs that received a
 * review. Call this after the time mode is configured, because the
 * durations and buckets depend on it. Passing a repo narrows every
 * chart and list to that repo. The width argument sizes the full-width
 * distribution strip to the visible pane, and the expanded flag lifts
 * the row cap of the reviewer leaderboard.
 */
export function buildMergedView(raw: RawData, repo: string | null = null, width = 100, expanded = false): StatsView {
  const base = {
    strip: [] as Line[],
    headline: null,
    distributionTitle: 'Time to merge distribution',
    noCharts: 'No merged PRs to chart.',
    cards: [],
    distribution: null,
    lists: [],
    expandable: false,
    expanded,
  };

  if (raw.authoredTotal === 0) {
    return { empty: 'No authored PRs found.', ...base };
  }

  const sizes = repo === null ? raw.sizes : raw.sizes.filter((size) => size.pr.repo === repo);

  if (sizes.length === 0) {
    return { empty: 'No accessible authored PRs to analyze.', ...base };
  }

  const stats = computeMergeStats(sizes);
  const reviewers = computeReviewerStats(sizes, raw.user);
  const firstReview = computeFirstReviewStats(sizes, raw.user, { now: raw.fetchedAt });

  const strip = [
    countCell(sizes.length, 'PRs created'),
    countCell(stats.merged.length, 'merged'),
    countCell(stats.closed.length, 'closed unmerged', true),
    countCell(stats.open.length, 'still open', true),
  ];

  /**
   * Inaccessible PRs never make it into the size entries, so their count
   * is only known across all repos and the cell stays off the per-repo
   * views, like on the size tab.
   */
  if (repo === null) {
    strip.push([{ text: `${raw.authoredTotal - raw.sizes.length} inaccessible (excluded)`, fg: theme.dim }]);
  }

  const lists: PrList[] = [];

  if (stats.merged.length > 0) {
    const top = stats.merged.slice(0, 5);

    lists.push({
      title: 'Recently merged PRs',
      rows: toPrRows(
        top.map((result) => result.entry),
        top.map((result) => `${durationLead(result)} to merge`),
      ),
    });
  }

  if (stats.closed.length > 0) {
    const top = stats.closed.slice(0, 5);

    lists.push({
      title: 'Closed without merging',
      rows: toPrRows(
        top.map((result) => result.entry),
        top.map((result) => `${durationLead(result)} to close`),
      ),
    });
  }

  /**
   * The leaderboard counts reviews on every authored PR, merged or not,
   * so it renders even when no PR has merged yet and the merge charts
   * stay away.
   */
  const reviewerCard =
    reviewers.leaderboard.length === 0
      ? null
      : buildBarsCard({
          title: 'Who reviews your PRs',
          subtitle: 'distinct PRs reviewed per person',
          rows: reviewers.leaderboard.map((row) => {
            return {
              label: row.login,
              value: row.prs,
              detail: row.reviews === 1 ? '1 review' : `${row.reviews} reviews`,
            };
          }),
          format: count,
          expanded,
        });

  const expandable = reviewers.leaderboard.length > MAX_BARS;

  /**
   * The first-review charts measure how long your authored PRs waited
   * for their first review from someone else, the author-side counterpart
   * of the review tab. They only need reviews, not merges, so they render
   * even when no PR has merged yet and the merge charts stay away.
   * The awaiting histogram covers the open PRs still without a review,
   * mirroring the pending card on the review tab.
   */
  const firstReviewCards = [
    ...(firstReview.received.length === 0
      ? []
      : [
          buildHistogramCard({
            title: 'Time to first review',
            subtitle: 'elapsed time, created → first review received',
            values: firstReview.allHours,
            buckets: currentBuckets(),
            format: formatDuration,
          }),
          buildTrendCard({
            title: 'First review time trend',
            entries: firstReview.received.map((result) => {
              return { date: result.reviewedAt, value: result.hours };
            }),
            format: formatDuration,
            floor: 1 / 60,
          }),
        ]),
    ...(firstReview.awaiting.length === 0
      ? []
      : [
          buildHistogramCard({
            title: 'Awaiting first review',
            subtitle: 'how long open unreviewed PRs have waited',
            values: firstReview.awaiting.map((result) => result.hours),
            buckets: currentBuckets(),
            format: formatDuration,
          }),
        ]),
  ];

  if (stats.merged.length === 0) {
    return {
      empty: null,
      ...base,
      strip,
      cards: [...firstReviewCards, ...(reviewerCard === null ? [] : [reviewerCard])],
      lists,
      expandable,
    };
  }

  const sorted = [...stats.allHours].toSorted((a, b) => a - b);

  const headline: Line = [
    { text: 'p50 ', fg: theme.muted },
    { text: formatDuration(percentile(sorted, 50)), fg: theme.accent },
    { text: '   p90 ', fg: theme.muted },
    { text: formatDuration(percentile(sorted, 90)), fg: theme.accent },
    { text: `   ${stats.merged.length} of ${sizes.length} PRs merged`, fg: theme.muted },
  ];

  const mergeDates = stats.merged.map((result) => result.mergedAt);
  const created = sizes.map((size) => size.pr.createdAt);

  const cards = [
    buildHistogramCard({
      title: 'Time to merge',
      subtitle: 'elapsed time, created → merged',
      values: stats.allHours,
      buckets: currentBuckets(),
      format: formatDuration,
    }),
    buildTrendCard({
      title: 'Time to merge trend',
      entries: stats.merged.map((result) => {
        return { date: result.mergedAt, value: result.hours };
      }),
      format: formatDuration,
      floor: 1 / 60,
    }),
    ...firstReviewCards,
    buildHeatmapCard({
      title: 'When your PRs merge',
      subtitle: 'PRs merged, weekday × hour, local time',
      grid: mergeDates,
      columns: [
        { label: 'merged', dates: mergeDates },
        { label: 'created', dates: created, muted: true },
      ],
      legend: 'PRs merged in that hour',
    }),
    buildTrendCard({
      title: 'Merge rate trend',
      entries: mergeRateEntries(stats),
      format: (value) => `${Math.round(value)}%`,
      scale: 'linear',
      valueLabel: 'merge rate',
    }),
    buildScatterCard({
      title: 'Merge time vs size',
      subtitle: 'time to merge against lines changed, log scale',
      points: stats.merged.map((result) => {
        return { x: result.entry.total, y: result.hours };
      }),
      formatX: count,
      formatY: formatDuration,
    }),
    buildCumulativeCard({
      title: 'Created vs merged',
      series: [
        /**
         * The created line stays a neutral gray because every theme preset
         * keeps chartLine and accent in one hue family, which made the two
         * lines indistinguishable. The gray also survives theme changes,
         * since the presets only rotate the hue-carrying colors.
         */
        { label: 'created', dates: created, color: theme.muted },
        { label: 'merged', dates: mergeDates, color: theme.accent },
      ],
      legend: 'cumulative PRs by week',
    }),
    buildVolumeCard('PRs created per week', created),
    buildVolumeCard('PRs merged per week', mergeDates),
    buildGaugeCard({
      title: 'Outcomes',
      subtitle: 'where your authored PRs ended up',
      rows: [
        { label: 'merged', count: stats.merged.length, color: theme.accent },
        { label: 'closed unmerged', count: stats.closed.length, color: theme.warn },
        ...(stats.open.length > 0 ? [{ label: 'still open', count: stats.open.length, color: theme.chartDim }] : []),
      ],
    }),
    buildGaugeCard({
      title: 'Review coverage',
      subtitle: 'merged PRs that received a review',
      rows: [
        { label: 'reviewed', count: reviewers.mergedReviewed, color: theme.accent },
        { label: 'merged unreviewed', count: reviewers.mergedUnreviewed, color: theme.warn },
      ],
    }),
    ...(reviewerCard === null ? [] : [reviewerCard]),
  ];

  const distribution = buildDistribution({
    values: stats.allHours,
    width: Math.max(width - 3, 40),
    format: formatDuration,
    ticks: DURATION_TICKS,
    flat: (n, value) => `all ${n} merged ${n === 1 ? 'PR' : 'PRs'} took ${value}`,
  });

  return { empty: null, ...base, strip, headline, cards, distribution, lists, expandable };
}

function count(value: number): string {
  return formatCount(Math.round(value));
}

/**
 * Formats a signed line count with an explicit sign, so the net-lines
 * trend tells growth from shrinkage at a glance.
 */
function netCount(value: number): string {
  return value < 0 ? `-${count(-value)}` : `+${count(value)}`;
}
