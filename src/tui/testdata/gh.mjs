/**
 * Fake gh CLI for regression-testing pr-stats without network access.
 * It serves canned search results and GraphQL responses so the pr-stats
 * output is deterministic across runs, except for pending review
 * durations, which depend on the current time.
 */

const args = process.argv.slice(2);

const REVIEW_TIMELINES = {
  'acme/api#1': {
    requests: [{ at: '2026-07-01T09:00:00Z', login: 'testuser' }],
    reviews: [{ login: 'testuser', at: '2026-07-01T15:00:00Z', state: 'APPROVED' }],
  },
  'acme/api#2': {
    requests: [{ at: '2026-07-03T10:00:00Z', login: 'testuser' }],
    reviews: [{ login: 'testuser', at: '2026-07-06T10:00:00Z', state: 'CHANGES_REQUESTED' }],
  },
  'acme/web#3': {
    requests: [{ at: '2026-08-23T09:00:00Z', login: 'testuser' }],
    reviews: [],
  },
  'acme/web#4': {
    requests: [{ at: '2026-06-20T09:00:00Z', login: 'testuser' }],
    reviews: [{ login: 'otheruser', at: '2026-06-21T09:00:00Z', state: 'APPROVED' }],
  },
  'acme/api#5': {
    requests: [{ at: '2026-07-04T09:00:00Z', login: 'someoneelse' }],
    reviews: [{ login: 'testuser', at: '2026-07-05T12:00:00Z', state: 'COMMENTED' }],
  },
  'acme/web#6': {
    requests: [{ at: '2026-07-15T13:30:00Z', login: 'testuser' }],
    reviews: [{ login: 'testuser', at: '2026-07-15T13:45:00Z', state: 'APPROVED' }],
  },
  'acme/api#7': {
    requests: [{ at: '2026-08-20T09:00:00Z', login: 'testuser' }],
    reviews: [],
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
    reviews: { nodes: [{ comments: { totalCount: 2 } }] },
  },
  'acme/api#11': {
    additions: 800,
    deletions: 200,
    changedFiles: 25,
    mergedAt: '2026-06-26T10:00:00Z',
    closedAt: '2026-06-26T10:00:00Z',
    comments: { totalCount: 4 },
    reviews: { nodes: [{ comments: { totalCount: 7 } }, { comments: { totalCount: 5 } }] },
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
    additions: 2500,
    deletions: 400,
    changedFiles: 48,
    mergedAt: null,
    closedAt: null,
    comments: { totalCount: 2 },
    reviews: { nodes: [{ comments: { totalCount: 6 } }] },
  },
  'acme/api#14': {
    additions: 300,
    deletions: 100,
    changedFiles: 12,
    mergedAt: '2026-08-03T16:00:00Z',
    closedAt: '2026-08-03T16:00:00Z',
    comments: { totalCount: 0 },
    reviews: { nodes: [{ comments: { totalCount: 3 } }] },
  },
};

function searchItem(repo, number, title, createdAt, state) {
  return {
    number,
    repository: { nameWithOwner: repo },
    title,
    url: `https://github.com/${repo}/pull/${number}`,
    createdAt,
    isDraft: false,
    state,
  };
}

const SEARCHES = {
  '--review-requested': [
    searchItem('acme/web', 3, 'Add pagination to the list view', '2026-08-22T10:00:00Z', 'open'),
    searchItem('acme/web', 4, 'Rework session handling', '2026-06-19T10:00:00Z', 'closed'),
    searchItem('acme/api', 7, 'Refactor the billing worker', '2026-08-19T10:00:00Z', 'open'),
  ],
  '--reviewed-by': [
    searchItem('acme/api', 1, 'Fix retry logic in the api client', '2026-06-30T10:00:00Z', 'closed'),
    searchItem('acme/api', 2, 'Introduce request signing', '2026-07-02T10:00:00Z', 'closed'),
    searchItem('acme/api', 5, 'Tighten input validation', '2026-07-03T10:00:00Z', 'closed'),
    searchItem('acme/web', 6, 'Fix typo in settings page', '2026-07-15T13:00:00Z', 'closed'),
  ],
  '--author': [
    searchItem('acme/api', 10, 'Add health check endpoint', '2026-06-05T10:00:00Z', 'closed'),
    searchItem('acme/api', 11, 'Migrate storage layer to v2', '2026-06-20T10:00:00Z', 'closed'),
    searchItem('acme/web', 12, 'Bump dependencies', '2026-07-01T10:00:00Z', 'closed'),
    searchItem('acme/web', 13, 'Redesign the dashboard', '2026-07-20T10:00:00Z', 'open'),
    searchItem('acme/api', 14, 'Add rate limiting middleware', '2026-08-01T10:00:00Z', 'closed'),
  ],
};

function handleGraphql(query) {
  const aliasPattern = /pr(\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)\s*\{\s*pullRequest\(number: (\d+)\)/g;
  const wantsSizes = query.includes('additions');
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
        timelineItems: {
          nodes: timeline.requests.map((request) => {
            return {
              createdAt: request.at,
              requestedReviewer: { login: request.login },
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

  process.stdout.write(JSON.stringify(SEARCHES[mode]));
} else {
  process.stderr.write(`fake gh got unexpected args: ${args.join(' ')}\n`);
  process.exit(1);
}
