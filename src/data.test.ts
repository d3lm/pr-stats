import { expect, test } from 'bun:test';
import { classifyPr, findMentions, type ReviewPr } from './data';
import type { PrDetails, PrMentionDetails } from './github';

const pr: ReviewPr = {
  repo: 'acme/api',
  number: 1,
  title: 'a',
  url: 'https://example.com/1',
  state: 'open',
  createdAt: new Date('2026-07-01T00:00:00Z'),
};

/**
 * Builds a PrDetails timeline from request and review timestamps, all
 * attributed to the given user unless a login is passed explicitly,
 * and all approvals unless a state overrides it. The size stays fixed
 * at 120 added and 30 removed lines, so every reviewed cycle carries
 * 150 lines.
 */
function details(requests: string[], reviews: (string | { at: string; login?: string; state?: string })[]): PrDetails {
  return {
    additions: 120,
    deletions: 30,
    timelineItems: {
      nodes: requests.map((at) => {
        return { createdAt: at, requestedReviewer: { login: 'me' } };
      }),
    },
    reviews: {
      nodes: reviews.map((review) => {
        const { at, login = 'me', state = 'APPROVED' } = typeof review === 'string' ? { at: review } : review;

        return { author: { login }, submittedAt: at, state };
      }),
    },
  };
}

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

/**
 * One text on a PR as the mention tests describe it. The text is
 * published when it was written unless a publication time says
 * otherwise, never edited unless an edit time says otherwise, and by an
 * author other than the user under test unless a login says otherwise,
 * with null standing for a deleted account.
 */
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

/**
 * Builds the texts of one PR for the mention scan. The body is the text
 * with the id pr and counts from the given creation time, and the
 * comments and reviews default to an author other than the user under
 * test.
 */
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
  // the body alone counts from the PR's creation
  expect(findMentions(mentionDetails({ body: 'cc @me' }), 'me')).toEqual([
    { id: 'pr', at: at('2026-07-01T00:00:00Z') },
  ]);

  // conversation comments, review bodies, and inline review comments count with their own times
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

  // logins compare case-insensitively the way GitHub treats them
  expect(findMentions(mentionDetails({ body: 'cc @Me' }), 'me')).toEqual([
    { id: 'pr', at: at('2026-07-01T00:00:00Z') },
  ]);
});

test('a text becomes visible when it is published or edited, not when it was written', () => {
  /**
   * A body edited to add the mention counts from the edit, and so do an
   * edited comment and an edited review, because the edit is how the
   * mention got there.
   */
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

  /**
   * An inline comment drafted days before its review was submitted only
   * became visible with the review, so it counts from the later of its
   * publication and the submission. A missing publication time falls
   * back to the submission.
   */
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

  // a longer login, an email address, and a path never count as the mention
  expect(findMentions(mentionDetails({ body: '@meg @me-bot foo@me.com org/@me' }), 'me')).toEqual([]);

  // your own words are not news, in the body, a comment, a review, or an inline comment
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

  // a review that was never submitted is a draft and drops out with its comments
  expect(
    findMentions(
      mentionDetails({
        reviews: [{ id: 'r1', at: null, comments: [{ id: 'r1c1', body: '@me', at: '2026-07-04T00:00:00Z' }] }],
      }),
      'me',
    ),
  ).toEqual([]);

  // a deleted account leaves the author null, and its mention still counts
  expect(
    findMentions(
      mentionDetails({ comments: [{ id: 'c1', body: '@me', at: '2026-07-02T00:00:00Z', login: null }] }),
      'me',
    ),
  ).toEqual([{ id: 'c1', at: at('2026-07-02T00:00:00Z') }]);
});
