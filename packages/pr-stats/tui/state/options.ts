import { readCacheFile, writeCacheFile } from '../../cache';
import { parseSince, parseSizeTarget, parseTarget, parseWorkHours, resolveTimezone, type CliValues } from '../../flags';
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
  sizeTarget: string;
  workHours: string;
  tz: string;
  wallClock: boolean;
  includeDrafts: boolean;
}

export interface FieldSpec {
  key: keyof OptionsState;
  label: string;
  hint: string;
  kind: 'text' | 'toggle';
  /**
   * Marks options that change what GitHub returns. Editing one of these
   * requires a reload, while the others recompute instantly from the cached
   * data.
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
    key: 'target',
    label: 'Review target',
    hint: '24h, 2d, or 90m, empty disables the target gauge',
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
 * Validates a single text field by running the matching CLI parser, which
 * throws a CliError with a readable message on bad input.
 */
export function validateField(key: keyof OptionsState, value: string): void {
  if (value === '' && key !== 'workHours' && key !== 'since') {
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
    case 'sizeTarget': {
      parseSizeTarget(value);

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

  if (!explicit.has('size-target') && saved.sizeTarget !== '') {
    values['size-target'] = saved.sizeTarget;
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

  return saved;
}

/**
 * The subset of the options that changes what GitHub returns, which is all
 * the fetch pipeline needs to know.
 */
export type FetchParams = Pick<OptionsState, 'since' | 'repos' | 'user' | 'includeDrafts'>;

/**
 * Serializes the options that require a refetch when they change. Comparing
 * two of these strings tells whether the cached data is stale, and the
 * startup snapshot uses it as its cache key.
 */
export function fetchParamsKey(options: FetchParams): string {
  return JSON.stringify([options.since, options.repos, options.user, options.includeDrafts]);
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
