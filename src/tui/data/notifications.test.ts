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

function pendingResult(repo: string, number: number, requestedAt: string, state = 'open'): ReviewResult {
  return { kind: 'pending', pr: pr(repo, number, state), requestedAt: new Date(requestedAt) };
}

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

  const second = diffReviewRequests(first.baseline, [
    reviewedResult('acme/api', 1, '2026-07-03T00:00:00Z'),
    pendingResult('acme/api', 1, '2026-07-04T00:00:00Z'),
  ]);

  expect(second.newRequests).toEqual([]);
  expect(refs(second.reRequests)).toEqual(['acme/api#1']);

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

  const escalated = diffReviewRequests(reported.baseline, [pendingResult('acme/web', 4, '2026-07-06T00:00:00Z')], true);

  expect(refs(escalated.newRequests)).toEqual(['acme/web#4']);
  expect(escalated.teamRequests).toEqual([]);

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

  const lagged = diffMentions(
    baseline,
    [
      mention('acme/web', 4, [['y1', '2026-07-10T11:55:00Z']]),
      mention('acme/web', 5, [['z1', '2026-07-10T11:00:00Z']]),
    ],
    new Date('2026-07-10T14:00:00Z'),
  );

  expect(refs(lagged.newMentions)).toEqual(['acme/web#4']);

  const dropped = diffMentions(next.baseline, [], new Date('2026-07-10T15:00:00Z'));

  const returned = diffMentions(
    dropped.baseline,
    [mention('acme/web', 3, [['x2', '2026-07-10T13:00:00Z']])],
    new Date('2026-07-10T16:00:00Z'),
  );

  expect(returned.newMentions).toEqual([]);
  expect([...returned.baseline.seen]).toEqual(['a1', 'w1', 'x1', 'x2']);

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
