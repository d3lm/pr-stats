import { expect, test } from 'bun:test';
import type { MentionEntry, ReviewResult } from './load';
import {
  describeMentions,
  describeReviewRequests,
  describeSnoozeWakeUps,
  diffMentions,
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
 * Builds a mention entry, a PR that mentions you in the given texts,
 * each named by its id with the time it became visible, open unless a
 * state overrides it. The earlier ids stand for the texts the window
 * cut from the entry.
 */
function mention(
  repo: string,
  number: number,
  texts: [id: string, at: string][],
  state = 'open',
  earlier: string[] = [],
): MentionEntry {
  return {
    pr: { ...pr(repo, number, state), updatedAt: new Date(texts.at(-1)?.[1] ?? '2026-07-01T00:00:00Z') },
    mentions: texts.map(([id, at]) => {
      return { id, at: new Date(at) };
    }),
    earlier,
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

test('a request of your team enters the baseline always and reports only with the team flag', () => {
  const teamPending = (repo: string, number: number, requestedAt: string): ReviewResult => {
    return {
      kind: 'team-pending',
      pr: pr(repo, number),
      requestedAt: new Date(requestedAt),
      team: 'acme/backend',
    };
  };

  const first = diffReviewRequests(null, [pendingResult('acme/api', 1, '2026-07-02T00:00:00Z')]);

  /**
   * Without the flag the new team request joins the baseline in silence,
   * so turning the flag on afterwards never reports it, while a direct
   * request in the same load still reports.
   */
  const silent = diffReviewRequests(first.baseline, [
    pendingResult('acme/api', 1, '2026-07-02T00:00:00Z'),
    teamPending('acme/web', 2, '2026-07-03T00:00:00Z'),
    pendingResult('acme/api', 3, '2026-07-03T00:00:00Z'),
  ]);

  expect(refs(silent.newRequests)).toEqual(['acme/api#3']);
  expect(silent.teamRequests).toEqual([]);
  expect([...silent.baseline.keys()]).toEqual(['acme/api#1', 'acme/web#2', 'acme/api#3']);

  const afterToggle = diffReviewRequests(
    silent.baseline,
    [
      pendingResult('acme/api', 1, '2026-07-02T00:00:00Z'),
      teamPending('acme/web', 2, '2026-07-03T00:00:00Z'),
      pendingResult('acme/api', 3, '2026-07-03T00:00:00Z'),
    ],
    true,
  );

  expect(afterToggle.teamRequests).toEqual([]);

  /**
   * With the flag a team request the baseline lacks reports as a team
   * request, apart from the direct ones, and so does a newer request of
   * the team on a PR that was already waiting for it. A PR you reviewed
   * that your team is asked about again is a team request too, not a
   * re-request of you.
   */
  const reported = diffReviewRequests(
    afterToggle.baseline,
    [
      teamPending('acme/web', 2, '2026-07-05T00:00:00Z'),
      teamPending('acme/web', 4, '2026-07-04T00:00:00Z'),
      reviewedResult('acme/api', 1, '2026-07-03T00:00:00Z'),
      teamPending('acme/api', 1, '2026-07-04T00:00:00Z'),
      pendingResult('acme/api', 5, '2026-07-04T00:00:00Z'),
    ],
    true,
  );

  expect(refs(reported.teamRequests)).toEqual(['acme/web#2', 'acme/web#4', 'acme/api#1']);
  expect(refs(reported.newRequests)).toEqual(['acme/api#5']);
  expect(reported.reRequests).toEqual([]);

  // a direct request that follows a team request on the same PR reports as a new request
  const escalated = diffReviewRequests(reported.baseline, [pendingResult('acme/web', 4, '2026-07-06T00:00:00Z')], true);

  expect(refs(escalated.newRequests)).toEqual(['acme/web#4']);
  expect(escalated.teamRequests).toEqual([]);

  // a team request on a closed PR never reports
  const closed = diffReviewRequests(
    escalated.baseline,
    [{ ...teamPending('acme/web', 7, '2026-07-07T00:00:00Z'), pr: pr('acme/web', 7, 'closed') }],
    true,
  );

  expect(closed.teamRequests).toEqual([]);
  expect(closed.baseline.size).toBe(0);
});

test('describes a single PR by reference and several PRs by count with a capped list', () => {
  const single: ReviewRequestChanges = {
    baseline: new Map(),
    newRequests: [pr('acme/api', 1)],
    reRequests: [pr('acme/web', 2)],
    teamRequests: [pr('acme/web', 3)],
  };

  expect(describeReviewRequests(single)).toEqual([
    { title: 'Review requested on acme/api#1', body: 'pr 1' },
    { title: 'Review re-requested on acme/web#2', body: 'pr 2' },
    { title: 'Review requested of your team on acme/web#3', body: 'pr 3' },
  ]);

  const several: ReviewRequestChanges = {
    baseline: new Map(),
    newRequests: [pr('acme/api', 1), pr('acme/api', 2), pr('acme/web', 3), pr('acme/web', 4), pr('acme/web', 5)],
    reRequests: [],
    teamRequests: [pr('acme/web', 6), pr('acme/web', 7)],
  };

  // the body lists three references and folds the rest into a count
  expect(describeReviewRequests(several)).toEqual([
    {
      title: '5 new PRs awaiting your review',
      body: 'acme/api#1 pr 1\nacme/api#2 pr 2\nacme/web#3 pr 3\nand 2 more',
    },
    { title: '2 new PRs requested of your team', body: 'acme/web#6 pr 6\nacme/web#7 pr 7' },
  ]);

  expect(describeReviewRequests({ baseline: new Map(), newRequests: [], reRequests: [], teamRequests: [] })).toEqual(
    [],
  );
});

test('the first mention list only establishes the baseline, and later ones report the texts that arrived since', () => {
  const first = diffMentions(
    null,
    [
      mention('acme/api', 1, [['a1', '2026-07-02T00:00:00Z']]),
      mention('acme/web', 2, [['w1', '2026-07-01T00:00:00Z']], 'closed'),
    ],
    new Date('2026-07-03T00:00:00Z'),
  );

  expect(first.newMentions).toEqual([]);
  expect([...first.baseline.seen]).toEqual(['a1', 'w1']);
  expect(first.baseline.observedAt).toBe(Date.parse('2026-07-03T00:00:00Z'));

  /**
   * The text on api#1 is the one the baseline saw and stays quiet.
   * Someone mentioned you again on the closed web#2, which counts because
   * a closed PR can still ask for your attention, and api#3 mentions you
   * for the first time. A PR that dropped out of the results is no news
   * either.
   */
  const second = diffMentions(
    first.baseline,
    [
      mention('acme/api', 1, [['a1', '2026-07-02T00:00:00Z']]),
      mention(
        'acme/web',
        2,
        [
          ['w1', '2026-07-01T00:00:00Z'],
          ['w2', '2026-07-05T00:00:00Z'],
        ],
        'closed',
      ),
      mention('acme/api', 3, [['a3', '2026-07-04T00:00:00Z']]),
    ],
    new Date('2026-07-06T00:00:00Z'),
  );

  expect(refs(second.newMentions)).toEqual(['acme/web#2', 'acme/api#3']);
  expect([...second.baseline.seen]).toEqual(['a1', 'w1', 'w2', 'a3']);

  /**
   * A text the baseline saw stays quiet however its time moves, so a
   * typo fix on a comment that already mentioned you reports nothing,
   * and neither does a text that vanished.
   */
  const third = diffMentions(
    second.baseline,
    [mention('acme/web', 2, [['w2', '2026-07-07T00:00:00Z']], 'closed')],
    new Date('2026-07-08T00:00:00Z'),
  );

  expect(third.newMentions).toEqual([]);
});

test('a text the baseline never saw only counts when it became visible after the previous observation', () => {
  const observedAt = new Date('2026-07-10T12:00:00Z');
  const baseline = diffMentions(null, [mention('acme/api', 1, [['a1', '2026-07-02T00:00:00Z']])], observedAt).baseline;

  /**
   * An old PR entered the update window after unrelated activity, so
   * its mention from long ago turns up for the first time. It was old
   * news when the baseline was taken, so it stays quiet. A mention that
   * came in after the observation, whether on the same PR or on one the
   * baseline knew, is news.
   */
  const next = diffMentions(
    baseline,
    [
      mention('acme/api', 1, [['a1', '2026-07-02T00:00:00Z']]),
      mention('acme/web', 2, [['w1', '2026-06-20T00:00:00Z']]),
      mention('acme/web', 3, [
        ['x1', '2026-06-20T00:00:00Z'],
        ['x2', '2026-07-10T13:00:00Z'],
      ]),
    ],
    new Date('2026-07-10T14:00:00Z'),
  );

  expect(refs(next.newMentions)).toEqual(['acme/web#3']);

  /**
   * The search that lists the mentioned PRs runs on an index that trails
   * the live data, so a mention from shortly before the observation can
   * miss the load that took the baseline and counts in the next one. A
   * mention from well before it does not.
   */
  const lagged = diffMentions(
    baseline,
    [
      mention('acme/web', 4, [['y1', '2026-07-10T11:55:00Z']]),
      mention('acme/web', 5, [['z1', '2026-07-10T11:00:00Z']]),
    ],
    new Date('2026-07-10T14:00:00Z'),
  );

  expect(refs(lagged.newMentions)).toEqual(['acme/web#4']);

  /**
   * The baseline remembers every text it has seen, so a PR that drops
   * out of the results and returns with the same texts, however their
   * times compare to the latest observation, reports nothing twice.
   */
  const dropped = diffMentions(next.baseline, [], new Date('2026-07-10T15:00:00Z'));

  const returned = diffMentions(
    dropped.baseline,
    [mention('acme/web', 3, [['x2', '2026-07-10T13:00:00Z']])],
    new Date('2026-07-10T16:00:00Z'),
  );

  expect(returned.newMentions).toEqual([]);
  expect([...returned.baseline.seen]).toEqual(['a1', 'w1', 'x1', 'x2']);

  /**
   * The texts the since window cut from a PR count as seen along with
   * the ones it shows, so an edit that carries one of them back into the
   * window with a fresh time reports nothing.
   */
  const cut = diffMentions(
    returned.baseline,
    [mention('acme/web', 6, [['v2', '2026-07-10T16:30:00Z']], 'open', ['v1'])],
    new Date('2026-07-10T17:00:00Z'),
  );

  expect(refs(cut.newMentions)).toEqual(['acme/web#6']);
  expect([...cut.baseline.seen]).toEqual(['a1', 'w1', 'x1', 'x2', 'v2', 'v1']);

  const editedCut = diffMentions(
    cut.baseline,
    [
      mention('acme/web', 6, [
        ['v2', '2026-07-10T16:30:00Z'],
        ['v1', '2026-07-10T17:30:00Z'],
      ]),
    ],
    new Date('2026-07-10T18:00:00Z'),
  );

  expect(editedCut.newMentions).toEqual([]);
});

test('a PR the load could not read keeps its cutoff until a load reads it', () => {
  const unread = (repo: string, number: number): MentionEntry => {
    return { ...mention(repo, number, []), mentions: null };
  };

  const baseline = diffMentions(
    null,
    [mention('acme/api', 1, [['a1', '2026-07-10T11:00:00Z']])],
    new Date('2026-07-10T12:00:00Z'),
  ).baseline;

  /**
   * Someone mentioned you on web#2 at 12:05, and the load at 12:30 could
   * not read the PR. That load must not count as having observed web#2,
   * so the load at 12:31 that reads it compares the text against the
   * observation at noon and reports it, although it predates the 12:30
   * observation by more than the margin. Once read, the PR leaves the
   * unread map.
   */
  const partial = diffMentions(baseline, [unread('acme/web', 2)], new Date('2026-07-10T12:30:00Z'));

  expect(partial.newMentions).toEqual([]);
  expect([...partial.baseline.unread]).toEqual([['acme/web#2', Date.parse('2026-07-10T12:00:00Z')]]);

  const recovered = diffMentions(
    partial.baseline,
    [mention('acme/web', 2, [['w1', '2026-07-10T12:05:00Z']])],
    new Date('2026-07-10T12:31:00Z'),
  );

  expect(refs(recovered.newMentions)).toEqual(['acme/web#2']);
  expect(recovered.baseline.unread.size).toBe(0);

  /**
   * A PR that stays unreadable across loads, or drops out of the results
   * while unread, keeps the same held cutoff, and a PR unreadable during
   * the very first list gets that list's observation as its cutoff.
   */
  const again = diffMentions(partial.baseline, [unread('acme/web', 2)], new Date('2026-07-10T13:00:00Z'));

  expect([...again.baseline.unread]).toEqual([['acme/web#2', Date.parse('2026-07-10T12:00:00Z')]]);

  const gone = diffMentions(again.baseline, [], new Date('2026-07-10T14:00:00Z'));

  expect([...gone.baseline.unread]).toEqual([['acme/web#2', Date.parse('2026-07-10T12:00:00Z')]]);

  const first = diffMentions(null, [unread('acme/web', 3)], new Date('2026-07-10T15:00:00Z'));

  expect([...first.baseline.unread]).toEqual([['acme/web#3', Date.parse('2026-07-10T15:00:00Z')]]);
});

test('describes new mentions like the request notifications', () => {
  const empty = { seen: new Set<string>(), observedAt: 0, unread: new Map<string, number>() };
  const now = new Date('2026-07-02T00:00:00Z');
  const single = diffMentions(empty, [mention('acme/api', 1, [['a1', '2026-07-02T00:00:00Z']])], now);

  expect(describeMentions(single)).toEqual([{ title: 'Mentioned on acme/api#1', body: 'pr 1' }]);

  const several = diffMentions(
    empty,
    [
      mention('acme/api', 1, [['a1', '2026-07-02T00:00:00Z']]),
      mention('acme/web', 2, [['w2', '2026-07-02T00:00:00Z']]),
      mention('acme/web', 3, [['w3', '2026-07-02T00:00:00Z']]),
      mention('acme/web', 4, [['w4', '2026-07-02T00:00:00Z']]),
    ],
    now,
  );

  expect(describeMentions(several)).toEqual([
    { title: '4 PRs mention you', body: 'acme/api#1 pr 1\nacme/web#2 pr 2\nacme/web#3 pr 3\nand 1 more' },
  ]);

  expect(describeMentions({ baseline: empty, newMentions: [] })).toEqual([]);
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
