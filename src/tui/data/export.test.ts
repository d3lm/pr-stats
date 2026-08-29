import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewResult, SizeEntry } from '../../data';
import { configureTimeMode } from '../../time';
import type { OptionsState } from '../state/options';
import { buildStatsReport, exportStatsFile, type StatsReport } from './export';
import type { RawData } from './load';

const options: OptionsState = {
  since: '2026-06-01',
  repos: '',
  user: '',
  target: '2h',
  sizeTarget: '100l',
  workHours: '0-24',
  tz: 'UTC',
  /**
   * Wall-clock mode keeps the expected durations a plain subtraction, so
   * the fixtures do not need to dodge weekends.
   */
  wallClock: true,
  includeDrafts: false,
  reviewTypes: '',
};

function reviewPr(number: number, state = 'closed') {
  return {
    repo: 'acme/api',
    number,
    title: `pr ${number}`,
    url: `https://example.com/${number}`,
    state,
    createdAt: new Date('2026-06-30T00:00:00Z'),
  };
}

function sizeEntry(number: number, total: number, overrides: Partial<SizeEntry> = {}): SizeEntry {
  return {
    pr: {
      repo: 'acme/api',
      number,
      title: `pr ${number}`,
      url: `https://example.com/${number}`,
      state: 'closed',
      createdAt: new Date('2026-07-01T00:00:00Z'),
    },
    files: 2,
    additions: total,
    deletions: 0,
    total,
    mergedAt: null,
    closedAt: new Date('2026-07-03T00:00:00Z'),
    comments: { discussion: 0, review: 0, total: 0 },
    reviews: [],
    ...overrides,
  };
}

const reviewResults: ReviewResult[] = [
  {
    kind: 'reviewed',
    pr: reviewPr(1),
    requestedAt: new Date('2026-07-01T00:00:00Z'),
    reviewedAt: new Date('2026-07-01T01:00:00Z'),
    verdict: 'APPROVED',
    lines: 50,
  },
  {
    kind: 'reviewed',
    pr: reviewPr(2),
    requestedAt: new Date('2026-07-01T00:00:00Z'),
    reviewedAt: new Date('2026-07-01T04:00:00Z'),
    verdict: 'CHANGES_REQUESTED',
    lines: 200,
  },
  { kind: 'pending', pr: reviewPr(3, 'open'), requestedAt: new Date('2026-07-09T00:00:00Z') },
];

const sizes: SizeEntry[] = [
  sizeEntry(10, 50, {
    mergedAt: new Date('2026-07-02T00:00:00Z'),
    closedAt: new Date('2026-07-02T00:00:00Z'),
    comments: { discussion: 1, review: 2, total: 3 },
    reviews: [{ login: 'alice', submittedAt: new Date('2026-07-01T12:00:00Z') }],
  }),
  sizeEntry(11, 150),
];

const raw: RawData = {
  user: 'me',
  sinceIso: '2026-06-01',
  repos: [],
  reviewResults,
  sizes,
  authoredTotal: 3,
  searchCapped: false,
  fetchedAt: new Date('2026-07-10T00:00:00Z'),
};

/**
 * Puts the shared time mode back to the defaults, so the wall-clock mode
 * these tests configure never leaks into tests that run later.
 */
function restoreTimeMode(): void {
  configureTimeMode({ business: true, workWindows: [{ startMin: 0, endMin: 24 * 60 }], tz: 'UTC' });
}

test('builds the report with durations, targets, and per-PR entries', () => {
  try {
    const report = buildStatsReport(raw, options);

    expect(report.user).toBe('me');
    expect(report.since).toBe('2026-06-01');
    expect(report.options.reviewTarget).toBe('2h');
    expect(report.options.wallClock).toBe(true);
    expect(report.options.reviewTypes).toBeNull();

    expect(report.review.counts).toEqual({
      reviewed: 2,
      pending: 1,
      reviewing: 0,
      closedUnreviewed: 0,
      reviewedUnrequested: 0,
    });

    expect(report.review.reviewTimeHours).toEqual({ count: 2, mean: 2.5, p50: 1, p90: 4, min: 1, max: 4 });
    expect(report.review.verdicts).toEqual({ approved: 1, changesRequested: 1, commented: 0, other: 0 });

    /**
     * The pending request has waited 24 wall-clock hours by fetch time,
     * far past the 2h target, so it counts as a guaranteed miss.
     */
    expect(report.review.target).toEqual({ label: '2h', hours: 2, inside: 1, over: 1, pendingOverdue: 1 });

    expect(report.review.reviewed[0]).toEqual({
      repo: 'acme/api',
      number: 1,
      title: 'pr 1',
      url: 'https://example.com/1',
      state: 'closed',
      requestedAt: '2026-07-01T00:00:00.000Z',
      reviewedAt: '2026-07-01T01:00:00.000Z',
      hours: 1,
      verdict: 'APPROVED',
      totalLines: 50,
    });

    expect(report.review.pending[0].hours).toBe(24);
    expect(report.review.byRepo).toEqual([{ repo: 'acme/api', reviews: 2, p50Hours: 1 }]);

    expect(report.authored.counts).toEqual({
      total: 3,
      analyzed: 2,
      inaccessible: 1,
      open: 0,
      merged: 1,
      closedUnmerged: 1,
    });

    expect(report.authored.sizeLines).toEqual({ count: 2, mean: 100, p50: 50, p90: 150, min: 50, max: 150 });
    expect(report.authored.mergeTimeHours).toEqual({ count: 1, mean: 24, p50: 24, p90: 24, min: 24, max: 24 });

    /**
     * Only the merged PR received a review, 12 wall-clock hours after
     * its creation, and the other PR closed unreviewed, so nothing is
     * still awaiting a first review.
     */
    expect(report.authored.firstReviewHours).toEqual({ count: 1, mean: 12, p50: 12, p90: 12, min: 12, max: 12 });
    expect(report.authored.awaitingFirstReview).toBe(0);

    expect(report.authored.sizeTarget).toEqual({ label: '<= 100 lines', inside: 1, over: 1 });

    expect(report.authored.reviewers).toEqual({
      leaderboard: [{ login: 'alice', prs: 1, reviews: 1 }],
      mergedReviewed: 1,
      mergedUnreviewed: 0,
    });

    const merged = report.authored.prs[0];

    expect(merged.hoursToMerge).toBe(24);
    expect(merged.hoursToClose).toBeNull();
    expect(merged.firstReviewAt).toBe('2026-07-01T12:00:00.000Z');
    expect(merged.hoursToFirstReview).toBe(12);
    expect(merged.totalLines).toBe(50);
    expect(merged.comments).toEqual({ discussion: 1, review: 2, total: 3 });
    expect(merged.reviewers).toEqual(['alice']);

    const closed = report.authored.prs[1];

    expect(closed.hoursToMerge).toBeNull();
    expect(closed.hoursToClose).toBe(48);
    expect(closed.firstReviewAt).toBeNull();
    expect(closed.hoursToFirstReview).toBeNull();

    expect(report.comments).toEqual({
      received: 3,
      prsWithoutComments: 1,
      perPr: { count: 2, mean: 1.5, p50: 0, p90: 3, min: 0, max: 3 },
    });
  } finally {
    restoreTimeMode();
  }
});

test('reports null summaries and empty targets on an empty load', () => {
  try {
    const empty: RawData = { ...raw, reviewResults: [], sizes: [], authoredTotal: 0 };

    const report = buildStatsReport(empty, { ...options, target: '', sizeTarget: '' });

    expect(report.review.reviewTimeHours).toBeNull();
    expect(report.review.cyclesPerPr).toBeNull();
    expect(report.review.target).toBeNull();
    expect(report.options.reviewTarget).toBeNull();
    expect(report.authored.sizeLines).toBeNull();
    expect(report.authored.mergeTimeHours).toBeNull();
    expect(report.authored.firstReviewHours).toBeNull();
    expect(report.authored.awaitingFirstReview).toBe(0);
    expect(report.authored.sizeTarget).toBeNull();
    expect(report.comments.perPr).toBeNull();
    expect(report.authored.prs).toEqual([]);
  } finally {
    restoreTimeMode();
  }
});

test('writes the report to pr-stats.json in the working directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-stats-export-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(dir);
    exportStatsFile(raw, options);

    /**
     * The report only holds JSON-native values, so the file parses back
     * into exactly what the builder returned.
     */
    const written = JSON.parse(readFileSync(join(dir, 'pr-stats.json'), 'utf8')) as StatsReport;

    expect(written).toEqual(buildStatsReport(raw, options));
    expect(written.user).toBe('me');
  } finally {
    process.chdir(previousCwd);
    restoreTimeMode();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Drives the published --json code path end to end, the same canned data
 * the App tests render, through a child process so the report on stdout
 * gets parsed exactly like a jq consumer would.
 */
test('the --json flag prints the full report to stdout', async () => {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      join(import.meta.dir, '..', 'main.tsx'),
      '--json',
      '--debug',
      join(import.meta.dir, '..', 'testdata'),
      '--since',
      '2026-06-01',
      '--target',
      '1d',
      '--size-target',
      '400l,20f',
      '--tz',
      'Europe/Berlin',
    ],
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [output, errors, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  expect(errors).toBe('');
  expect(exitCode).toBe(0);

  const report = JSON.parse(output) as ReturnType<typeof buildStatsReport>;

  expect(report.user).toBe('testuser');
  expect(report.since).toBe('2026-06-01');
  expect(report.repos).toEqual([]);
  expect(report.searchCapped).toBe(false);
  expect(report.options.timezone).toBe('Europe/Berlin');

  expect(report.review.counts).toEqual({
    reviewed: 3,
    pending: 2,
    reviewing: 1,
    closedUnreviewed: 1,
    reviewedUnrequested: 2,
  });

  // the same three cycles the review tab headlines as p50 6h and mean 10.1h
  expect(report.review.reviewTimeHours).toEqual({ count: 3, mean: 10.08, p50: 6, p90: 24, min: 0.25, max: 24 });
  expect(report.review.verdicts).toEqual({ approved: 2, changesRequested: 1, commented: 0, other: 0 });
  expect(report.review.reviewed.map((entry) => entry.totalLines)).toEqual([190, 700, 4]);
  expect(report.review.target).toEqual({ label: '1d', hours: 24, inside: 3, over: 0, pendingOverdue: 2 });

  expect(report.review.byRepo).toEqual([
    { repo: 'acme/api', reviews: 2, p50Hours: 6 },
    { repo: 'acme/web', reviews: 1, p50Hours: 0.25 },
  ]);

  expect(report.authored.counts).toEqual({
    total: 5,
    analyzed: 5,
    inaccessible: 0,
    open: 1,
    merged: 3,
    closedUnmerged: 1,
  });

  expect(report.authored.sizeLines).toEqual({ count: 5, mean: 899, p50: 400, p90: 2900, min: 45, max: 2900 });
  expect(report.authored.mergeTimeHours?.count).toBe(3);
  expect(report.authored.mergeTimeHours?.p50).toBe(24);

  /**
   * Three authored PRs received a review. api#10 got alice's review six
   * hours into its creation Friday, api#11 was created on a Saturday and
   * alice reviewed it Tuesday noon Berlin time, 36 counted hours, and
   * web#13 got its first review a full day in. Nothing else is open and
   * unreviewed.
   */
  expect(report.authored.firstReviewHours).toEqual({ count: 3, mean: 22, p50: 24, p90: 36, min: 6, max: 36 });
  expect(report.authored.awaitingFirstReview).toBe(0);

  // api#14 sits exactly on the 400-line budget, so it counts as inside
  expect(report.authored.sizeTarget).toEqual({ label: '<= 400 lines, <= 20 files', inside: 3, over: 2 });

  expect(report.authored.reviewers.leaderboard[0]).toEqual({ login: 'alice', prs: 3, reviews: 3 });
  expect(report.authored.reviewers.mergedReviewed).toBe(2);
  expect(report.authored.reviewers.mergedUnreviewed).toBe(1);

  expect(report.authored.prs).toHaveLength(5);

  const open = report.authored.prs.find((entry) => entry.number === 13);

  expect(open?.state).toBe('open');
  expect(open?.hoursToMerge).toBeNull();
  expect(open?.hoursToClose).toBeNull();
  expect(open?.firstReviewAt).toBe('2026-07-21T10:00:00.000Z');
  expect(open?.hoursToFirstReview).toBe(24);
  expect(open?.totalLines).toBe(2900);

  expect(report.comments).toEqual({
    received: 30,
    prsWithoutComments: 1,
    perPr: { count: 5, mean: 6, p50: 3, p90: 16, min: 0, max: 16 },
  });
}, 30_000);
