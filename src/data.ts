import { PrCache, prKey, readCachedLogin, readCachedTeams, writeCachedLogin, writeCachedTeams } from './cache';
import {
  authFingerprint,
  fetchCurrentUser,
  fetchPrDetails,
  fetchPrMentionDetails,
  fetchPrSizes,
  fetchUserTeams,
  type MentionSource,
  type PrDetails,
  type PrMentionDetails,
  type PrSize,
  type SearchPrItem,
} from './github';
import { createLimiter } from './utils';

export interface ReviewPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
  createdAt: Date;
}

export type ReviewResult =
  | { kind: 'inaccessible'; pr: ReviewPr }
  | { kind: 'unrequested'; pr: ReviewPr; reviewedAt: Date }
  | { kind: 'pending'; pr: ReviewPr; requestedAt: Date }
  | { kind: 'reviewed'; pr: ReviewPr; requestedAt: Date; reviewedAt: Date; verdict: string; lines: number }
  | { kind: 'team-pending'; pr: ReviewPr; requestedAt: Date; team: string }
  | {
      kind: 'team-reviewed';
      pr: ReviewPr;
      requestedAt: Date;
      reviewedAt: Date;
      verdict: string;
      lines: number;
      team: string;
    };

export interface AuthoredPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
  createdAt: Date;
}

export interface CommentCounts {
  discussion: number;
  review: number;
  total: number;
}

export interface PrReview {
  login: string | null;
  submittedAt: Date | null;
}

export interface SizeEntry {
  pr: AuthoredPr;
  files: number;
  additions: number;
  deletions: number;
  total: number;
  mergedAt: Date | null;
  closedAt: Date | null;
  comments: CommentCounts;
  /**
   * GitHub records inline replies as reviews, so the PR author's own login shows up here.
   */
  reviews: PrReview[];
}

export type ProgressCallback = (done: number, total: number) => void;

export interface FetchOptions {
  bypassCache?: boolean;
}

/**
 * Keeps the aliased batch query well under the GitHub GraphQL size limits.
 */
const BATCH_SIZE = 25;

/**
 * Bounds in-flight GraphQL calls process-wide to stay under GitHub's secondary rate limits.
 */
const MAX_CONCURRENT_BATCHES = 4;

const limit = createLimiter(MAX_CONCURRENT_BATCHES);

async function fetchMissing<Pr extends { repo: string; number: number; state: string }, T>(
  misses: Pr[],
  fetchBatch: (batch: Pr[]) => Promise<(T | null)[]>,
  found: Map<string, T | null>,
  cache: PrCache<T>,
  onBatchDone: (completed: number) => void,
  cacheable: (pr: Pr) => boolean = (pr) => pr.state !== 'open',
): Promise<void> {
  const batches: Pr[][] = [];

  for (let offset = 0; offset < misses.length; offset += BATCH_SIZE) {
    batches.push(misses.slice(offset, offset + BATCH_SIZE));
  }

  let completed = 0;

  await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        const detailsList = await fetchBatch(batch);

        for (const [i, pr] of batch.entries()) {
          const details = detailsList[i];
          const key = prKey(pr.repo, pr.number);

          found.set(key, details);

          if (details !== null && cacheable(pr)) {
            cache.set(key, details);
          }
        }

        completed += batch.length;

        onBatchDone(completed);
      }),
    ),
  );
}

export async function resolveUser(configured: string, bypassCache = false): Promise<string> {
  const trimmed = configured.trim();

  if (trimmed !== '') {
    return trimmed;
  }

  const auth = await authFingerprint();

  if (!bypassCache) {
    const cached = readCachedLogin(auth);

    if (cached !== null) {
      return cached;
    }
  }

  const login = await fetchCurrentUser();

  writeCachedLogin(login, auth);

  return login;
}

export async function resolveTeams(user: string, bypassCache = false): Promise<ReadonlySet<string>> {
  const auth = await authFingerprint();
  const cached = readCachedTeams(auth, user);

  if (!bypassCache && cached?.fresh === true) {
    return new Set(cached.teams);
  }

  try {
    const teams = await fetchUserTeams(user);

    writeCachedTeams(teams, user, auth);

    return new Set(teams);
  } catch {
    return new Set(cached?.teams);
  }
}

/**
 * GitHub search can repeat an item across a page boundary.
 */
export function collectReviewPrs(review: SearchPrItem[]): ReviewPr[] {
  const prByKey = new Map<string, ReviewPr>();

  for (const item of review) {
    const repo = item.repository.nameWithOwner;

    prByKey.set(`${repo}#${item.number}`, {
      repo,
      number: item.number,
      title: item.title,
      url: item.url,
      state: item.state,
      createdAt: new Date(item.createdAt),
    });
  }

  return [...prByKey.values()];
}

export interface MergedReviewPrs {
  prs: ReviewPr[];
  outsideWindow: Set<string>;
}

export function mergeRequestedPrs(review: SearchPrItem[], requested: SearchPrItem[]): MergedReviewPrs {
  const prs = collectReviewPrs(review);
  const inside = new Set(prs.map((pr) => prKey(pr.repo, pr.number)));
  const outsideWindow = new Set<string>();

  for (const pr of collectReviewPrs(requested)) {
    const key = prKey(pr.repo, pr.number);

    if (!inside.has(key) && !outsideWindow.has(key)) {
      outsideWindow.add(key);
      prs.push(pr);
    }
  }

  return { prs, outsideWindow };
}

export function queueResultsOnly(results: ReviewResult[], outsideWindow: ReadonlySet<string>): ReviewResult[] {
  if (outsideWindow.size === 0) {
    return results;
  }

  return results.filter(
    (result) =>
      !outsideWindow.has(prKey(result.pr.repo, result.pr.number)) ||
      result.kind === 'pending' ||
      result.kind === 'team-pending',
  );
}

/**
 * A teammate's review clears a team request without leaving a trace on the timeline,
 * so team-pending relies on the outstanding review requests.
 */
export function classifyPr(
  pr: ReviewPr,
  details: PrDetails | null,
  user: string,
  countedStates?: ReadonlySet<string>,
  teams: ReadonlySet<string> = new Set(),
): ReviewResult[] {
  if (!details) {
    return [{ kind: 'inaccessible', pr }];
  }

  const teamSlugs = new Set([...teams].map((team) => team.toLowerCase()));

  const teamOf = (reviewer: { login?: string; combinedSlug?: string } | null | undefined): string | null => {
    const slug = reviewer?.combinedSlug;

    return slug !== undefined && teamSlugs.has(slug.toLowerCase()) ? slug.toLowerCase() : null;
  };

  const requests: { at: Date; team: string | null }[] = [];

  for (const node of details.timelineItems.nodes) {
    if (node === null) {
      continue;
    }

    if (node.requestedReviewer?.login === user) {
      requests.push({ at: new Date(node.createdAt), team: null });

      continue;
    }

    const team = teamOf(node.requestedReviewer);

    if (team !== null) {
      requests.push({ at: new Date(node.createdAt), team });
    }
  }

  const reviews = details.reviews.nodes.flatMap((node) =>
    node?.author?.login === user && node.submittedAt && (countedStates === undefined || countedStates.has(node.state))
      ? [{ at: new Date(node.submittedAt), state: node.state }]
      : [],
  );

  const outstandingTeams = new Set(
    details.reviewRequests.nodes.flatMap((node) => {
      const team = teamOf(node?.requestedReviewer);

      return team === null ? [] : [team];
    }),
  );

  // requests sort before reviews at the same timestamp, so a review at that instant closes the request's cycle
  const events: { at: Date; isRequest: boolean; team: string | null; state: string }[] = [
    ...requests.map(({ at, team }) => {
      return { at, isRequest: true, team, state: '' };
    }),
    ...reviews.map(({ at, state }) => {
      return { at, isRequest: false, team: null, state };
    }),
  ].toSorted((a, b) => a.at.getTime() - b.at.getTime() || Number(b.isRequest) - Number(a.isRequest));

  const results: ReviewResult[] = [];
  const lines = details.additions + details.deletions;

  let openedAt: Date | null = null;
  let teamRequests: { at: Date; team: string }[] = [];

  for (const event of events) {
    if (event.isRequest) {
      if (event.team === null) {
        openedAt ??= event.at;
      } else {
        teamRequests.push({ at: event.at, team: event.team });
      }
    } else if (openedAt !== null) {
      results.push({ kind: 'reviewed', pr, requestedAt: openedAt, reviewedAt: event.at, verdict: event.state, lines });

      openedAt = null;
      teamRequests = [];
    } else if (teamRequests.length > 0) {
      const [first] = teamRequests;

      results.push({
        kind: 'team-reviewed',
        pr,
        requestedAt: first.at,
        reviewedAt: event.at,
        verdict: event.state,
        lines,
        team: first.team,
      });

      teamRequests = [];
    }
  }

  if (openedAt !== null) {
    results.push({ kind: 'pending', pr, requestedAt: openedAt });
  } else if (teamRequests.length > 0) {
    const latestByTeam = new Map<string, Date>();

    for (const { at, team } of teamRequests) {
      const known = latestByTeam.get(team);

      if (known === undefined || at > known) {
        latestByTeam.set(team, at);
      }
    }

    let earliest: { at: Date; team: string } | null = null;

    for (const [team, at] of latestByTeam) {
      if (outstandingTeams.has(team) && (earliest === null || at < earliest.at)) {
        earliest = { at, team };
      }
    }

    if (earliest !== null) {
      results.push({ kind: 'team-pending', pr, requestedAt: earliest.at, team: earliest.team });
    }
  }

  if (results.length > 0) {
    return results;
  }

  if (reviews.length === 0) {
    return [{ kind: 'inaccessible', pr }];
  }

  return [{ kind: 'unrequested', pr, reviewedAt: new Date(Math.max(...reviews.map((review) => review.at.getTime()))) }];
}

function partitionCached<Pr extends { repo: string; number: number; state: string }, T>(
  prs: Pr[],
  cache: PrCache<T>,
  bypass: boolean,
  stale: (cached: T) => boolean = () => false,
): { found: Map<string, T | null>; misses: Pr[] } {
  const found = new Map<string, T | null>();
  const misses: Pr[] = [];

  for (const pr of prs) {
    const key = prKey(pr.repo, pr.number);

    if (pr.state === 'open') {
      cache.delete(key);
      misses.push(pr);

      continue;
    }

    const cached = bypass ? undefined : cache.get(key);

    if (cached === undefined || stale(cached)) {
      misses.push(pr);
    } else {
      found.set(key, cached);
    }
  }

  return { found, misses };
}

export interface ReviewFetch {
  results: ReviewResult[];
  cacheHits: number;
}

export interface ReviewFetchOptions extends FetchOptions {
  countedStates?: ReadonlySet<string>;
  teams?: ReadonlySet<string>;
}

/**
 * Bumping the cache version instead would also discard the saved options that share it.
 */
function lacksReviewRequests(details: PrDetails): boolean {
  return (details as Partial<PrDetails>).reviewRequests === undefined;
}

export async function fetchReviewRaw(
  prs: ReviewPr[],
  user: string,
  onProgress?: ProgressCallback,
  options: ReviewFetchOptions = {},
): Promise<ReviewFetch> {
  const cache = new PrCache<PrDetails>('details');
  const { found, misses } = partitionCached(prs, cache, options.bypassCache === true, lacksReviewRequests);
  const cacheHits = prs.length - misses.length;

  onProgress?.(cacheHits, prs.length);

  await fetchMissing(misses, fetchPrDetails, found, cache, (completed) => {
    onProgress?.(cacheHits + completed, prs.length);
  });

  cache.save();

  return {
    results: prs.flatMap((pr) =>
      classifyPr(pr, found.get(prKey(pr.repo, pr.number)) ?? null, user, options.countedStates, options.teams),
    ),
    cacheHits,
  };
}

export function collectAuthoredPrs(authored: SearchPrItem[]): AuthoredPr[] {
  return authored.map((item) => {
    return {
      repo: item.repository.nameWithOwner,
      number: item.number,
      title: item.title,
      url: item.url,
      state: item.state,
      createdAt: new Date(item.createdAt),
    };
  });
}

export interface SizeFetch {
  sizes: SizeEntry[];
  cacheHits: number;
}

export async function fetchSizeRaw(
  prs: AuthoredPr[],
  onProgress?: ProgressCallback,
  options: FetchOptions = {},
): Promise<SizeFetch> {
  const cache = new PrCache<PrSize>('sizes');
  const { found, misses } = partitionCached(prs, cache, options.bypassCache === true);
  const cacheHits = prs.length - misses.length;

  onProgress?.(cacheHits, prs.length);

  await fetchMissing(misses, fetchPrSizes, found, cache, (completed) => {
    onProgress?.(cacheHits + completed, prs.length);
  });

  cache.save();

  const sizes: SizeEntry[] = [];

  for (const pr of prs) {
    const details = found.get(prKey(pr.repo, pr.number));

    if (details) {
      const discussion = details.comments.totalCount;
      const review = details.reviews.nodes.reduce((sum, node) => sum + (node?.comments.totalCount ?? 0), 0);

      const reviews = details.reviews.nodes.flatMap((node) =>
        node === null
          ? []
          : [
              {
                login: node.author?.login ?? null,
                submittedAt: node.submittedAt === null ? null : new Date(node.submittedAt),
              },
            ],
      );

      sizes.push({
        pr,
        files: details.changedFiles,
        additions: details.additions,
        deletions: details.deletions,
        total: details.additions + details.deletions,
        mergedAt: details.mergedAt === null ? null : new Date(details.mergedAt),
        closedAt: details.closedAt === null ? null : new Date(details.closedAt),
        comments: { discussion, review, total: discussion + review },
        reviews,
      });
    }
  }

  return { sizes, cacheHits };
}

export interface MentionedPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Mention {
  id: string;
  at: Date;
}

/**
 * A null mentions list makes the notification diff hold its cutoff instead of treating a new
 * mention as old.
 */
export interface MentionEntry {
  pr: MentionedPr;
  mentions: Mention[] | null;
  earlier: string[];
}

/**
 * GitHub moves a PR's update time on any new comment, review, or edit, so it is a safe cache key.
 */
interface CachedMention {
  user: string;
  updatedAt: string;
  mentions: { id: string; at: string }[];
}

export function collectMentionedPrs(mentioned: SearchPrItem[]): MentionedPr[] {
  return mentioned.map((item) => {
    return {
      repo: item.repository.nameWithOwner,
      number: item.number,
      title: item.title,
      url: item.url,
      state: item.state,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    };
  });
}

/**
 * GitHub matches logins case-insensitively and does not treat emails or org/login paths as mentions.
 */
function mentionPattern(user: string): RegExp {
  const escaped = user.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

  return new RegExp(String.raw`(?<![\w/-])@${escaped}(?![\w-])`, 'i');
}

/**
 * GitHub ignores logins inside code or HTML comments, which close per https://spec.commonmark.org/.
 */
const CODE_OR_COMMENT_PATTERN = new RegExp(
  [
    String.raw`^[ \t]*(\`{3,}|~{3,})[^\n]*(?:\n[\s\S]*?(?:^[ \t]*\1[\`~]*[ \t]*$|(?![\s\S])))?`,
    String.raw`<!--[\s\S]*?-->`,
    String.raw`(\`+)[\s\S]*?[^\`]\2(?!\`)`,
  ].join('|'),
  'gm',
);

export function stripCodeAndComments(body: string): string {
  return body.replaceAll(CODE_OR_COMMENT_PATTERN, ' ');
}

function latestOf(...times: (string | null)[]): Date {
  let latest = Number.NEGATIVE_INFINITY;

  for (const time of times) {
    if (time !== null) {
      latest = Math.max(latest, new Date(time).getTime());
    }
  }

  return new Date(latest);
}

/**
 * GitHub shows inline review comments only once their review is submitted.
 */
export function findMentions(details: PrMentionDetails, user: string): Mention[] {
  const pattern = mentionPattern(user);
  const own = user.toLowerCase();

  const sources: { id: string; body: string; at: Date; login: string | null }[] = [];

  const addText = (text: MentionSource, floor: string | null = null) => {
    sources.push({
      id: text.id,
      body: text.body,
      at: latestOf(text.publishedAt ?? text.createdAt, text.lastEditedAt, floor),
      login: text.author?.login ?? null,
    });
  };

  addText(details);

  for (const comment of details.comments) {
    addText(comment);
  }

  for (const review of details.reviews) {
    if (review.submittedAt === null) {
      continue;
    }

    sources.push({
      id: review.id,
      body: review.body,
      at: latestOf(review.submittedAt, review.lastEditedAt),
      login: review.author?.login ?? null,
    });

    for (const comment of review.comments) {
      addText(comment, review.submittedAt);
    }
  }

  const mentions: Mention[] = [];

  for (const source of sources) {
    if (source.login?.toLowerCase() !== own && pattern.test(stripCodeAndComments(source.body))) {
      mentions.push({ id: source.id, at: source.at });
    }
  }

  return mentions;
}

export interface MentionFetch {
  mentions: MentionEntry[];
  cacheHits: number;
}

export interface MentionFetchOptions extends FetchOptions {
  since?: Date;
}

export async function fetchMentionsRaw(
  prs: MentionedPr[],
  user: string,
  onProgress?: ProgressCallback,
  options: MentionFetchOptions = {},
): Promise<MentionFetch> {
  const cache = new PrCache<CachedMention>('mentions');
  const found = new Map<string, CachedMention | null>();
  const misses: MentionedPr[] = [];
  const login = user.toLowerCase();

  for (const pr of prs) {
    const key = prKey(pr.repo, pr.number);
    const cached = options.bypassCache === true ? undefined : cache.get(key);

    if (cached?.user === login && cached.updatedAt === pr.updatedAt.toISOString()) {
      found.set(key, cached);
    } else {
      misses.push(pr);
    }
  }

  const cacheHits = prs.length - misses.length;

  onProgress?.(cacheHits, prs.length);

  const fetchBatch = async (batch: MentionedPr[]): Promise<(CachedMention | null)[]> => {
    const detailsList = await fetchPrMentionDetails(batch);

    return batch.map((pr, i) => {
      const details = detailsList[i];

      if (details === null) {
        return null;
      }

      return {
        user: login,
        updatedAt: pr.updatedAt.toISOString(),
        mentions: findMentions(details, user).map(({ id, at }) => {
          return { id, at: at.toISOString() };
        }),
      };
    });
  };

  await fetchMissing(
    misses,
    fetchBatch,
    found,
    cache,
    (completed) => {
      onProgress?.(cacheHits + completed, prs.length);
    },
    () => true,
  );

  cache.save();

  const mentions: MentionEntry[] = [];
  const since = options.since?.getTime() ?? Number.NEGATIVE_INFINITY;

  for (const pr of prs) {
    const entry = found.get(prKey(pr.repo, pr.number));

    if (entry == null) {
      mentions.push({ pr, mentions: null, earlier: [] });

      continue;
    }

    const inWindow: Mention[] = [];
    const earlier: string[] = [];

    for (const { id, at } of entry.mentions) {
      const time = new Date(at);

      if (time.getTime() >= since) {
        inWindow.push({ id, at: time });
      } else {
        earlier.push(id);
      }
    }

    if (inWindow.length > 0) {
      mentions.push({ pr, mentions: inWindow, earlier });
    }
  }

  return { mentions, cacheHits };
}
