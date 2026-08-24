import chalk from 'chalk';
import { parseArgs } from 'node:util';
import { timeMode } from './time.mjs';
import { fail, formatMinutesOfDay } from './utils.mjs';

const flag = chalk.green;
const value = chalk.cyan;
const dim = chalk.dim;

/**
 * Declares every flag once. Each entry feeds both the parseArgs config and
 * the rendered help page, so adding a flag only takes a new entry here. The
 * help text is plain prose with a light markup that colorizeHelp expands,
 * and renderHelp handles the column alignment and line wrapping.
 */
const OPTIONS = [
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
    name: 'reports',
    type: 'string',
    default: 'review-time,size',
    placeholder: '<list>',
    help: 'Choose which reports to print as a comma-separated list. Accepts `review-time` (how fast you finish review requests) and `size` (how large your authored PRs are). Both print by default.',
  },
  {
    name: 'target',
    short: 't',
    type: 'string',
    placeholder: '<value>',
    help: 'Report how many reviews finished within this time. Accepts hours (`24h` or plain `24`), minutes (`90m`), or days (`2d`). A day means 24 counted hours, or one working day when --work-hours is set. Open PRs that have already waited longer than the target count as misses.',
  },
  {
    name: 'size-target',
    type: 'string',
    placeholder: '<v>',
    help: 'Report how many authored PRs fit within this size. Accepts a line budget (`400` or `400l`), a file budget (`20f`), or both (`400l,20f`). Lines count additions plus deletions.',
  },
  {
    name: 'charts',
    short: 'c',
    type: 'string',
    default: 'histogram,strip,spark',
    placeholder: '<list>',
    help: 'Choose which size charts to print as a comma-separated list. Accepts `histogram` (size distribution bars), `strip` (a quantile strip per metric), and `spark` (a size line chart over time). All three print by default. Pass `none` to print no charts.',
  },
  {
    name: 'tz',
    type: 'string',
    placeholder: '<zone>',
    help: 'IANA timezone for the weekend and working-hours math, for example `Europe/Berlin`. Defaults to your system timezone.',
  },
  {
    name: 'work-hours',
    short: 'w',
    type: 'string',
    default: '0-24',
    placeholder: '<v>',
    help: 'Count only these working hours instead of full weekdays. Accepts one range like `9-17` or `8:30-16:30`, or several comma-separated ranges like `9-18,19:30-20:30`. Without this flag, every hour Mon-Fri counts.',
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
    name: 'help',
    short: 'h',
    type: 'boolean',
    default: false,
    help: 'Show this help.',
  },
];

/**
 * Keeps every rendered help line within the terminal width. The fallback of
 * 80 columns applies when the width is unknown, for example when the output
 * is piped, and the cap of 120 keeps lines readable on very wide terminals.
 */
const HELP_WIDTH = Math.min(process.stdout.columns ?? 80, 120);

/**
 * Expands the help markup into colors. Backtick spans print cyan because
 * they are literal values you can type, double-quoted spans print yellow,
 * and flag references like --work-hours print green.
 */
function colorizeHelp(text) {
  return text
    .replaceAll(/`([^`]+)`/g, (match, span) => value(span))
    .replaceAll(/"[^"]*"/g, (span) => chalk.yellow(span))
    .replaceAll(/--[a-z][a-z-]*/g, (span) => flag(span));
}

/**
 * Wraps marked-up help text on spaces so each rendered line stays within
 * the given width. Backtick markers vanish when the text renders, so they
 * do not count toward the width.
 */
function wrapMarkup(text, width) {
  const lines = [];

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
function renderHelp() {
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

export function parseCliArgs() {
  const options = {};

  for (const option of OPTIONS) {
    options[option.name] = { type: option.type };

    if (option.short) {
      options[option.name].short = option.short;
    }

    if (option.multiple) {
      options[option.name].multiple = true;
    }

    if (option.default !== undefined) {
      options[option.name].default = option.default;
    }
  }

  const { values } = parseArgs({ options });

  return values;
}

export function parseSince(value) {
  const relative = /^(\d+)([dwmy])$/.exec(value);

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

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    fail(`invalid --since value "${value}", use an ISO date or 30d/8w/6m/1y`);
  }

  return date;
}

/**
 * Parses a --target value into counted hours. A day suffix scales with the
 * working-day length, so call this only after the time mode is configured.
 */
export function parseTarget(value) {
  const match = /^(\d+(?:\.\d+)?)([hdm]?)$/.exec(value);

  if (!match) {
    fail(`invalid --target value "${value}", use 24h, 2d, or 90m`);
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
 * Parses a --size-target value like "400", "400l", "20f", or "400l,20f".
 * A bare number or an l suffix sets the line budget, which counts additions
 * plus deletions. An f suffix sets the file budget.
 */
export function parseSizeTarget(value) {
  const target = {};

  for (const part of value.split(',')) {
    const match = /^(\d+)([lf]?)$/.exec(part.trim());

    if (!match) {
      fail(`invalid --size-target value "${value}", use 400, 400l, 20f, or 400l,20f`);
    }

    const key = match[2] === 'f' ? 'files' : 'lines';

    if (target[key] !== undefined) {
      fail(`--size-target sets the ${key} budget twice`);
    }

    target[key] = Number(match[1]);
  }

  return target;
}

/**
 * Parses the --reports value into a Set of report names. Accepts a
 * comma-separated list of review-time and size. At least one report must
 * remain, because running none of them would print nothing.
 */
export function parseReports(value) {
  const names = new Set(['review-time', 'size']);

  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  const reports = new Set();

  for (const part of parts) {
    if (!names.has(part)) {
      fail(
        `invalid ${flag('--reports')} value "${part}", use a comma-separated list of ${value('review-time')} and ${value('size')}`,
      );
    }

    reports.add(part);
  }

  if (reports.size === 0) {
    fail(`--reports needs at least one of ${value('review-time')} and ${value('size')}`);
  }

  return reports;
}

/**
 * Parses the --charts value into a Set of chart names. Accepts a
 * comma-separated list of histogram, strip, and spark, or none to disable
 * every chart.
 */
export function parseCharts(value) {
  const aliases = {
    histogram: 'histogram',
    hist: 'histogram',
    strip: 'strip',
    spark: 'spark',
    sparkline: 'spark',
  };

  const parts = value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');

  if (parts.length === 1 && parts[0] === 'none') {
    return new Set();
  }

  const charts = new Set();

  for (const part of parts) {
    const name = aliases[part];

    if (name === undefined) {
      fail(`invalid --charts value "${part}", use a comma-separated list of histogram, strip, spark, or none`);
    }

    charts.add(name);
  }

  return charts;
}

/**
 * Parses one or more comma-separated working windows, for example "9-17" or
 * "9-18,19:30-20:30". Returns the windows sorted by start time.
 */
export function parseWorkHours(value) {
  const windows = value.split(',').map((range) => {
    const match = /^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?$/.exec(range.trim());

    if (!match) {
      fail(`invalid --work-hours range "${range}", use ranges like 9-17, 8:30-16:30, or 9-18,19:30-20:30`);
    }

    const startMin = Number(match[1]) * 60 + Number(match[2] ?? 0);
    const endMin = Number(match[3]) * 60 + Number(match[4] ?? 0);

    if (endMin <= startMin || endMin > 24 * 60 || Number(match[2] ?? 0) > 59 || Number(match[4] ?? 0) > 59) {
      fail(`invalid --work-hours range "${range}"`);
    }

    return { startMin, endMin };
  });

  windows.sort((a, b) => a.startMin - b.startMin);

  for (let i = 1; i < windows.length; i++) {
    if (windows[i].startMin < windows[i - 1].endMin) {
      fail(`--work-hours ranges overlap around ${formatMinutesOfDay(windows[i].startMin)}`);
    }
  }

  return windows;
}

/**
 * Resolves the --tz value, falling back to the system timezone, and rejects
 * zones that Intl does not recognize.
 */
export function resolveTimezone(value) {
  const tz = value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    fail(`invalid --tz value "${tz}", use an IANA zone like Europe/Berlin`);
  }

  return tz;
}
