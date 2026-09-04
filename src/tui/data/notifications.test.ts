import { expect, test } from 'bun:test';
import type { ReviewResult } from './load';
import {
  describeReviewRequests,
  describeSnoozeWakeUps,
  diffReviewRequests,
  type ReviewRequestChanges,
} from './notifications';

/**
 * Builds the PR descriptor the results share, with a title that names
 * the number so the notification bodies are easy to read in assertions.
 */
function pr(repo: string, number: number, state = 'open') {
  return {
    repo,
    number,
    title: `pr ${number}`,
    url: `https://example.com/${repo}/${number}`,
    state,
    createdAt: new Date('2026-07-01T00:00:00Z'),
  };
}

/**
 * Builds a pending review result, a PR awaiting a review since the given
 * time, open unless a state overrides it.
 */
function pendingResult(repo: string, number: number, requestedAt: string, state = 'open'): ReviewResult {
  return { kind: 'pending', pr: pr(repo, number, state), requestedAt: new Date(requestedAt) };
}

/**
 * Builds a reviewed result, a completed request-review cycle on an open
 * PR, answered at the given time.
 */
function reviewedResult(repo: string, number: number, reviewedAt: string): ReviewResult {
  return {
    kind: 'reviewed',
    pr: pr(repo, number),
    requestedAt: new Date('2026-06-15T00:00:00Z'),
    reviewedAt: new Date(reviewedAt),
    verdict: 'APPROVED',
    lines: 15,
  };
}

/**
 * Lists the repo#number references of the given PRs, so the assertions
 * compare on the identity of a change and not the whole descriptor.
 */
function refs(prs: { repo: string; number: number }[]): string[] {
  return prs.map((entry) => `${entry.repo}#${entry.number}`);
}

test('the first load only establishes the baseline and reports nothing', () => {
  const changes = diffReviewRequests(null, [
    pendingResult('acme/api', 1, '2026-07-02T00:00:00Z'),
    reviewedResult('acme/web', 2, '2026-07-01T00:00:00Z'),
    pendingResult('acme/web', 2, '2026-07-03T00:00:00Z'),
  ]);

  expect(changes.newRequests).toEqual([]);
  expect(changes.reRequests).toEqual([]);

  expect([...changes.baseline.entries()]).toEqual([
    ['acme/api#1', Date.parse('2026-07-02T00:00:00Z')],
    ['acme/web#2', Date.parse('2026-07-03T00:00:00Z')],
  ]);
});

test('a pending PR the baseline lacks is a new request, or a re-request once you reviewed it before', () => {
  const first = diffReviewRequests(null, [
    pendingResult('acme/api', 1, '2026-07-02T00:00:00Z'),
    reviewedResult('acme/web', 2, '2026-07-01T00:00:00Z'),
  ]);

  /**
   * The pending api#1 never reports again. The PR api#3 is a first
   * request, and web#2 sat on the reviewing queue after your review
   * until the author asked again, which makes it a re-request.
   */
  const second = diffReviewRequests(first.baseline, [
    pendingResult('acme/api', 1, '2026-07-02T00:00:00Z'),
    pendingResult('acme/api', 3, '2026-07-04T00:00:00Z'),
    reviewedResult('acme/web', 2, '2026-07-01T00:00:00Z'),
    pendingResult('acme/web', 2, '2026-07-05T00:00:00Z'),
  ]);

  expect(refs(second.newRequests)).toEqual(['acme/api#3']);
  expect(refs(second.reRequests)).toEqual(['acme/web#2']);
  expect([...second.baseline.keys()]).toEqual(['acme/api#1', 'acme/api#3', 'acme/web#2']);
});

test('a newer request on a PR that was already pending reports as a re-request', () => {
  const first = diffReviewRequests(null, [pendingResult('acme/api', 1, '2026-07-02T00:00:00Z')]);

  /**
   * Between the two loads you reviewed api#1 and the author re-requested
   * you, so the PR is pending in both loads with a newer request and a
   * completed cycle behind it.
   */
  const second = diffReviewRequests(first.baseline, [
    reviewedResult('acme/api', 1, '2026-07-03T00:00:00Z'),
    pendingResult('acme/api', 1, '2026-07-04T00:00:00Z'),
  ]);

  expect(second.newRequests).toEqual([]);
  expect(refs(second.reRequests)).toEqual(['acme/api#1']);

  // the same request time reports nothing, and so does an older one
  const third = diffReviewRequests(second.baseline, [
    reviewedResult('acme/api', 1, '2026-07-03T00:00:00Z'),
    pendingResult('acme/api', 1, '2026-07-04T00:00:00Z'),
  ]);

  expect(third.newRequests).toEqual([]);
  expect(third.reRequests).toEqual([]);
});

test('closed PRs, unrequested reviews, and reviews you gave drop out silently', () => {
  const first = diffReviewRequests(null, [
    pendingResult('acme/api', 1, '2026-07-02T00:00:00Z'),
    pendingResult('acme/api', 2, '2026-07-02T00:00:00Z'),
  ]);

  /**
   * The PR api#1 got your review and moved to the reviewing queue, api#2
   * closed with the request still open, api#4 was requested and closed
   * between the loads, and web#5 is a team request you reviewed without
   * a personal request. None of them is a change to notify about.
   */
  const second = diffReviewRequests(first.baseline, [
    reviewedResult('acme/api', 1, '2026-07-03T00:00:00Z'),
    pendingResult('acme/api', 2, '2026-07-02T00:00:00Z', 'closed'),
    pendingResult('acme/api', 4, '2026-07-03T00:00:00Z', 'closed'),
    { kind: 'unrequested', pr: pr('acme/web', 5), reviewedAt: new Date('2026-07-03T00:00:00Z') },
    { kind: 'inaccessible', pr: pr('acme/web', 6) },
  ]);

  expect(second.newRequests).toEqual([]);
  expect(second.reRequests).toEqual([]);
  expect(second.baseline.size).toBe(0);
});

test('describes a single PR by reference and several PRs by count with a capped list', () => {
  const single: ReviewRequestChanges = {
    baseline: new Map(),
    newRequests: [pr('acme/api', 1)],
    reRequests: [pr('acme/web', 2)],
  };

  expect(describeReviewRequests(single)).toEqual([
    { title: 'Review requested on acme/api#1', body: 'pr 1' },
    { title: 'Review re-requested on acme/web#2', body: 'pr 2' },
  ]);

  const several: ReviewRequestChanges = {
    baseline: new Map(),
    newRequests: [pr('acme/api', 1), pr('acme/api', 2), pr('acme/web', 3), pr('acme/web', 4), pr('acme/web', 5)],
    reRequests: [],
  };

  // the body lists three references and folds the rest into a count
  expect(describeReviewRequests(several)).toEqual([
    {
      title: '5 new PRs awaiting your review',
      body: 'acme/api#1 pr 1\nacme/api#2 pr 2\nacme/web#3 pr 3\nand 2 more',
    },
  ]);

  expect(describeReviewRequests({ baseline: new Map(), newRequests: [], reRequests: [] })).toEqual([]);
});

test('describes the PRs that came back from a snooze like the request notifications', () => {
  expect(describeSnoozeWakeUps([pr('acme/api', 1)])).toEqual([{ title: 'Snooze ended on acme/api#1', body: 'pr 1' }]);

  expect(describeSnoozeWakeUps([pr('acme/api', 1), pr('acme/web', 2), pr('acme/web', 3), pr('acme/web', 4)])).toEqual([
    {
      title: '4 snoozed PRs are back in your queue',
      body: 'acme/api#1 pr 1\nacme/web#2 pr 2\nacme/web#3 pr 3\nand 1 more',
    },
  ]);

  expect(describeSnoozeWakeUps([])).toEqual([]);
});
