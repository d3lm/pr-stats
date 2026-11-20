import { expect, test } from 'bun:test';
import {
  classifyPr,
  collectReviewPrs,
  findMentions,
  mergeRequestedPrs,
  queueResultsOnly,
  stripCodeAndComments,
  type ReviewPr,
} from './data';
import type { PrDetails, PrMentionDetails, SearchPrItem } from './github';

const pr: ReviewPr = {
  repo: 'acme/api',
  number: 1,
  title: 'a',
  url: 'https://example.com/1',
  state: 'open',
  createdAt: new Date('2026-07-01T00:00:00Z'),
};

type Request = string | { at: string; team: string };

function details(
  requests: Request[],
  reviews: (string | { at: string; login?: string; state?: string })[],
  outstanding: string[] = [],
): PrDetails {
  return {
    additions: 120,
    deletions: 30,
    timelineItems: {
      nodes: requests.map((request) => {
        if (typeof request === 'string') {
          return { createdAt: request, requestedReviewer: { login: 'me' } };
        }

        return {
          createdAt: request.at,
          requestedReviewer: { slug: request.team.split('/')[1], combinedSlug: request.team },
        };
      }),
    },
    reviews: {
      nodes: reviews.map((review) => {
        const { at, login = 'me', state = 'APPROVED' } = typeof review === 'string' ? { at: review } : review;

        return { author: { login }, submittedAt: at, state };
      }),
    },
    reviewRequests: {
      nodes: outstanding.map((team) => {
        return { requestedReviewer: { combinedSlug: team } };
      }),
    },
  };
}

const teams = new Set(['acme/backend', 'acme/oncall']);

test('classifies a single answered request as one reviewed cycle', () => {
  expect(classifyPr(pr, details(['2026-07-01T09:00:00Z'], ['2026-07-01T15:00:00Z']), 'me')).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T15:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
    },
  ]);
});

test('a re-request after a review yields the completed cycle plus a pending one', () => {
  expect(
    classifyPr(pr, details(['2026-07-01T09:00:00Z', '2026-07-02T09:00:00Z'], ['2026-07-01T15:00:00Z']), 'me'),
  ).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T15:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
    },
    { kind: 'pending', pr, requestedAt: new Date('2026-07-02T09:00:00Z') },
  ]);
});

test('a nudge before any review stays inside the first cycle', () => {
  expect(
    classifyPr(pr, details(['2026-07-01T09:00:00Z', '2026-07-02T09:00:00Z'], ['2026-07-03T15:00:00Z']), 'me'),
  ).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-03T15:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
    },
  ]);
});

test('two answered requests yield two reviewed cycles, each with its own verdict', () => {
  const results = classifyPr(
    pr,
    details(
      ['2026-07-01T09:00:00Z', '2026-07-02T09:00:00Z'],
      [{ at: '2026-07-01T15:00:00Z', state: 'CHANGES_REQUESTED' }, '2026-07-02T15:00:00Z'],
    ),
    'me',
  );

  expect(results).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T15:00:00Z'),
      verdict: 'CHANGES_REQUESTED',
      lines: 150,
    },
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-02T09:00:00Z'),
      reviewedAt: new Date('2026-07-02T15:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
    },
  ]);
});

test('a review at the exact request timestamp closes that cycle', () => {
  expect(classifyPr(pr, details(['2026-07-01T09:00:00Z'], ['2026-07-01T09:00:00Z']), 'me')).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T09:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
    },
  ]);
});

test('a review before the first request never answers it', () => {
  expect(classifyPr(pr, details(['2026-07-02T09:00:00Z'], ['2026-07-01T15:00:00Z']), 'me')).toEqual([
    { kind: 'pending', pr, requestedAt: new Date('2026-07-02T09:00:00Z') },
  ]);
});

test('reviews without any personal request classify as unrequested with the latest review time', () => {
  expect(classifyPr(pr, details([], ['2026-07-03T09:00:00Z', '2026-07-01T15:00:00Z']), 'me')).toEqual([
    { kind: 'unrequested', pr, reviewedAt: new Date('2026-07-03T09:00:00Z') },
  ]);
});

test('other people on the timeline never count toward your cycles', () => {
  const timeline = details(['2026-07-01T09:00:00Z'], [{ at: '2026-07-01T15:00:00Z', login: 'someoneelse' }]);

  expect(classifyPr(pr, timeline, 'me')).toEqual([
    { kind: 'pending', pr, requestedAt: new Date('2026-07-01T09:00:00Z') },
  ]);
});

test('missing details classify as inaccessible', () => {
  expect(classifyPr(pr, null, 'me')).toEqual([{ kind: 'inaccessible', pr }]);
});

test('an uncounted review never closes a cycle, the next counted one does', () => {
  const timeline = details(
    ['2026-07-01T09:00:00Z'],
    [{ at: '2026-07-01T15:00:00Z', state: 'COMMENTED' }, '2026-07-02T15:00:00Z'],
  );

  expect(classifyPr(pr, timeline, 'me', new Set(['APPROVED']))).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-02T15:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
    },
  ]);
});

test('a request answered only by an uncounted review stays pending', () => {
  const timeline = details(['2026-07-01T09:00:00Z'], [{ at: '2026-07-01T15:00:00Z', state: 'COMMENTED' }]);

  expect(classifyPr(pr, timeline, 'me', new Set(['APPROVED', 'CHANGES_REQUESTED']))).toEqual([
    { kind: 'pending', pr, requestedAt: new Date('2026-07-01T09:00:00Z') },
  ]);
});

test('a PR with only uncounted reviews and no request drops out entirely', () => {
  const timeline = details([], [{ at: '2026-07-01T15:00:00Z', state: 'COMMENTED' }]);

  expect(classifyPr(pr, timeline, 'me', new Set(['APPROVED']))).toEqual([{ kind: 'inaccessible', pr }]);
});

test('without a configured set every submitted review state counts', () => {
  const timeline = details(['2026-07-01T09:00:00Z'], [{ at: '2026-07-01T15:00:00Z', state: 'COMMENTED' }]);

  expect(classifyPr(pr, timeline, 'me')).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T15:00:00Z'),
      verdict: 'COMMENTED',
      lines: 150,
    },
  ]);
});

test('an open request of one of your teams classifies as team-pending while the team is still requested', () => {
  const request = { at: '2026-07-01T09:00:00Z', team: 'acme/backend' };

  expect(classifyPr(pr, details([request], [], ['acme/backend']), 'me', undefined, teams)).toEqual([
    { kind: 'team-pending', pr, requestedAt: new Date('2026-07-01T09:00:00Z'), team: 'acme/backend' },
  ]);

  expect(classifyPr(pr, details([request], [], ['acme/backend']), 'me', undefined, new Set(['ACME/Backend']))).toEqual([
    { kind: 'team-pending', pr, requestedAt: new Date('2026-07-01T09:00:00Z'), team: 'acme/backend' },
  ]);

  expect(classifyPr(pr, details([request], [], ['acme/backend']), 'me', undefined, new Set(['acme/other']))).toEqual([
    { kind: 'inaccessible', pr },
  ]);

  expect(classifyPr(pr, details([request], [], ['acme/backend']), 'me')).toEqual([{ kind: 'inaccessible', pr }]);

  expect(classifyPr(pr, details([request], []), 'me', undefined, teams)).toEqual([{ kind: 'inaccessible', pr }]);

  expect(classifyPr(pr, details([request], ['2026-06-30T09:00:00Z']), 'me', undefined, teams)).toEqual([
    { kind: 'unrequested', pr, reviewedAt: new Date('2026-06-30T09:00:00Z') },
  ]);
});

test('your review after a request of your team closes the cycle as team-reviewed', () => {
  const timeline = details([{ at: '2026-07-01T09:00:00Z', team: 'acme/backend' }], ['2026-07-01T15:00:00Z']);

  expect(classifyPr(pr, timeline, 'me', undefined, teams)).toEqual([
    {
      kind: 'team-reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T15:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
      team: 'acme/backend',
    },
  ]);

  const twoTeams = details(
    [
      { at: '2026-07-01T09:00:00Z', team: 'acme/oncall' },
      { at: '2026-07-01T10:00:00Z', team: 'acme/backend' },
      { at: '2026-07-02T09:00:00Z', team: 'acme/backend' },
    ],
    ['2026-07-01T15:00:00Z'],
    ['acme/backend'],
  );

  expect(classifyPr(pr, twoTeams, 'me', undefined, teams)).toEqual([
    {
      kind: 'team-reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T15:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
      team: 'acme/oncall',
    },
    { kind: 'team-pending', pr, requestedAt: new Date('2026-07-02T09:00:00Z'), team: 'acme/backend' },
  ]);
});

test('a direct request dominates a team request within one cycle', () => {
  const teamDuringDirect = details(
    ['2026-07-01T09:00:00Z', { at: '2026-07-01T10:00:00Z', team: 'acme/backend' }],
    ['2026-07-01T15:00:00Z'],
  );

  expect(classifyPr(pr, teamDuringDirect, 'me', undefined, teams)).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T15:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
    },
  ]);

  const directDuringTeam = details(
    [{ at: '2026-07-01T09:00:00Z', team: 'acme/backend' }, '2026-07-01T10:00:00Z'],
    [],
    ['acme/backend'],
  );

  expect(classifyPr(pr, directDuringTeam, 'me', undefined, teams)).toEqual([
    { kind: 'pending', pr, requestedAt: new Date('2026-07-01T10:00:00Z') },
  ]);

  const teamAfterDirect = details(
    ['2026-07-01T09:00:00Z', { at: '2026-07-02T09:00:00Z', team: 'acme/backend' }],
    ['2026-07-01T15:00:00Z'],
    ['acme/backend'],
  );

  expect(classifyPr(pr, teamAfterDirect, 'me', undefined, teams)).toEqual([
    {
      kind: 'reviewed',
      pr,
      requestedAt: new Date('2026-07-01T09:00:00Z'),
      reviewedAt: new Date('2026-07-01T15:00:00Z'),
      verdict: 'APPROVED',
      lines: 150,
    },
    { kind: 'team-pending', pr, requestedAt: new Date('2026-07-02T09:00:00Z'), team: 'acme/backend' },
  ]);
});

test('a pending team cycle dates from the latest request of each team still requested', () => {
  const twoTeams: Request[] = [
    { at: '2026-07-01T09:00:00Z', team: 'acme/oncall' },
    { at: '2026-07-02T09:00:00Z', team: 'acme/backend' },
  ];

  expect(classifyPr(pr, details(twoTeams, [], ['acme/backend']), 'me', undefined, teams)).toEqual([
    { kind: 'team-pending', pr, requestedAt: new Date('2026-07-02T09:00:00Z'), team: 'acme/backend' },
  ]);

  expect(classifyPr(pr, details(twoTeams, [], ['acme/backend', 'acme/oncall']), 'me', undefined, teams)).toEqual([
    { kind: 'team-pending', pr, requestedAt: new Date('2026-07-01T09:00:00Z'), team: 'acme/oncall' },
  ]);

  const reRequestedTeam = details(
    [
      { at: '2026-07-01T09:00:00Z', team: 'acme/backend' },
      { at: '2026-07-03T09:00:00Z', team: 'acme/backend' },
    ],
    [],
    ['acme/backend'],
  );

  expect(classifyPr(pr, reRequestedTeam, 'me', undefined, teams)).toEqual([
    { kind: 'team-pending', pr, requestedAt: new Date('2026-07-03T09:00:00Z'), team: 'acme/backend' },
  ]);
});

function searchItem(repo: string, number: number, createdAt: string): SearchPrItem {
  return {
    number,
    repository: { nameWithOwner: repo },
    title: `pr ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    createdAt,
    updatedAt: createdAt,
    isDraft: false,
    state: 'open',
  };
}

test('the request search adds the PRs the windowed review search missed, each once, and marks them', () => {
  const review = [searchItem('acme/api', 1, '2026-07-01T00:00:00Z'), searchItem('acme/web', 2, '2026-07-02T00:00:00Z')];

  const requested = [
    searchItem('acme/api', 9, '2026-05-01T00:00:00Z'),
    searchItem('acme/api', 1, '2026-07-01T00:00:00Z'),
    searchItem('acme/api', 9, '2026-05-01T00:00:00Z'),
  ];

  const merged = mergeRequestedPrs(review, requested);

  expect(merged.prs.map((entry) => `${entry.repo}#${entry.number}`)).toEqual([
    'acme/api#1',
    'acme/web#2',
    'acme/api#9',
  ]);

  expect(merged.outsideWindow).toEqual(new Set(['acme/api#9']));

  expect(merged.prs[2]).toEqual({
    repo: 'acme/api',
    number: 9,
    title: 'pr 9',
    url: 'https://github.com/acme/api/pull/9',
    state: 'open',
    createdAt: new Date('2026-05-01T00:00:00Z'),
  });

  expect(mergeRequestedPrs(review, [])).toEqual({ prs: collectReviewPrs(review), outsideWindow: new Set() });
});

test('a PR outside the window keeps its open requests and loses every other result', () => {
  const old: ReviewPr = { ...pr, number: 9, createdAt: new Date('2026-05-01T00:00:00Z') };
  const outside = new Set(['acme/api#9']);

  const results = classifyPr(
    old,
    details([{ at: '2026-05-02T09:00:00Z', team: 'acme/backend' }, '2026-07-10T09:00:00Z'], ['2026-05-03T09:00:00Z']),
    'me',
    undefined,
    teams,
  );

  const inside = classifyPr(pr, details(['2026-07-01T09:00:00Z'], ['2026-07-01T15:00:00Z']), 'me');

  expect(results.map((result) => result.kind)).toEqual(['team-reviewed', 'pending']);

  expect(queueResultsOnly([...inside, ...results], outside)).toEqual([
    ...inside,
    { kind: 'pending', pr: old, requestedAt: new Date('2026-07-10T09:00:00Z') },
  ]);

  const teamPending = classifyPr(
    old,
    details([{ at: '2026-07-10T09:00:00Z', team: 'acme/backend' }], [], ['acme/backend']),
    'me',
    undefined,
    teams,
  );

  expect(queueResultsOnly(teamPending, outside)).toEqual(teamPending);
  expect(queueResultsOnly(classifyPr(old, details([], ['2026-07-03T15:00:00Z']), 'me'), outside)).toEqual([]);
  expect(queueResultsOnly(results, new Set())).toBe(results);
});

interface MentionText {
  id: string;
  body: string;
  at: string;
  publishedAt?: string | null;
  editedAt?: string | null;
  login?: string | null;
}

function mentionSource({ id, body, at, publishedAt = at, editedAt = null, login = 'alice' }: MentionText) {
  return {
    id,
    body,
    createdAt: at,
    publishedAt,
    lastEditedAt: editedAt,
    author: login === null ? null : { login },
  };
}

function mentionDetails({
  body = '',
  createdAt = '2026-07-01T00:00:00Z',
  editedAt = null,
  author = 'alice',
  comments = [],
  reviews = [],
}: {
  body?: string;
  createdAt?: string;
  editedAt?: string | null;
  author?: string | null;
  comments?: MentionText[];
  reviews?: {
    id: string;
    body?: string;
    at: string | null;
    editedAt?: string | null;
    login?: string | null;
    comments?: MentionText[];
  }[];
}): PrMentionDetails {
  return {
    ...mentionSource({ id: 'pr', body, at: createdAt, editedAt, login: author }),
    comments: comments.map((comment) => mentionSource(comment)),
    reviews: reviews.map((review) => {
      return {
        id: review.id,
        body: review.body ?? '',
        submittedAt: review.at,
        lastEditedAt: review.editedAt ?? null,
        author: review.login === null ? null : { login: review.login ?? 'alice' },
        comments: (review.comments ?? []).map((comment) => mentionSource(comment)),
      };
    }),
  };
}

function at(iso: string): Date {
  return new Date(iso);
}

test('every text that mentions the user counts, wherever it sits on the PR', () => {
  expect(findMentions(mentionDetails({ body: 'cc @me' }), 'me')).toEqual([
    { id: 'pr', at: at('2026-07-01T00:00:00Z') },
  ]);

  expect(
    findMentions(
      mentionDetails({
        body: 'cc @me',
        comments: [
          { id: 'c1', body: '@me ping', at: '2026-07-03T00:00:00Z' },
          { id: 'c2', body: 'unrelated', at: '2026-07-03T01:00:00Z' },
        ],
        reviews: [
          { id: 'r1', body: 'looks fine @me', at: '2026-07-04T00:00:00Z' },
          {
            id: 'r2',
            at: '2026-07-05T00:00:00Z',
            comments: [{ id: 'r2c1', body: '@me is this safe?', at: '2026-07-05T00:00:00Z' }],
          },
        ],
      }),
      'me',
    ),
  ).toEqual([
    { id: 'pr', at: at('2026-07-01T00:00:00Z') },
    { id: 'c1', at: at('2026-07-03T00:00:00Z') },
    { id: 'r1', at: at('2026-07-04T00:00:00Z') },
    { id: 'r2c1', at: at('2026-07-05T00:00:00Z') },
  ]);

  expect(findMentions(mentionDetails({ body: 'cc @Me' }), 'me')).toEqual([
    { id: 'pr', at: at('2026-07-01T00:00:00Z') },
  ]);
});

test('a text becomes visible when it is published or edited, not when it was written', () => {
  expect(
    findMentions(
      mentionDetails({
        body: 'now cc @me',
        editedAt: '2026-07-10T00:00:00Z',
        comments: [{ id: 'c1', body: 'and @me here', at: '2026-07-02T00:00:00Z', editedAt: '2026-07-11T00:00:00Z' }],
        reviews: [{ id: 'r1', body: '@me too', at: '2026-07-03T00:00:00Z', editedAt: '2026-07-12T00:00:00Z' }],
      }),
      'me',
    ),
  ).toEqual([
    { id: 'pr', at: at('2026-07-10T00:00:00Z') },
    { id: 'c1', at: at('2026-07-11T00:00:00Z') },
    { id: 'r1', at: at('2026-07-12T00:00:00Z') },
  ]);

  expect(
    findMentions(
      mentionDetails({
        reviews: [
          {
            id: 'r1',
            at: '2026-07-05T00:00:00Z',
            comments: [
              { id: 'r1c1', body: '@me', at: '2026-07-02T00:00:00Z', publishedAt: '2026-07-05T00:00:00Z' },
              { id: 'r1c2', body: '@me', at: '2026-07-02T00:00:00Z', publishedAt: null },
            ],
          },
        ],
      }),
      'me',
    ),
  ).toEqual([
    { id: 'r1c1', at: at('2026-07-05T00:00:00Z') },
    { id: 'r1c2', at: at('2026-07-05T00:00:00Z') },
  ]);
});

test('texts without a mention of the user, and the user own texts, never count', () => {
  expect(findMentions(mentionDetails({ body: 'nothing here' }), 'me')).toEqual([]);

  expect(findMentions(mentionDetails({ body: '@meg @me-bot foo@me.com org/@me' }), 'me')).toEqual([]);

  expect(
    findMentions(
      mentionDetails({
        reviews: [
          {
            id: 'r1',
            body: [
              '<!-- AUTOMATION_ID: 123 | pinging @me -->',
              '**Additional reviewers:** Not needed, `@bob` is already requested and `@me` approved.',
              '```',
              'git log --author=@me',
              '```',
            ].join('\n'),
            at: '2026-07-03T00:00:00Z',
          },
        ],
      }),
      'me',
    ),
  ).toEqual([]);

  expect(findMentions(mentionDetails({ body: 'see `@bob` and @me' }), 'me')).toEqual([
    { id: 'pr', at: at('2026-07-01T00:00:00Z') },
  ]);

  expect(
    findMentions(
      mentionDetails({
        body: 'note to self @me',
        author: 'me',
        comments: [{ id: 'c1', body: '@me later', at: '2026-07-02T00:00:00Z', login: 'me' }],
        reviews: [
          { id: 'r1', body: '@me', at: '2026-07-03T00:00:00Z', login: 'me' },
          {
            id: 'r2',
            at: '2026-07-04T00:00:00Z',
            login: 'me',
            comments: [{ id: 'r2c1', body: '@me', at: '2026-07-04T00:00:00Z', login: 'me' }],
          },
        ],
      }),
      'me',
    ),
  ).toEqual([]);

  expect(
    findMentions(
      mentionDetails({
        reviews: [{ id: 'r1', at: null, comments: [{ id: 'r1c1', body: '@me', at: '2026-07-04T00:00:00Z' }] }],
      }),
      'me',
    ),
  ).toEqual([]);

  expect(
    findMentions(
      mentionDetails({ comments: [{ id: 'c1', body: '@me', at: '2026-07-02T00:00:00Z', login: null }] }),
      'me',
    ),
  ).toEqual([{ id: 'c1', at: at('2026-07-02T00:00:00Z') }]);
});

test('stripping code and comments follows how GitHub renders them', () => {
  expect(stripCodeAndComments('a `x` b')).toBe('a   b');
  expect(stripCodeAndComments('a ``x ` y`` b')).toBe('a   b');
  expect(stripCodeAndComments('a `x``y` b')).toBe('a   b');

  expect(stripCodeAndComments('a ` b @me')).toBe('a ` b @me');

  expect(stripCodeAndComments('a\n```js\n@me\n```\nb')).toBe('a\n \nb');
  expect(stripCodeAndComments('a\n~~~\n@me\n~~~~\nb')).toBe('a\n \nb');
  expect(stripCodeAndComments('a\n```\n@me\n~~~\nb')).toBe('a\n ');

  expect(stripCodeAndComments('```\n` <!--\n```\n@me')).toBe(' \n@me');
  expect(stripCodeAndComments('<!-- ` -->@me`')).toBe(' @me`');

  expect(stripCodeAndComments('x <!-- @me --> y')).toBe('x   y');
  expect(stripCodeAndComments('x <!--\n@me\n--> y')).toBe('x   y');

  expect(stripCodeAndComments('cc @me, thanks')).toBe('cc @me, thanks');
});
