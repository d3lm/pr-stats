import { readCacheFile, writeCacheFile } from '../../cache';
import {
  formatWorkDays,
  parseReviewTypes,
  parseSince,
  parseSizeTarget,
  parseTarget,
  parseTargetPercentile,
  parseWorkDays,
  parseWorkHours,
  resolveTimezone,
  type CliValues,
} from '../../flags';
import { CliError } from '../../utils';

/**
 * Holds every configurable option as the user typed it. Empty strings mean
 * the option is unset, mirroring how the CLI treats an absent flag.
 */
export interface OptionsState {
  since: string;
  repos: string;
  user: string;
  target: string;
  targetPercentile: string;
  sizeTarget: string;
  workDays: string;
  workHours: string;
  tz: string;
  wallClock: boolean;
  includeDrafts: boolean;
  reviewTypes: string;
}

export interface FieldSpec {
  key: keyof OptionsState;
  label: string;
  hint: string;
  /**
   * Picks the row's editor. A text field opens an inline input, a toggle
   * flips in place, and a multi field opens the checklist dropdown that
   * toggles one value per row.
   */
  kind: 'text' | 'toggle' | 'multi';
  /**
   * Marks options that need a reload to apply, because they change what
   * GitHub returns or how the fetched timelines classify. The others
   * recompute instantly from the cached data.
   */
  fetch: boolean;
}

export const FIELDS: FieldSpec[] = [
  {
    key: 'since',
    label: 'Since',
    hint: 'ISO date or a relative value like 30d, 8w, 6m, 1y',
    kind: 'text',
    fetch: true,
  },
  {
    key: 'repos',
    label: 'Repositories',
    hint: 'comma-separated owner/name, empty searches all accessible repos',
    kind: 'text',
    fetch: true,
  },
  {
    key: 'user',
    label: 'User',
    hint: 'GitHub login, empty uses the authenticated user',
    kind: 'text',
    fetch: true,
  },
  {
    key: 'includeDrafts',
    label: 'Include drafts',
    hint: 'include PRs that are currently drafts',
    kind: 'toggle',
    fetch: true,
  },
  {
    key: 'reviewTypes',
    label: 'Review types',
    hint: 'enter opens the type list, checked types count as a review',
    kind: 'multi',
    fetch: true,
  },
  {
    key: 'target',
    label: 'Review target',
    hint: '24h, 2d, or 90m, empty disables the target gauge',
    kind: 'text',
    fetch: false,
  },
  {
    key: 'targetPercentile',
    label: 'Target percentile',
    hint: 'the percentile the review target checks, like 90 or p99, empty means p90',
    kind: 'text',
    fetch: false,
  },
  {
    key: 'sizeTarget',
    label: 'Size target',
    hint: '400, 400l, 20f, or 400l,20f, empty disables the gauge',
    kind: 'text',
    fetch: false,
  },
  {
    key: 'workDays',
    label: 'Work days',
    hint: 'enter opens the day list, checked days count as working days',
    kind: 'multi',
    fetch: false,
  },
  {
    key: 'workHours',
    label: 'Work hours',
    hint: 'ranges like 9-17 or 8:30-16:30,19-20, 0-24 counts every hour',
    kind: 'text',
    fetch: false,
  },
  {
    key: 'tz',
    label: 'Timezone',
    hint: 'IANA zone like Europe/Berlin, empty uses the system zone',
    kind: 'text',
    fetch: false,
  },
  {
    key: 'wallClock',
    label: 'Wall clock',
    hint: 'measure raw elapsed time including weekends',
    kind: 'toggle',
    fetch: false,
  },
];

/**
 * The review types the checklist dropdown lists, in the canonical order
 * the reviewTypes value serializes in.
 */
export const REVIEW_TYPE_CHOICES = ['approve', 'comment', 'request-changes'] as const;

/**
 * The days the work-days checklist lists, in the Monday-first order the
 * workDays value serializes in.
 */
export const WORK_DAY_CHOICES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * Expands a workDays value into the set of checked day labels, so the
 * checklist renders a compact value like "Mon-Fri" as one checkbox per
 * day.
 */
export function checkedWorkDays(value: string): Set<string> {
  return new Set([...parseWorkDays(value)].map((day) => WORK_DAY_CHOICES[(day + 6) % 7]));
}

/**
 * Flips one day in the workDays value and returns the new value in the
 * compact canonical form, so a toggle reformats the ranges on the fly.
 * The last checked day never unchecks, because a week without working
 * days would count no time at all.
 */
export function toggleWorkDay(value: string, day: string): string {
  const days = parseWorkDays(value);
  const number = (WORK_DAY_CHOICES.indexOf(day as (typeof WORK_DAY_CHOICES)[number]) + 1) % 7;

  if (days.has(number)) {
    days.delete(number);
  } else {
    days.add(number);
  }

  if (days.size === 0) {
    return value;
  }

  return formatWorkDays(days);
}

/**
 * Expands a reviewTypes value into the set of checked types. The empty
 * value means every submitted review counts, so it expands to the full
 * set. Tokens normalize the way the CLI parser does, so a value typed
 * with spaces or capitals checks the same boxes.
 */
export function checkedReviewTypes(value: string): Set<string> {
  if (value.trim() === '') {
    return new Set(REVIEW_TYPE_CHOICES);
  }

  return new Set(value.split(',').map((part) => part.trim().toLowerCase()));
}

/**
 * Flips one review type in the comma-separated reviewTypes value and
 * returns the new value in canonical order. A full selection collapses
 * back to the empty value, which counts every submitted review, and the
 * last checked type never unchecks, because a filter that counts nothing
 * would keep every PR pending forever.
 */
export function toggleReviewType(value: string, type: string): string {
  const checked = checkedReviewTypes(value);

  if (checked.has(type)) {
    checked.delete(type);
  } else {
    checked.add(type);
  }

  const next = REVIEW_TYPE_CHOICES.filter((choice) => checked.has(choice));

  if (next.length === 0) {
    return value;
  }

  return next.length === REVIEW_TYPE_CHOICES.length ? '' : next.join(',');
}

/**
 * Validates a single text field by running the matching CLI parser, which
 * throws a CliError with a readable message on bad input.
 */
export function validateField(key: keyof OptionsState, value: string): void {
  if (value === '' && key !== 'workHours' && key !== 'workDays' && key !== 'since') {
    return;
  }

  switch (key) {
    case 'since': {
      parseSince(value);

      break;
    }
    case 'target': {
      parseTarget(value);

      break;
    }
    case 'targetPercentile': {
      parseTargetPercentile(value);

      break;
    }
    case 'sizeTarget': {
      parseSizeTarget(value);

      break;
    }
    case 'workDays': {
      parseWorkDays(value);

      break;
    }
    case 'workHours': {
      parseWorkHours(value);

      break;
    }
    case 'tz': {
      resolveTimezone(value);

      break;
    }
    case 'reviewTypes': {
      parseReviewTypes(value);

      break;
    }
  }
}

/**
 * Reports whether two option states hold the same values, field by field.
 * The options modal compares the live options against the saved ones to
 * label its save state.
 */
export function sameOptions(a: OptionsState, b: OptionsState): boolean {
  return FIELDS.every((field) => a[field.key] === b[field.key]);
}

/**
 * Reads the saved options from the cache directory. Returns null while the
 * cache is disabled, when nothing was saved, and when the stored file
 * fails the shape or value checks, so a stale or hand-edited save never
 * reaches the app.
 */
export function readSavedOptions(): OptionsState | null {
  const value = readCacheFile('options');

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  /**
   * Saves written before the review-types, target-percentile, and
   * work-days fields existed lack those keys, so they default to their
   * unset values instead of discarding the whole save.
   */
  record.reviewTypes ??= '';
  record.targetPercentile ??= '';
  record.workDays ??= 'Mon-Fri';

  const options = {} as OptionsState;

  for (const field of FIELDS) {
    const raw = record[field.key];

    if (typeof raw !== (field.kind === 'toggle' ? 'boolean' : 'string')) {
      return null;
    }

    (options as unknown as Record<string, unknown>)[field.key] = raw;
  }

  try {
    for (const field of FIELDS) {
      const raw = options[field.key];

      if (typeof raw === 'string') {
        validateField(field.key, raw);
      }
    }
  } catch (error) {
    if (error instanceof CliError) {
      return null;
    }

    throw error;
  }

  return options;
}

/**
 * Persists the given options to the cache directory, so later runs start
 * from them where no flag overrides them. Returns false while the cache
 * is disabled, which keeps debug runs from writing preferences.
 */
export function writeSavedOptions(options: OptionsState): boolean {
  return writeCacheFile('options', options);
}

/**
 * Merges the saved options into freshly parsed CLI values. Only flags that
 * were not given on the command line take the saved value, so explicit
 * flags always win. Returns the saved options when a valid save exists,
 * and null otherwise. Call this after configureCache, because a disabled
 * cache reads no save.
 */
export function applySavedOptions(values: CliValues, explicit: Set<string>): OptionsState | null {
  const saved = readSavedOptions();

  if (saved === null) {
    return null;
  }

  if (!explicit.has('since')) {
    values.since = saved.since;
  }

  if (!explicit.has('repo')) {
    values.repo = saved.repos
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '');
  }

  if (!explicit.has('user') && saved.user !== '') {
    values.user = saved.user;
  }

  if (!explicit.has('target') && saved.target !== '') {
    values.target = saved.target;
  }

  if (!explicit.has('target-percentile') && saved.targetPercentile !== '') {
    values['target-percentile'] = saved.targetPercentile;
  }

  if (!explicit.has('size-target') && saved.sizeTarget !== '') {
    values['size-target'] = saved.sizeTarget;
  }

  if (!explicit.has('work-days')) {
    values['work-days'] = saved.workDays;
  }

  if (!explicit.has('work-hours')) {
    values['work-hours'] = saved.workHours;
  }

  if (!explicit.has('tz') && saved.tz !== '') {
    values.tz = saved.tz;
  }

  if (!explicit.has('wall-clock')) {
    values['wall-clock'] = saved.wallClock;
  }

  if (!explicit.has('include-drafts')) {
    values['include-drafts'] = saved.includeDrafts;
  }

  if (!explicit.has('review-types') && saved.reviewTypes !== '') {
    values['review-types'] = saved.reviewTypes;
  }

  return saved;
}

/**
 * The subset of the options a load bakes into its results, the search
 * inputs plus the review-types filter the classification applies, so a
 * change to any of them needs a fresh load.
 */
export type FetchParams = Pick<OptionsState, 'since' | 'repos' | 'user' | 'includeDrafts' | 'reviewTypes'>;

/**
 * Serializes the options that require a refetch when they change. Comparing
 * two of these strings tells whether the cached data is stale, and the
 * startup snapshot uses it as its cache key.
 */
export function fetchParamsKey(options: FetchParams): string {
  return JSON.stringify([options.since, options.repos, options.user, options.includeDrafts, options.reviewTypes]);
}

/**
 * Echoes the target back the way the user gave it. A bare number means
 * hours, so only that form gets a unit added.
 */
export function targetLabelOf(target: string): string | undefined {
  if (target === '') {
    return undefined;
  }

  return target + (/^[\d.]+$/.test(target) ? 'h' : '');
}
