/**
 * Fake gh CLI for regression-testing pr-stats without network access.
 * It serves canned search results and GraphQL responses so the pr-stats
 * output is deterministic across runs, except for the pending and
 * reviewing durations, which depend on the current time.
 */

const args = process.argv.slice(2);

/**
 * The teams testuser belongs to, as the teams query pages them by their
 * combined org/slug. The first organization page holds acme, whose first
 * team page holds the backend team and points at a second team page with
 * the oncall team, and the page points at a second organization page,
 * which holds globex with the platform team. A lookup that stops at the
 * first pages therefore misses two of the three teams. The team requests
 * below name acme/backend, so they classify as team cycles.
 */
const ORGANIZATION_PAGES = [
  {
    after: null,
    endCursor: 'orgs-1',
    nodes: [{ login: 'acme', teams: ['acme/backend'], endCursor: 'acme-teams-1' }],
  },
  {
    after: 'orgs-1',
    endCursor: null,
    nodes: [{ login: 'globex', teams: ['globex/platform'], endCursor: null }],
  },
];

const TEAM_PAGES = [{ organization: 'acme', after: 'acme-teams-1', teams: ['acme/oncall'], endCursor: null }];

/**
 * Builds one page of a teams connection from the slugs on it and the
 * cursor of the page after it, null on the last page.
 */
function teamPage(teams, endCursor) {
  return {
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
    nodes: teams.map((combinedSlug) => {
      return { combinedSlug };
    }),
  };
}

/**
 * Review timelines keyed by PR. A request names a user by login or a
 * team by its combined slug, and the outstanding list holds the review
 * requests still open on the PR the same way, which the team
 * classification checks a team request against. A PR without the list
 * has no outstanding request.
 */
const REVIEW_TIMELINES = {
  'acme/api#1': {
    additions: 150,
    deletions: 40,
    requests: [{ at: '2026-07-01T09:00:00Z', login: 'testuser' }],
    reviews: [{ login: 'testuser', at: '2026-07-01T15:00:00Z', state: 'APPROVED' }],
  },
  'acme/api#2': {
    additions: 600,
    deletions: 100,
    requests: [{ at: '2026-07-03T10:00:00Z', login: 'testuser' }],
    reviews: [{ login: 'testuser', at: '2026-07-06T10:00:00Z', state: 'CHANGES_REQUESTED' }],
  },
  'acme/web#3': {
    additions: 250,
    deletions: 30,
    requests: [{ at: '2026-08-23T09:00:00Z', login: 'testuser' }],
    reviews: [],
    outstanding: [{ login: 'testuser' }],
  },
  'acme/web#4': {
    additions: 400,
    deletions: 200,
    requests: [{ at: '2026-06-20T09:00:00Z', login: 'testuser' }],
    reviews: [{ login: 'otheruser', at: '2026-06-21T09:00:00Z', state: 'APPROVED' }],
  },
  'acme/api#5': {
    additions: 80,
    deletions: 10,
    requests: [{ at: '2026-07-04T09:00:00Z', login: 'someoneelse' }],
    reviews: [{ login: 'testuser', at: '2026-07-05T12:00:00Z', state: 'COMMENTED' }],
  },
  'acme/web#6': {
    additions: 2,
    deletions: 2,
    requests: [{ at: '2026-07-15T13:30:00Z', login: 'testuser' }],
    reviews: [{ login: 'testuser', at: '2026-07-15T13:45:00Z', state: 'APPROVED' }],
  },
  'acme/api#7': {
    additions: 900,
    deletions: 700,
    requests: [{ at: '2026-08-20T09:00:00Z', login: 'testuser' }],
    reviews: [],
    outstanding: [{ login: 'testuser' }],
  },
  'acme/api#8': {
    additions: 120,
    deletions: 15,
    requests: [],
    reviews: [{ login: 'testuser', at: '2026-08-24T09:00:00Z', state: 'COMMENTED' }],
  },
  'acme/api#9': {
    /**
     * Only the backend team was asked, and the request is still open, so
     * the PR sits in the team section of the awaiting queue and stays out
     * of the direct counts.
     */
    additions: 210,
    deletions: 35,
    requests: [{ at: '2026-08-25T09:00:00Z', team: 'acme/backend' }],
    reviews: [],
    outstanding: [{ team: 'acme/backend' }],
  },
  'acme/web#16': {
    /**
     * The backend team was asked and a teammate answered, which cleared
     * the team's request without a trace on the timeline, so the PR
     * classifies as inaccessible like a request of a team testuser is
     * not on.
     */
    additions: 60,
    deletions: 12,
    requests: [{ at: '2026-08-10T09:00:00Z', team: 'acme/backend' }],
    reviews: [{ login: 'otheruser', at: '2026-08-11T09:00:00Z', state: 'APPROVED' }],
  },
};

const SIZES = {
  'acme/api#10': {
    additions: 120,
    deletions: 30,
    changedFiles: 6,
    mergedAt: '2026-06-08T10:00:00Z',
    closedAt: '2026-06-08T10:00:00Z',
    comments: { totalCount: 1 },
    reviews: {
      nodes: [{ author: { login: 'alice' }, submittedAt: '2026-06-05T16:00:00Z', comments: { totalCount: 2 } }],
    },
  },
  'acme/api#11': {
    additions: 800,
    deletions: 200,
    changedFiles: 25,
    mergedAt: '2026-06-26T10:00:00Z',
    closedAt: '2026-06-26T10:00:00Z',
    comments: { totalCount: 4 },
    reviews: {
      nodes: [
        { author: { login: 'alice' }, submittedAt: '2026-06-23T10:00:00Z', comments: { totalCount: 7 } },
        { author: { login: 'bob' }, submittedAt: '2026-06-24T10:00:00Z', comments: { totalCount: 5 } },
      ],
    },
  },
  'acme/web#12': {
    additions: 40,
    deletions: 5,
    changedFiles: 2,
    mergedAt: null,
    closedAt: '2026-07-03T10:00:00Z',
    comments: { totalCount: 0 },
    reviews: { nodes: [] },
  },
  'acme/web#13': {
    /**
     * The trailing zero-comment reviews push the reviewer leaderboard
     * one row past its cap, so the tests can drive the x expansion.
     * Their empty comment counts keep every comment total unchanged.
     */
    additions: 2500,
    deletions: 400,
    changedFiles: 48,
    mergedAt: null,
    closedAt: null,
    comments: { totalCount: 2 },
    reviews: {
      nodes: [
        { author: { login: 'alice' }, submittedAt: '2026-07-21T10:00:00Z', comments: { totalCount: 6 } },
        { author: { login: 'carol' }, submittedAt: '2026-07-22T10:00:00Z', comments: { totalCount: 0 } },
        { author: { login: 'dave' }, submittedAt: '2026-07-22T11:00:00Z', comments: { totalCount: 0 } },
        { author: { login: 'erin' }, submittedAt: '2026-07-22T12:00:00Z', comments: { totalCount: 0 } },
        { author: { login: 'frank' }, submittedAt: '2026-07-22T13:00:00Z', comments: { totalCount: 0 } },
        { author: { login: 'grace' }, submittedAt: '2026-07-22T14:00:00Z', comments: { totalCount: 0 } },
        { author: { login: 'heidi' }, submittedAt: '2026-07-22T15:00:00Z', comments: { totalCount: 0 } },
        { author: { login: 'ivan' }, submittedAt: '2026-07-22T16:00:00Z', comments: { totalCount: 0 } },
      ],
    },
  },
  'acme/api#14': {
    /**
     * The only review here is the author replying to their own threads,
     * which GitHub records as a review too, so this PR counts as merged
     * unreviewed and stays off the leaderboard.
     */
    additions: 300,
    deletions: 100,
    changedFiles: 12,
    mergedAt: '2026-08-03T16:00:00Z',
    closedAt: '2026-08-03T16:00:00Z',
    comments: { totalCount: 0 },
    reviews: {
      nodes: [{ author: { login: 'testuser' }, submittedAt: '2026-08-02T10:00:00Z', comments: { totalCount: 3 } }],
    },
  },
};

/**
 * Builds one text that can carry a mention, published when it was
 * written and never edited.
 */
function text(id, body, at, login) {
  return { id, body, createdAt: at, publishedAt: at, lastEditedAt: null, author: { login } };
}

/**
 * Builds one submitted review with its inline comments.
 */
function review(id, body, at, login, comments = []) {
  return { id, body, submittedAt: at, lastEditedAt: null, author: { login }, comments };
}

/**
 * Number of entries the fake serves per page of a text list. The real
 * API pages at a hundred, but the small size makes every list of three
 * run past its first page, so the fetch has to follow the cursors to
 * find the mentions below.
 */
const MENTION_PAGE = 2;

/**
 * Texts of the PRs the mentions search returns, keyed like the timelines
 * and holding the complete lists the pages are cut from. The mention
 * fetch scans them for @testuser, so web#13 counts from alice's second
 * comment and api#7 from bob's third inline comment on the third review,
 * both of which sit beyond the first page of their list. The author's
 * own mention on web#13 and the longer login on web#3 never count.
 */
const MENTIONS = {
  'acme/web#13': {
    ...text('web13', 'Redesign of the dashboard. @testuser owns the follow-up.', '2026-07-20T10:00:00Z', 'testuser'),
    comments: [
      text('web13-c1', 'Starting on the review.', '2026-08-21T10:00:00Z', 'alice'),
      text('web13-c2', 'The charts look off on narrow screens.', '2026-08-23T11:00:00Z', 'bob'),
      text('web13-c3', '@testuser can you split the chart changes out?', '2026-08-25T14:00:00Z', 'alice'),
    ],
    reviews: [],
  },
  'acme/api#7': {
    ...text('api7', 'Refactors the billing worker.', '2026-08-19T10:00:00Z', 'carol'),
    comments: [],
    reviews: [
      review('api7-r1', 'Nice cleanup.', '2026-08-20T10:00:00Z', 'alice'),
      review('api7-r2', '', '2026-08-22T10:00:00Z', 'dave', [
        text('api7-r2-c1', 'Nit, rename this.', '2026-08-22T10:00:00Z', 'dave'),
      ]),
      review('api7-r3', '', '2026-08-24T16:00:00Z', 'bob', [
        text('api7-r3-c1', 'Typo here.', '2026-08-24T15:50:00Z', 'bob'),
        text('api7-r3-c2', 'Log the attempt count.', '2026-08-24T15:55:00Z', 'bob'),
        text('api7-r3-c3', '@testuser is this retry safe?', '2026-08-24T16:00:00Z', 'bob'),
      ]),
    ],
  },
  'acme/web#3': {
    ...text('web3', 'Adds pagination. cc @testuser-bot', '2026-08-22T10:00:00Z', 'dave'),
    comments: [],
    reviews: [],
  },
};

/**
 * Cuts one page out of a complete list. A cursor is the index of the last
 * entry of the page before, as a string, so the page after it starts one
 * past that index.
 */
function page(list, after) {
  const start = after === undefined ? 0 : Number(after) + 1;
  const nodes = list.slice(start, start + MENTION_PAGE);

  return {
    pageInfo: {
      hasNextPage: start + nodes.length < list.length,
      endCursor: nodes.length === 0 ? null : String(start + nodes.length - 1),
    },
    nodes,
  };
}

/**
 * Cuts one page out of the reviews list, with the first page of each
 * review's inline comments nested inside the way the real API returns
 * it.
 */
function reviewsPage(reviews, after) {
  const cut = page(reviews, after);

  return {
    ...cut,
    nodes: cut.nodes.map((entry) => {
      return { ...entry, comments: page(entry.comments) };
    }),
  };
}

/**
 * Answers the mention queries. The first call asks for the first pages of
 * every list of a batch of PRs under pr-numbered aliases, and the
 * follow-up calls ask for one more page of a list under a comments or
 * reviews alias, or of one review's inline comments through its node id.
 */
function handleMentionQuery(query) {
  const data = {};

  const firstPages = /pr(\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)\s*\{\s*pullRequest\(number: (\d+)\)/g;

  for (const match of query.matchAll(firstPages)) {
    const pr = MENTIONS[`${match[2]}/${match[3]}#${match[4]}`];

    data[`pr${match[1]}`] = {
      pullRequest: pr ? { ...pr, comments: page(pr.comments), reviews: reviewsPage(pr.reviews) } : null,
    };
  }

  const nextPages =
    /(comments|reviews): repository\(owner: "([^"]+)", name: "([^"]+)"\)\s*\{\s*pullRequest\(number: (\d+)\)\s*\{\s*\w+\(first: \d+, after: "(\d+)"\)/g;

  for (const match of query.matchAll(nextPages)) {
    const pr = MENTIONS[`${match[2]}/${match[3]}#${match[4]}`];
    const list = match[1];

    data[list] = {
      pullRequest: pr
        ? { [list]: list === 'reviews' ? reviewsPage(pr.reviews, match[5]) : page(pr.comments, match[5]) }
        : null,
    };
  }

  const reviewPages =
    /(review\d+): node\(id: "([^"]+)"\)\s*\{\s*\.\.\. on PullRequestReview \{\s*comments\(first: \d+, after: "(\d+)"\)/g;

  for (const match of query.matchAll(reviewPages)) {
    const entry = Object.values(MENTIONS)
      .flatMap((pr) => pr.reviews)
      .find((candidate) => candidate.id === match[2]);

    data[match[1]] = entry ? { comments: page(entry.comments, match[3]) } : null;
  }

  return data;
}

function searchItem(repo, number, title, createdAt, state, updatedAt = createdAt) {
  return {
    number,
    repository: { nameWithOwner: repo },
    title,
    url: `https://github.com/${repo}/pull/${number}`,
    createdAt,
    updatedAt,
    isDraft: false,
    state,
  };
}

const SEARCHES = {
  /**
   * The review-requested search also returns the PRs where only a team
   * of the user is asked, and keeps returning web#16 here although a
   * teammate already answered, so the classification has to tell the
   * two team requests apart by the outstanding review requests.
   */
  '--review-requested': [
    searchItem('acme/web', 3, 'Add pagination to the list view', '2026-08-22T10:00:00Z', 'open'),
    searchItem('acme/web', 4, 'Rework session handling', '2026-06-19T10:00:00Z', 'closed'),
    searchItem('acme/api', 7, 'Refactor the billing worker', '2026-08-19T10:00:00Z', 'open'),
    searchItem('acme/api', 9, 'Migrate the queue consumers', '2026-08-25T08:00:00Z', 'open'),
    searchItem('acme/web', 16, 'Tidy the settings layout', '2026-08-09T10:00:00Z', 'open'),
  ],
  '--reviewed-by': [
    searchItem('acme/api', 1, 'Fix retry logic in the api client', '2026-06-30T10:00:00Z', 'closed'),
    searchItem('acme/api', 2, 'Introduce request signing', '2026-07-02T10:00:00Z', 'closed'),
    searchItem('acme/api', 5, 'Tighten input validation', '2026-07-03T10:00:00Z', 'closed'),
    searchItem('acme/web', 6, 'Fix typo in settings page', '2026-07-15T13:00:00Z', 'closed'),
    searchItem('acme/api', 8, 'Add caching to the sessions store', '2026-08-21T10:00:00Z', 'open'),
  ],
  '--author': [
    searchItem('acme/api', 10, 'Add health check endpoint', '2026-06-05T10:00:00Z', 'closed'),
    searchItem('acme/api', 11, 'Migrate storage layer to v2', '2026-06-20T10:00:00Z', 'closed'),
    searchItem('acme/web', 12, 'Bump dependencies', '2026-07-01T10:00:00Z', 'closed'),
    searchItem('acme/web', 13, 'Redesign the dashboard', '2026-07-20T10:00:00Z', 'open'),
    searchItem('acme/api', 14, 'Add rate limiting middleware', '2026-08-01T10:00:00Z', 'closed'),
  ],

  /**
   * The mentions search runs two queries, one through the mentions index
   * and one that names the login as a quoted text term bounded by the
   * involves flag. Both return api#7, so the union has to count it once.
   */
  '--mentions': [
    searchItem('acme/web', 13, 'Redesign the dashboard', '2026-07-20T10:00:00Z', 'open', '2026-08-25T14:00:00Z'),
    searchItem('acme/api', 7, 'Refactor the billing worker', '2026-08-19T10:00:00Z', 'open', '2026-08-24T16:00:00Z'),
  ],
  '--involves': [
    searchItem('acme/api', 7, 'Refactor the billing worker', '2026-08-19T10:00:00Z', 'open', '2026-08-24T16:00:00Z'),
    searchItem(
      'acme/web',
      3,
      'Add pagination to the list view',
      '2026-08-22T10:00:00Z',
      'open',
      '2026-08-23T09:00:00Z',
    ),
  ],
};

/**
 * Maps a canned reviewer, a login or a team slug, onto the User or Team
 * union node the API returns for a requested reviewer.
 */
function requestedReviewer(reviewer) {
  if (reviewer.login !== undefined) {
    return { login: reviewer.login };
  }

  return { slug: reviewer.team.split('/')[1], combinedSlug: reviewer.team };
}

/**
 * Answers the teams queries, the one that lists the organizations of one
 * login with the first team page of each, and the follow-up that asks
 * one organization for a later team page. Both name the login in the
 * userLogins filter and page with an after cursor. Only testuser is
 * known, and any other login fails the way a token without the read:org
 * scope would, so the tests can drive the soft failure of the team
 * lookup. A cursor the canned pages do not know fails too, which catches
 * a lookup that pages from the wrong place.
 */
function handleTeamsQuery(query) {
  const login = /userLogins: \["([^"]+)"\]/.exec(query)?.[1];

  if (login !== 'testuser') {
    process.stderr.write(`fake gh cannot resolve the teams of ${login}\n`);
    process.exit(1);
  }

  const after = /after: "([^"]+)"/.exec(query)?.[1] ?? null;
  const organization = /organization\(login: "([^"]+)"\)/.exec(query)?.[1];

  if (organization !== undefined) {
    const page = TEAM_PAGES.find((candidate) => candidate.organization === organization && candidate.after === after);

    if (page === undefined) {
      process.stderr.write(`fake gh has no team page of ${organization} after ${after}\n`);
      process.exit(1);
    }

    return { organization: { teams: teamPage(page.teams, page.endCursor) } };
  }

  const page = ORGANIZATION_PAGES.find((candidate) => candidate.after === after);

  if (page === undefined) {
    process.stderr.write(`fake gh has no organization page after ${after}\n`);
    process.exit(1);
  }

  return {
    user: {
      organizations: {
        pageInfo: { hasNextPage: page.endCursor !== null, endCursor: page.endCursor },
        nodes: page.nodes.map((node) => {
          return { login: node.login, teams: teamPage(node.teams, node.endCursor) };
        }),
      },
    },
  };
}

function handleGraphql(query) {
  const aliasPattern = /pr(\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)\s*\{\s*pullRequest\(number: (\d+)\)/g;

  // both team queries filter the teams by the login, which no PR query does
  if (query.includes('userLogins')) {
    return JSON.stringify({ data: handleTeamsQuery(query) });
  }

  /**
   * The review and size queries both fetch additions and deletions, so
   * the size query is the one asking for the changed-files counter, and
   * the mention query is the one asking for the PR body.
   */
  const wantsSizes = query.includes('changedFiles');

  if (/\bbody\b/.test(query)) {
    return JSON.stringify({ data: handleMentionQuery(query) });
  }

  const data = {};

  for (const match of query.matchAll(aliasPattern)) {
    const alias = `pr${match[1]}`;
    const key = `${match[2]}/${match[3]}#${match[4]}`;

    if (wantsSizes) {
      data[alias] = { pullRequest: SIZES[key] ?? null };
      continue;
    }

    const timeline = REVIEW_TIMELINES[key];

    if (!timeline) {
      data[alias] = null;
      continue;
    }

    data[alias] = {
      pullRequest: {
        additions: timeline.additions,
        deletions: timeline.deletions,
        timelineItems: {
          nodes: timeline.requests.map((request) => {
            return {
              createdAt: request.at,
              requestedReviewer: requestedReviewer(request),
            };
          }),
        },
        reviews: {
          nodes: timeline.reviews.map((review) => {
            return {
              author: { login: review.login },
              submittedAt: review.at,
              state: review.state,
            };
          }),
        },
        reviewRequests: {
          nodes: (timeline.outstanding ?? []).map((reviewer) => {
            return { requestedReviewer: requestedReviewer(reviewer) };
          }),
        },
      },
    };
  }

  return JSON.stringify({ data });
}

if (args[0] === 'auth' && args[1] === 'token') {
  process.stdout.write('fake-token\n');
} else if (args[0] === 'api' && args[1] === 'user') {
  process.stdout.write('testuser\n');
} else if (args[0] === 'api' && args[1] === 'graphql') {
  const queryArg = args.find((arg) => arg.startsWith('query='));

  process.stdout.write(handleGraphql(queryArg.slice('query='.length)));
} else if (args[0] === 'search' && args[1] === 'prs') {
  const mode = args.find((arg) => arg in SEARCHES);
  const user = args[args.indexOf(mode) + 1];

  /**
   * The real review searches exclude the user's own PRs with a negated
   * author term, because GitHub records inline replies as reviews. The
   * fake insists on that term so a search that drops it fails every test
   * that loads through it. The authored and mentions searches keep the
   * user's own PRs on purpose, so the fake refuses the term there.
   */
  const excludesOwn = args.includes(`-author:${user}`);
  const reviewSearch = mode === '--review-requested' || mode === '--reviewed-by';

  if (reviewSearch !== excludesOwn) {
    process.stderr.write(`fake gh got a ${mode} search with the wrong author exclusion: ${args.join(' ')}\n`);
    process.exit(1);
  }

  process.stdout.write(JSON.stringify(SEARCHES[mode]));
} else {
  process.stderr.write(`fake gh got unexpected args: ${args.join(' ')}\n`);
  process.exit(1);
}
