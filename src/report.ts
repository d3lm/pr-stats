import { isFullDayMode, timeMode } from './time';

export interface Bucket {
  label: string;
  max: number;
}

/**
 * Holds the histogram buckets. initBuckets() fills this in once the time
 * mode is known, because business buckets scale with the working-day length.
 */
let BUCKETS: Bucket[] = [];

export function initBuckets(): void {
  BUCKETS = makeBuckets();
}

/**
 * Returns the duration buckets for the current time mode. Call initBuckets()
 * first, because the business buckets scale with the working-day length.
 */
export function currentBuckets(): Bucket[] {
  return BUCKETS;
}

function makeBuckets(): Bucket[] {
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
export const LINE_BUCKETS: Bucket[] = [
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
export const FILE_BUCKETS: Bucket[] = [
  { label: '1-2', max: 3 },
  { label: '3-5', max: 6 },
  { label: '6-10', max: 11 },
  { label: '11-20', max: 21 },
  { label: '21-50', max: 51 },
  { label: '> 50', max: Infinity },
];

/**
 * Buckets for the review-cycles histogram. One cycle means the PR was
 * done after a single review, so the low buckets get one bar each and
 * only the rare high counts share one.
 */
export const CYCLE_BUCKETS: Bucket[] = [
  { label: '1', max: 2 },
  { label: '2', max: 3 },
  { label: '3', max: 4 },
  { label: '4-5', max: 6 },
  { label: '> 5', max: Infinity },
];

/**
 * Buckets for the comments-per-PR histogram. Zero gets its own bucket
 * because silent merges are worth seeing on their own, and the rest grows
 * roughly logarithmically like the size buckets.
 */
export const COMMENT_BUCKETS: Bucket[] = [
  { label: '0', max: 1 },
  { label: '1-2', max: 3 },
  { label: '3-5', max: 6 },
  { label: '6-10', max: 11 },
  { label: '11-20', max: 21 },
  { label: '21-50', max: 51 },
  { label: '> 50', max: Infinity },
];

/**
 * Formats a duration as counted hours without converting to days. The PR
 * lists use this so their values compare directly against an hour target.
 */
export function formatHoursOnly(hours: number): string {
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
export function weeksSuffix(hours: number): string {
  const weekHours = timeMode.business ? 5 * timeMode.dayHours : 7 * 24;

  if (hours < weekHours) {
    return '';
  }

  return ` (${(hours / weekHours).toFixed(1)} weeks)`;
}

/**
 * Formats a count with a k suffix from one thousand upward so the chart axis
 * labels stay short.
 */
export function formatCount(value: number): string {
  if (value < 1000) {
    return String(value);
  }

  const scaled = value / 1000;

  return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)}k`;
}
