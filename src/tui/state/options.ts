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
import { parseRepoEntries } from '../../repos';
import { CliError } from '../../utils';

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
  kind: 'text' | 'toggle' | 'multi';
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
    hint: 'comma-separated owner/name or owner/*, * matches any text like acme* or acme/web-*, empty searches all',
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

export const REVIEW_TYPE_CHOICES = ['approve', 'comment', 'request-changes'] as const;

export const WORK_DAY_CHOICES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function checkedWorkDays(value: string): Set<string> {
  return new Set([...parseWorkDays(value)].map((day) => WORK_DAY_CHOICES[(day + 6) % 7]));
}

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

export function checkedReviewTypes(value: string): Set<string> {
  if (value.trim() === '') {
    return new Set(REVIEW_TYPE_CHOICES);
  }

  return new Set(value.split(',').map((part) => part.trim().toLowerCase()));
}

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

export function validateField(key: keyof OptionsState, value: string): void {
  if (value === '' && key !== 'workHours' && key !== 'workDays' && key !== 'since') {
    return;
  }

  switch (key) {
    case 'since': {
      parseSince(value);

      break;
    }
    case 'repos': {
      parseRepoEntries(value);

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
    default: {
      break;
    }
  }
}

export function sameOptions(a: OptionsState, b: OptionsState): boolean {
  return FIELDS.every((field) => a[field.key] === b[field.key]);
}

export function readSavedOptions(): OptionsState | null {
  const value = readCacheFile('options');

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  // older saves lack these keys
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

export function writeSavedOptions(options: OptionsState): boolean {
  return writeCacheFile('options', options);
}

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

export type FetchParams = Pick<OptionsState, 'since' | 'repos' | 'user' | 'includeDrafts' | 'reviewTypes'>;

export function fetchParamsKey(options: FetchParams): string {
  return JSON.stringify([options.since, options.repos, options.user, options.includeDrafts, options.reviewTypes]);
}

export function targetLabelOf(target: string): string | undefined {
  if (target === '') {
    return undefined;
  }

  return target + (/^[\d.]+$/.test(target) ? 'h' : '');
}
