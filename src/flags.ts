import chalk from 'chalk';
import { parseArgs } from 'node:util';
import { timeMode, type WorkWindow } from './time';
import { CliError, formatMinutesOfDay } from './utils';

const flag = chalk.green;
const value = chalk.cyan;
const dim = chalk.dim;

interface OptionSpec {
  name: string;
  short?: string;
  type: 'string' | 'boolean';
  multiple?: boolean;
  default?: string | boolean | string[];
  placeholder?: string;
  help: string;
}

export interface CliValues {
  since: string;
  repo: string[];
  user?: string;
  token?: string;
  target?: string;
  'target-percentile'?: string;
  'size-target'?: string;
  tz?: string;
  'work-days': string;
  'work-hours': string;
  'wall-clock': boolean;
  'include-drafts': boolean;
  'review-types'?: string;
  'no-cache': boolean;
  json: boolean;
  debug?: string;
  help: boolean;
}

export interface SizeTarget {
  lines?: number;
  files?: number;
}

/**
 * Declares every flag once. Each entry feeds both the parseArgs config and
 * the rendered help page, so adding a flag only takes a new entry here. The
 * help text is plain prose with a light markup that colorizeHelp expands,
 * and renderHelp handles the column alignment and line wrapping.
 */
const OPTIONS: OptionSpec[] = [
  {
    name: 'since',
    short: 's',
    type: 'string',
    default: '90d',
    placeholder: '<value>',
    help: 'Only include PRs created after this point. Accepts an ISO date (`2026-01-01`) or a relative value (`30d`, `8w`, `6m`, `1y`). The default is `90d`.',
  },
  {
    name: 'repo',
    short: 'r',
    type: 'string',
    multiple: true,
    default: [],
    placeholder: '<name>',
    help: 'Restrict the search to a repository. Repeat the flag for multiple repositories. Accepts "owner/name" or a bare name, which resolves against the owner of the repo in the current directory. Without this flag, all repositories you have access to are searched.',
  },
  {
    name: 'user',
    short: 'u',
    type: 'string',
    placeholder: '<login>',
    help: 'Compute stats for this user. Defaults to the authenticated user.',
  },
  {
    name: 'token',
    type: 'string',
    placeholder: '<token>',
    help: 'GitHub access token. When set, the tool calls the GitHub API directly instead of going through the gh CLI. The `GITHUB_TOKEN` and `GH_TOKEN` environment variables work as well.',
  },
  {
    name: 'target',
    short: 't',
    type: 'string',
    placeholder: '<value>',
    help: 'Report how many reviews finished within this time. Accepts hours (`24h` or plain `24`), minutes (`90m`), or days (`2d`). A day means 24 counted hours, or one working day when --work-hours is set. Open PRs that have already waited longer than the target count as misses.',
  },
  {
    name: 'target-percentile',
    type: 'string',
    placeholder: '<p>',
    help: 'Check the --target against this percentile of your review times. Accepts a whole percentile from 1 to 100, with an optional p prefix (`90` or `p90`). The default is `90`, so the review headline reports whether your p90 review time meets the target.',
  },
  {
    name: 'size-target',
    type: 'string',
    placeholder: '<v>',
    help: 'Report how many authored PRs fit within this size. Accepts a line budget (`400` or `400l`), a file budget (`20f`), or both (`400l,20f`). Lines count additions plus deletions.',
  },
  {
    name: 'tz',
    type: 'string',
    placeholder: '<zone>',
    help: 'IANA timezone for the weekend and working-hours math, for example `Europe/Berlin`. Defaults to your system timezone.',
  },
  {
    name: 'work-days',
    type: 'string',
    default: 'mon-fri',
    placeholder: '<days>',
    help: 'Count only these days as working days. Accepts comma-separated weekday names and ranges like `mon-fri`, `sun-thu`, or `mon,wed,fri`. A range may wrap around the end of the week, so `sat-wed` works too. Days outside the set count as weekend.',
  },
  {
    name: 'work-hours',
    short: 'w',
    type: 'string',
    default: '0-24',
    placeholder: '<v>',
    help: 'Count only these working hours instead of full working days. Accepts 24-hour ranges like `9-17` or `8:30-16:30`, 12-hour ranges like `9am-6pm` or `8:30am-4:30pm`, or several comma-separated ranges like `9-18,19:30-20:30`. Without this flag, every hour on a working day counts.',
  },
  {
    name: 'wall-clock',
    type: 'boolean',
    default: false,
    help: 'Measure raw elapsed time, including weekends.',
  },
  {
    name: 'include-drafts',
    type: 'boolean',
    default: false,
    help: 'Include PRs that are currently drafts. Excluded by default.',
  },
  {
    name: 'review-types',
    type: 'string',
    placeholder: '<list>',
    help: 'Count only these review types as a review. Accepts a comma-separated list of `approve`, `comment`, and `request-changes`, for example `approve,request-changes`. A review of another type never answers a request, so the PR stays in the awaiting queue until a counted review lands. Without this flag, every submitted review counts.',
  },
  {
    name: 'no-cache',
    type: 'boolean',
    default: false,
    help: 'Refetch every PR instead of reading the local disk cache. Closed PRs are normally served from a per-PR cache because their timelines and sizes no longer change. Fresh results still update the cache. The TUI settings dialog can save this behavior for every run, and the flag wins over the saved setting.',
  },
  {
    name: 'json',
    type: 'boolean',
    default: false,
    help: 'Print every stat as JSON to stdout instead of starting the TUI, so the output can be piped into jq or redirected to a file. The report holds the review, size, merge, reviewer, and comment stats with one entry per PR, and every other flag applies to it the same way. Progress renders on stderr, so a piped stdout stays pure JSON.',
  },
  {
    name: 'debug',
    type: 'string',
    placeholder: '<path>',
    help: 'Serve canned data from a fake gh binary instead of fetching from GitHub. Accepts a path to a testdata directory that contains a `gh` executable, for example `tui/testdata`, or a path to the executable itself. Tokens are ignored while this flag is set. This is useful for testing and local development.',
  },
  {
    name: 'help',
    short: 'h',
    type: 'boolean',
    default: false,
    help: 'Show this help.',
  },
];

/**
 * Keeps every rendered help line within the terminal width. The fallback of
 * 80 columns applies when stdout is not a terminal, for example when the
 * output is piped, and the cap of 120 keeps lines readable on very wide
 * terminals.
 */
const HELP_WIDTH = Math.min(process.stdout.isTTY ? process.stdout.columns : 80, 120);

/**
 * Expands the help markup into colors. Backtick spans print cyan because
 * they are literal values you can type, double-quoted spans print yellow,
 * and flag references like --work-hours print green.
 */
function colorizeHelp(text: string): string {
  return text
    .replaceAll(/`([^`]+)`/g, (match, span: string) => value(span))
    .replaceAll(/"[^"]*"/g, (span) => chalk.yellow(span))
    .replaceAll(/--[a-z][a-z-]*/g, (span) => flag(span));
}

/**
 * Wraps marked-up help text on spaces so each rendered line stays within
 * the given width. Backtick markers vanish when the text renders, so they
 * do not count toward the width.
 */
function wrapMarkup(text: string, width: number): string[] {
  const lines: string[] = [];

  let line = '';

  for (const word of text.split(' ')) {
    const candidate = line === '' ? word : `${line} ${word}`;

    if (line !== '' && candidate.replaceAll('`', '').length > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line !== '') {
    lines.push(line);
  }

  return lines;
}

/**
 * Renders the full help page from OPTIONS. The description column sits two
 * spaces past the widest flag label, so alignment never needs hand-tuning.
 */
function renderHelp(): string {
  const labels = OPTIONS.map((option) => {
    const short = option.short ? `-${option.short}, ` : '';
    const long = option.placeholder ? `--${option.name} ${option.placeholder}` : `--${option.name}`;

    return short + long;
  });

  const column = Math.max(...labels.map((label) => label.length)) + 4;

  const lines = [`${chalk.bold('Usage:')} ${chalk.bold('pr-stats')} ${dim('[options]')}`, '', chalk.bold('Options:')];

  for (const [index, option] of OPTIONS.entries()) {
    const short = option.short ? `${flag(`-${option.short}`)}, ` : '';

    const long = option.placeholder
      ? `${flag(`--${option.name}`)} ${dim(option.placeholder)}`
      : flag(`--${option.name}`);

    const body = wrapMarkup(option.help, HELP_WIDTH - column).map((line) => colorizeHelp(line));

    lines.push(`  ${short}${long}${' '.repeat(column - 2 - labels[index].length)}${body[0]}`);

    for (const overflow of body.slice(1)) {
      lines.push(' '.repeat(column) + overflow);
    }
  }

  return lines.join('\n');
}

export const HELP = renderHelp();

export interface ParsedArgs {
  values: CliValues;
  /**
   * Holds the names of the flags that were actually given on the command
   * line, as opposed to filled in from the defaults. Saved options only
   * replace defaulted values, so the merge needs the distinction.
   */
  explicit: Set<string>;
}

/**
 * Parses the command line into CliValues plus the set of flags that were
 * explicitly given. The parse runs without the defaults so a present key
 * means the flag was on the command line, and the defaults get filled in
 * afterwards. The args parameter overrides process.argv for tests.
 */
export function parseCliArgs(args?: string[]): ParsedArgs {
  const options: Record<string, { type: 'string' | 'boolean'; short?: string; multiple?: boolean }> = {};

  for (const option of OPTIONS) {
    options[option.name] = { type: option.type };

    if (option.short) {
      options[option.name].short = option.short;
    }

    if (option.multiple) {
      options[option.name].multiple = true;
    }
  }

  const { values } = parseArgs({ options, args });

  const explicit = new Set(Object.keys(values));

  for (const option of OPTIONS) {
    if (option.default !== undefined && values[option.name] === undefined) {
      values[option.name] = option.default;
    }
  }

  /**
   * The config is built dynamically, so parseArgs cannot infer the value
   * types and returns a loose index signature. CliValues restates what the
   * OPTIONS table guarantees.
   */
  return { values: values as unknown as CliValues, explicit };
}

export function parseSince(input: string): Date {
  const relative = /^(\d+)([dwmy])$/.exec(input);

  if (relative) {
    const amount = Number(relative[1]);
    const date = new Date();

    if (relative[2] === 'd') {
      date.setDate(date.getDate() - amount);
    }

    if (relative[2] === 'w') {
      date.setDate(date.getDate() - amount * 7);
    }

    if (relative[2] === 'm') {
      date.setMonth(date.getMonth() - amount);
    }

    if (relative[2] === 'y') {
      date.setFullYear(date.getFullYear() - amount);
    }

    return date;
  }

  const date = new Date(input);

  if (Number.isNaN(date.getTime())) {
    throw new CliError(`invalid --since value "${input}", use an ISO date or 30d/8w/6m/1y`);
  }

  return date;
}

/**
 * Parses a --target value into counted hours. A day suffix scales with the
 * working-day length, so call this only after the time mode is configured.
 */
export function parseTarget(input: string): number {
  const match = /^(\d+(?:\.\d+)?)([hdm]?)$/.exec(input);

  if (!match) {
    throw new CliError(`invalid --target value "${input}", use 24h, 2d, or 90m`);
  }

  const amount = Number(match[1]);

  if (match[2] === 'd') {
    return amount * timeMode.dayHours;
  }

  if (match[2] === 'm') {
    return amount / 60;
  }

  return amount;
}

/**
 * The percentile the review target checks while --target-percentile is
 * not given.
 */
export const DEFAULT_TARGET_PERCENTILE = 90;

/**
 * Parses a --target-percentile value like "90" or "p99" into the
 * percentile of the review times the review target checks.
 */
export function parseTargetPercentile(input: string): number {
  const match = /^p?(\d{1,3})$/i.exec(input);
  const value = match === null ? Number.NaN : Number(match[1]);

  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new CliError(`invalid --target-percentile value "${input}", use a percentile from 1 to 100 like 90 or p90`);
  }

  return value;
}

/**
 * Parses a --size-target value like "400", "400l", "20f", or "400l,20f".
 * A bare number or an l suffix sets the line budget, which counts additions
 * plus deletions. An f suffix sets the file budget.
 */
export function parseSizeTarget(input: string): SizeTarget {
  const target: SizeTarget = {};

  for (const part of input.split(',')) {
    const match = /^(\d+)([lf]?)$/.exec(part.trim());

    if (!match) {
      throw new CliError(`invalid --size-target value "${input}", use 400, 400l, 20f, or 400l,20f`);
    }

    const key = match[2] === 'f' ? 'files' : 'lines';

    if (target[key] !== undefined) {
      throw new CliError(`--size-target sets the ${key} budget twice`);
    }

    target[key] = Number(match[1]);
  }

  return target;
}

/**
 * Maps the --review-types tokens onto the GitHub review states the
 * classification compares against.
 */
const REVIEW_TYPES = new Map([
  ['approve', 'APPROVED'],
  ['comment', 'COMMENTED'],
  ['request-changes', 'CHANGES_REQUESTED'],
]);

/**
 * Parses a --review-types value like "approve,request-changes" into
 * the set of GitHub review states that count as a review.
 */
export function parseReviewTypes(input: string): Set<string> {
  const states = new Set<string>();

  for (const part of input.split(',')) {
    const state = REVIEW_TYPES.get(part.trim().toLowerCase());

    if (state === undefined) {
      throw new CliError(`invalid --review-types value "${part.trim()}", use approve, comment, or request-changes`);
    }

    states.add(state);
  }

  return states;
}

/**
 * Converts one side of a --work-hours range into minutes since midnight.
 * Hours with an am or pm suffix follow the 12-hour clock, so 12am maps to
 * midnight and 12pm maps to noon. Returns null when the hour or minute is
 * out of range.
 */
function toMinutesOfDay(hourText: string, minuteText: string | undefined, meridiem: string | undefined): number | null {
  const minute = Number(minuteText ?? 0);

  if (minute > 59) {
    return null;
  }

  let hour = Number(hourText);

  if (meridiem !== undefined) {
    if (hour < 1 || hour > 12) {
      return null;
    }

    hour %= 12;

    if (meridiem.toLowerCase() === 'pm') {
      hour += 12;
    }
  }

  return hour * 60 + minute;
}

/**
 * The weekday names a --work-days value uses, indexed by the weekday
 * numbers Date#getUTCDay returns.
 */
const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * The display capitalization of the weekday names, indexed the same way.
 */
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Parses a --work-days value like "mon-fri" or "mon,wed,fri" into the set
 * of weekday numbers that count as working days. Each comma-separated
 * part is a weekday name or an inclusive range of two, and a range may
 * wrap around the end of the week, so "sat-wed" covers Saturday through
 * Wednesday.
 */
export function parseWorkDays(input: string): Set<number> {
  const days = new Set<number>();

  for (const part of input.split(',')) {
    const match = /^([a-z]{3})(?:-([a-z]{3}))?$/i.exec(part.trim());
    const endName = match?.[2];
    const start = match === null ? -1 : WEEKDAY_NAMES.indexOf(match[1].toLowerCase());
    const end = match === null ? -1 : endName === undefined ? start : WEEKDAY_NAMES.indexOf(endName.toLowerCase());

    if (start === -1 || end === -1) {
      throw new CliError(
        `invalid --work-days value "${part.trim()}", use weekday names and ranges like mon-fri, sun-thu, or mon,wed,fri`,
      );
    }

    for (let day = start; ; day = (day + 1) % 7) {
      days.add(day);

      if (day === end) {
        break;
      }
    }
  }

  return days;
}

function workDayRunLabel(start: number, end: number): string {
  return start === end ? WEEKDAY_LABELS[start] : `${WEEKDAY_LABELS[start]}-${WEEKDAY_LABELS[end]}`;
}

/**
 * Formats a set of working days into the compact form the header and the
 * options dialog display. Contiguous days collapse into ranges that may
 * wrap around the end of the week, single days list out, and the full
 * week formats as Mon-Sun, so a set like Monday through Wednesday plus
 * Friday comes out as "Mon-Wed,Fri".
 */
export function formatWorkDays(days: Set<number>): string {
  if (days.size === 7) {
    return 'Mon-Sun';
  }

  /**
   * Scanning Monday first finds a day whose predecessor is off, which
   * anchors the walk at a run start, so a week that wraps around its
   * end formats from the natural start, like Sun-Thu. A non-full set
   * always has such a day, and the walk then ends on the off day right
   * before the anchor, which closes the last run inside the loop.
   */
  const monFirst = [1, 2, 3, 4, 5, 6, 0];
  const anchor = monFirst.find((day) => days.has(day) && !days.has((day + 6) % 7)) ?? 1;

  const runs: string[] = [];

  let runStart = -1;
  let runEnd = -1;

  for (let step = 0; step < 7; step++) {
    const day = (anchor + step) % 7;

    if (days.has(day)) {
      runStart = runStart === -1 ? day : runStart;
      runEnd = day;
    } else if (runStart !== -1) {
      runs.push(workDayRunLabel(runStart, runEnd));
      runStart = -1;
    }
  }

  return runs.join(',');
}

/**
 * Validates a --work-days value and normalizes it into the compact
 * capitalized form the header and the options dialog display.
 */
export function canonicalWorkDays(input: string): string {
  return formatWorkDays(parseWorkDays(input));
}

/**
 * Parses one or more comma-separated working windows, for example "9-17",
 * "9am-6pm", or "9-18,19:30-20:30". Returns the windows sorted by start
 * time.
 */
export function parseWorkHours(input: string): WorkWindow[] {
  const windows = input.split(',').map((range) => {
    const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?-(\d{1,2})(?::(\d{2}))?(am|pm)?$/i.exec(range.trim());

    if (!match) {
      throw new CliError(
        `invalid --work-hours range "${range}", use ranges like 9-17, 9am-6pm, 8:30-16:30, or 9-18,19:30-20:30`,
      );
    }

    const startMin = toMinutesOfDay(match[1], match[2], match[3]);
    const end = toMinutesOfDay(match[4], match[5], match[6]);

    // midnight as an end means the end of the day, so 9pm-12am works
    const endMin = end === 0 ? 24 * 60 : end;

    if (startMin === null || endMin === null || endMin <= startMin || endMin > 24 * 60) {
      throw new CliError(`invalid --work-hours range "${range}"`);
    }

    return { startMin, endMin };
  });

  windows.sort((a, b) => a.startMin - b.startMin);

  for (let i = 1; i < windows.length; i++) {
    if (windows[i].startMin < windows[i - 1].endMin) {
      throw new CliError(`--work-hours ranges overlap around ${formatMinutesOfDay(windows[i].startMin)}`);
    }
  }

  return windows;
}

/**
 * Resolves the --tz value, falling back to the system timezone, and rejects
 * zones that Intl does not recognize.
 */
export function resolveTimezone(input?: string): string {
  const tz = input ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new CliError(`invalid --tz value "${tz}", use an IANA zone like Europe/Berlin`);
  }

  return tz;
}
