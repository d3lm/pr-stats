const args = process.argv.slice(2);

// a teams lookup that stops at the first organization or team page misses two of the three teams
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

function teamPage(teams, endCursor) {
  return {
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
    nodes: teams.map((combinedSlug) => {
      return { combinedSlug };
    }),
  };
}

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
    additions: 210,
    deletions: 35,
    requests: [{ at: '2026-08-25T09:00:00Z', team: 'acme/backend' }],
    reviews: [],
    outstanding: [{ team: 'acme/backend' }],
  },
  'acme/web#16': {
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
    // the zero-comment reviews push the reviewer leaderboard one row past its cap
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
    // the author's replies to their own threads count as a review on GitHub
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

function text(id, body, at, login) {
  return { id, body, createdAt: at, publishedAt: at, lastEditedAt: null, author: { login } };
}

function review(id, body, at, login, comments = []) {
  return { id, body, submittedAt: at, lastEditedAt: null, author: { login }, comments };
}

// a page size this small makes the mention fetch follow cursors
const MENTION_PAGE = 2;

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

function reviewsPage(reviews, after) {
  const cut = page(reviews, after);

  return {
    ...cut,
    nodes: cut.nodes.map((entry) => {
      return { ...entry, comments: page(entry.comments) };
    }),
  };
}

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
  review: [
    searchItem('acme/web', 3, 'Add pagination to the list view', '2026-08-22T10:00:00Z', 'open'),
    searchItem('acme/web', 4, 'Rework session handling', '2026-06-19T10:00:00Z', 'closed'),
    searchItem('acme/api', 7, 'Refactor the billing worker', '2026-08-19T10:00:00Z', 'open'),
    searchItem('acme/api', 9, 'Migrate the queue consumers', '2026-08-25T08:00:00Z', 'open'),
    searchItem('acme/web', 16, 'Tidy the settings layout', '2026-08-09T10:00:00Z', 'open'),
    searchItem('acme/api', 1, 'Fix retry logic in the api client', '2026-06-30T10:00:00Z', 'closed'),
    searchItem('acme/api', 2, 'Introduce request signing', '2026-07-02T10:00:00Z', 'closed'),
    searchItem('acme/api', 5, 'Tighten input validation', '2026-07-03T10:00:00Z', 'closed'),
    searchItem('acme/web', 6, 'Fix typo in settings page', '2026-07-15T13:00:00Z', 'closed'),
    searchItem('acme/api', 8, 'Add caching to the sessions store', '2026-08-21T10:00:00Z', 'open'),
  ],
  requested: [
    searchItem('acme/web', 3, 'Add pagination to the list view', '2026-08-22T10:00:00Z', 'open'),
    searchItem('acme/api', 7, 'Refactor the billing worker', '2026-08-19T10:00:00Z', 'open'),
    searchItem('acme/api', 9, 'Migrate the queue consumers', '2026-08-25T08:00:00Z', 'open'),
    searchItem('acme/web', 16, 'Tidy the settings layout', '2026-08-09T10:00:00Z', 'open'),
  ],
  authored: [
    searchItem('acme/api', 10, 'Add health check endpoint', '2026-06-05T10:00:00Z', 'closed'),
    searchItem('acme/api', 11, 'Migrate storage layer to v2', '2026-06-20T10:00:00Z', 'closed'),
    searchItem('acme/web', 12, 'Bump dependencies', '2026-07-01T10:00:00Z', 'closed'),
    searchItem('acme/web', 13, 'Redesign the dashboard', '2026-07-20T10:00:00Z', 'open'),
    searchItem('acme/api', 14, 'Add rate limiting middleware', '2026-08-01T10:00:00Z', 'closed'),
  ],
  mentioned: [
    searchItem('acme/web', 13, 'Redesign the dashboard', '2026-07-20T10:00:00Z', 'open', '2026-08-25T14:00:00Z'),
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

if (process.env.PR_STATS_TEST_OLD_REQUEST === '1') {
  REVIEW_TIMELINES['acme/api#30'] = {
    additions: 40,
    deletions: 8,
    requests: [
      { at: '2025-11-03T09:00:00Z', login: 'testuser' },
      { at: '2026-08-27T09:00:00Z', login: 'testuser' },
    ],
    reviews: [{ login: 'testuser', at: '2025-11-04T09:00:00Z', state: 'APPROVED' }],
    outstanding: [{ login: 'testuser' }],
  };

  SEARCHES.requested.push(searchItem('acme/api', 30, 'Retire the legacy importer', '2025-11-01T10:00:00Z', 'open'));
}

if (process.env.PR_STATS_TEST_SECOND_OWNER === '1') {
  for (const [repo, number, title] of [
    ['globex/portal', 40, 'Add the partner login'],
    ['globex/billing', 41, 'Round invoice totals'],
  ]) {
    REVIEW_TIMELINES[`${repo}#${number}`] = {
      additions: 30,
      deletions: 5,
      requests: [{ at: '2026-08-24T09:00:00Z', login: 'testuser' }],
      reviews: [],
      outstanding: [{ login: 'testuser' }],
    };

    const item = searchItem(repo, number, title, '2026-08-23T10:00:00Z', 'open');

    SEARCHES.review.push(item);
    SEARCHES.requested.push(item);
  }
}

function searchMode(query) {
  if (query.includes('reviewed-by:')) {
    return 'review';
  }

  if (query.includes('review-requested:')) {
    return 'requested';
  }

  if (query.includes('mentions:')) {
    return 'mentioned';
  }

  return 'authored';
}

function restSearchItem(item) {
  return {
    number: item.number,
    repository_url: `https://api.github.com/repos/${item.repository.nameWithOwner}`,
    title: item.title,
    html_url: item.url,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    draft: item.isDraft,
    state: item.state,
  };
}

function handleSearch(fields) {
  const query = fields.q ?? '';
  const mode = searchMode(query);

  if (fields.advanced_search !== 'true') {
    process.stderr.write(`fake gh got a search without the advanced syntax: ${query}\n`);
    process.exit(1);
  }

  const excludesOwn = query.includes('-author:testuser');

  if ((mode === 'review' || mode === 'requested') !== excludesOwn) {
    process.stderr.write(`fake gh got a ${mode} search with the wrong author exclusion: ${query}\n`);
    process.exit(1);
  }

  if (mode === 'requested' && (query.includes('created:') || !query.includes('is:open'))) {
    process.stderr.write(`fake gh got a request search with the wrong bounds: ${query}\n`);
    process.exit(1);
  }

  const items = SEARCHES[mode];
  const perPage = Number(fields.per_page ?? 100);
  const page = Number(fields.page ?? 1);
  const start = (page - 1) * perPage;

  return JSON.stringify({
    total_count: items.length,
    items: items.slice(start, start + perPage).map((item) => restSearchItem(item)),
  });
}

function fieldParams() {
  const fields = {};

  for (const [i, arg] of args.entries()) {
    if (arg === '-f' && i + 1 < args.length) {
      const [key, ...rest] = args[i + 1].split('=');

      fields[key] = rest.join('=');
    }
  }

  return fields;
}

function requestedReviewer(reviewer) {
  if (reviewer.login !== undefined) {
    return { login: reviewer.login };
  }

  return { slug: reviewer.team.split('/')[1], combinedSlug: reviewer.team };
}

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

  if (query.includes('userLogins')) {
    return JSON.stringify({ data: handleTeamsQuery(query) });
  }

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
} else if (args[0] === 'api' && args[1] === 'search/issues') {
  process.stdout.write(handleSearch(fieldParams()));
} else {
  process.stderr.write(`fake gh got unexpected args: ${args.join(' ')}\n`);
  process.exit(1);
}
