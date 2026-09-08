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

/**
 * Classification of one request cycle from a PR's review timeline. A PR
 * yields one result per completed request-review cycle plus at most one
 * pending result for an unanswered request, so a PR that was reviewed and
 * then re-requested contributes both. Reviewed and pending results carry
 * raw timestamps instead of durations, so a different time mode can
 * recompute durations without refetching anything. Unrequested results
 * carry the time of your latest review, which feeds the reviewing queue.
 * Reviewed results also carry the verdict of the review that closed the
 * cycle, a GitHub review state like APPROVED or CHANGES_REQUESTED, and
 * the total lines the PR changed, which feeds the review-time-vs-size
 * scatter.
 *
 * The team kinds mirror pending and reviewed for a cycle that only a
 * team you belong to was asked for, and name that team by its combined
 * org/slug. They stay apart from the direct kinds so the settings decide
 * at read time whether they show up in the queue and count in the stats,
 * which keeps the stored snapshot valid across a toggle.
 */
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

/**
 * Comment counts of one authored PR. Discussion comments live on the
 * conversation, review comments sit inline on the diff, and total is
 * their sum. Both counts include the author's own replies, because the
 * per-comment authors are not fetched.
 */
export interface CommentCounts {
  discussion: number;
  review: number;
  total: number;
}

/**
 * One review on an authored PR as the size fetch returns it.
 */
export interface PrReview {
  /**
   * Holds the reviewer's login, or null when the account was deleted.
   */
  login: string | null;
  /**
   * Holds when the review was submitted, or null for a pending review
   * that exists but was never submitted.
   */
  submittedAt: Date | null;
}

export interface SizeEntry {
  pr: AuthoredPr;
  files: number;
  additions: number;
  deletions: number;
  total: number;
  /**
   * Holds when the PR was merged, or null while it is open or was closed
   * without a merge.
   */
  mergedAt: Date | null;
  /**
   * Holds when the PR was closed, merged or not, or null while it is
   * open.
   */
  closedAt: Date | null;
  comments: CommentCounts;
  /**
   * Holds every review on the PR, one entry per review round with the
   * reviewer's login and submission time, so a repeat reviewer appears
   * once per round. GitHub records inline replies as reviews too, so
   * the PR author's own login shows up here, and consumers exclude it.
   */
  reviews: PrReview[];
}

export type ProgressCallback = (done: number, total: number) => void;

export interface FetchOptions {
  /**
   * Skips reading the cache so every PR gets refetched from GitHub. Fresh
   * results for closed PRs still get written back, which repairs stale
   * entries.
   */
  bypassCache?: boolean;
}

/**
 * Number of PRs fetched per GraphQL call. Each PR becomes an alias in one
 * batched query, and 25 keeps the query size well under the API limits.
 */
const BATCH_SIZE = 25;

/**
 * Number of batched GraphQL calls kept in flight at once, across every
 * fetch in the process. Running batches concurrently cuts the wall-clock
 * time of a large fetch, and the small bound keeps the request rate
 * friendly to GitHub's secondary rate limits even when the review and
 * size fetches run at the same time.
 */
const MAX_CONCURRENT_BATCHES = 4;

/**
 * The shared gate every fetch runs its batches through. Sharing one gate
 * keeps the process-wide number of in-flight GraphQL calls at the bound
 * when the review and size fetches run concurrently.
 */
const limit = createLimiter(MAX_CONCURRENT_BATCHES);

/**
 * Fetches the given PRs in batches with a bounded number of calls in
 * flight, stores every result into the found map, and writes the PRs the
 * cacheable predicate accepts back to the cache, which by default are the
 * closed ones. The onBatchDone callback receives the number of PRs
 * processed so far. Batches can finish out of order, so that count grows
 * monotonically but not in input order.
 */
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

/**
 * Resolves the login the stats cover. A configured user always wins and
 * never touches the cache. Otherwise the cached login skips the lookup
 * round trip, and a fresh lookup fills the cache. The cache entry is
 * keyed by a fingerprint of the active credentials, so switching the
 * token or the gh account resolves the new user immediately instead of
 * serving the previous one until the entry expires. The entry also
 * expires after a day, and a bypass skips it entirely.
 */
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

/**
 * Resolves the teams the user belongs to, as a set of combined org/slug
 * names, so the classification can tell a review request of one of your
 * teams from one of another team. The cached entry serves while it is
 * fresh and was written for the same login under the same credentials,
 * and a bypass skips it like resolveUser does, so a hard reload picks up
 * a changed membership right away. A failed lookup, which a token
 * without the read:org scope causes, never fails the load. It falls back
 * to the cached entry even when that has expired, and to no teams at all
 * without one, in which case the team requests classify as they did
 * before the lookup existed.
 */
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
 * Turns the review search results into the PR list the review fetch
 * works from. The search already unites the PRs you were asked to review
 * with the ones you reviewed and returns each once, so this only reshapes
 * the items, keyed by repo and number in case a page boundary ever
 * repeats one.
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

/**
 * Classifies one PR from its review timeline into one result per request
 * cycle. Requests and reviews merge into one chronological walk where the
 * earliest unanswered request opens a cycle and the next review closes it,
 * so a re-request while a review is already outstanding never starts a
 * second cycle, and a review at the same instant as a request still counts
 * for it. A final unanswered request becomes a pending result, which keeps
 * a PR that was reviewed and then re-requested in the pending queue.
 * A countedStates set restricts which GitHub review states count as a
 * review at all, so an uncounted review neither closes a cycle nor puts
 * the PR on the reviewing queue, and a PR whose only reviews are uncounted
 * drops out entirely when no request names you.
 *
 * Requests of a team in the teams set join the same walk, so one review
 * of yours closes a direct and a team request at once, and a direct
 * request dominates within a cycle. A direct request opens the cycle or
 * takes it over, a team request that arrives while a direct request is
 * open changes nothing, and a review closes the cycle as reviewed while a
 * direct request is open and as team-reviewed otherwise, dated from the
 * earliest team request of the cycle. A team cycle still open at the end
 * of the walk becomes team-pending when one of its teams is still among
 * the PR's outstanding review requests, because a teammate's review
 * clears the team's request without leaving a trace on the timeline, and
 * drops otherwise. Its request time is the earliest, across the teams
 * still requested, of each team's latest request in the cycle. Only the
 * latest per team can stand for a request that still waits, because a
 * team a teammate satisfied and that was then asked again leaves two
 * events in the cycle, and the first would hide the re-request behind an
 * old snooze and overstate the wait. Exported for the classification
 * tests, the fetch pipeline is the only production caller.
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

  /**
   * Resolves the combined slug of a team request that names one of your
   * teams, in the spelling the teams set uses, or null for a user request
   * and a team you do not belong to.
   */
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

  /**
   * Requests sort before reviews at the same timestamp, so a review that
   * lands at the exact moment of a request closes that request's cycle.
   */
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

  /**
   * The reviewed-by search also returns PRs where you reviewed without a
   * direct request, for example via a team request of a team the lookup
   * does not know. There is no request timestamp, so these cannot go
   * into the histogram, but the latest review time rides along for the
   * reviewing queue.
   */
  if (reviews.length === 0) {
    return [{ kind: 'inaccessible', pr }];
  }

  return [{ kind: 'unrequested', pr, reviewedAt: new Date(Math.max(...reviews.map((review) => review.at.getTime()))) }];
}

/**
 * Splits the PRs into cached results and PRs that need a fetch. Only closed
 * and merged PRs are ever served from the cache, because their timelines and
 * sizes no longer change. A cached entry for a PR that shows up open again
 * was written before a reopen, so it gets dropped and the PR gets refetched.
 * The stale predicate lets a caller reject an entry that predates a field
 * the store's version did not bump for, which refetches it once and
 * rewrites it in the current shape.
 */
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
  /**
   * Restricts which GitHub review states count as a review during
   * classification. An absent set counts every submitted review.
   */
  countedStates?: ReadonlySet<string>;
  /**
   * Names the teams the user belongs to by their combined org/slug, so
   * a request of one of them classifies as a team cycle. An absent set
   * leaves every team request out, as before the lookup existed.
   */
  teams?: ReadonlySet<string>;
}

/**
 * Reports whether a cached details entry predates the outstanding review
 * requests, which the team classification needs. Such an entry counts as
 * a miss, so it refetches once and rewrites in the current shape without
 * a bump of the cache version, which would also discard the saved
 * options that share the version.
 */
function lacksReviewRequests(details: PrDetails): boolean {
  return (details as Partial<PrDetails>).reviewRequests === undefined;
}

/**
 * Fetches the review timeline for every PR and classifies each one into
 * its request cycles, so the result list can be longer than the PR list.
 * Closed PRs come from the on-disk cache when possible, and freshly
 * fetched closed PRs get written back to it. Inaccessible PRs are
 * never cached, so a transient failure cannot hide a PR permanently.
 * The onProgress callback receives the number of processed PRs and
 * the total, first for the cache hits and then after every batch.
 * The countedStates and teams options only steer the classification, and
 * the raw timelines cache independently of them, so changing the filter
 * or a team membership only reruns the classification against cached
 * data.
 */
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

/**
 * Maps the authored search results onto the PR shape the size analysis uses.
 */
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

/**
 * Fetches the size and comment counters for every authored PR. Closed PRs
 * come from the on-disk cache when possible, and freshly fetched closed
 * PRs get written back to it. Inaccessible PRs are skipped, so the returned list
 * can be shorter than the input. The onProgress callback receives the
 * number of processed PRs and the total, first for the cache hits and
 * then after every batch.
 */
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

/**
 * One PR the mentions search returned. The update time rides along from
 * the search, because the mention fetch keys its cache on it.
 */
export interface MentionedPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One text on a PR that names you. The id is the GraphQL node id of the
 * text, which identifies it across loads, and the time is when the text
 * became visible in its current form, so the later of its publication
 * and its last edit. The notification diff uses the id to tell a text it
 * has already reported from a new one, and the time to tell a new text
 * from an old one it simply had not seen before.
 */
export interface Mention {
  id: string;
  at: Date;
}

/**
 * One PR the mentions search returned, with every text on it that names
 * you, or null when the load could not read the PR in full. The null
 * keeps the PR in the result, so the notification diff knows the load
 * did not observe it and holds its cutoff until a later load does,
 * instead of dropping a mention that arrived in the meantime as old.
 *
 * The earlier ids name the texts that mentioned you before the since
 * window, which the window cut dropped from the mentions. The read
 * marks, the snoozes, and the notification baseline record them along
 * with the ids of the mentions, so an edit that carries one of those
 * texts into the window reads as the handled text it is and not as a
 * new mention. The list is empty without a window and for a PR the load
 * could not read.
 */
export interface MentionEntry {
  pr: MentionedPr;
  mentions: Mention[] | null;
  earlier: string[];
}

/**
 * On-disk shape of one mention cache entry. The mentions were found for
 * the given login, in lower case the way GitHub compares logins, and the
 * update time is the one the search reported when the entry was written.
 * An entry only serves the same login on a PR whose search result still
 * carries the same update time, because the texts that count depend on
 * who is looking and any new comment, review, or edit moves the update
 * time. An empty list records that none of the texts names the login.
 */
interface CachedMention {
  user: string;
  updatedAt: string;
  mentions: { id: string; at: string }[];
}

/**
 * Maps the mentions search results onto the PR shape the mention fetch
 * uses.
 */
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
 * Builds the pattern that finds a mention of the given login in a text.
 * A mention is the login behind an at sign, which must not continue a
 * word or a path, so an email address or an org/login path never counts,
 * and must end where the login ends, so a longer login that starts the
 * same way never counts either. Logins compare case-insensitively the
 * way GitHub treats them.
 */
function mentionPattern(user: string): RegExp {
  const escaped = user.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

  return new RegExp(String.raw`(?<![\w/-])@${escaped}(?![\w-])`, 'i');
}

/**
 * Returns the latest of the given times, skipping the ones GitHub left
 * null. At least one time is expected to be set.
 */
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
 * Finds every text on the PR that mentions the user, each with the time
 * it became visible in its current form. A text is visible once it is
 * published, which for an inline review comment is no earlier than the
 * submission of its review, because a comment drafted with a review
 * only shows up when the review does. An edit makes the text visible
 * anew, because an edit is how a mention gets added to an older text.
 * Texts the user wrote never count, because your own words are not news
 * to you, and a review that was never submitted is a draft nobody else
 * can see, so it drops out with its comments. Exported for the tests,
 * the mention fetch is the only production caller.
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
    if (source.login?.toLowerCase() !== own && pattern.test(source.body)) {
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
  /**
   * Drops the mentions that became visible before this time, so the
   * result only holds the mentions within the since window even though
   * the search finds every PR with any activity in it. An absent time
   * keeps every mention.
   */
  since?: Date;
}

/**
 * Fetches the texts of every mentioned PR and reduces each one to the
 * texts that mention the user. Unlike the review and size fetches, the
 * cache serves open PRs too, because an entry is keyed by the update
 * time the search reported and any new activity on the PR moves that
 * time. So a reload only fetches the PRs that changed since the entry
 * was written, which keeps the extra cost of watching for mentions close
 * to the one search. An entry also records the login it was found for
 * and only serves that login, because the same texts mention different
 * people, so switching the user refetches. PRs without a mention are
 * cached and left out of the result. PRs the fetch could not read stay
 * in the result with null mentions and out of the cache, so the
 * notification diff can hold their cutoff and the next load retries
 * them. The onProgress callback receives the number of processed PRs
 * and the total, first for the cache hits and then after every batch.
 *
 * The since option cuts the mentions to the window after the cache is
 * read, so the cache stays independent of the window and a change of
 * the window refetches nothing. The search finds every PR with activity
 * in the window, and the cut drops the mentions on it from before the
 * window, so a push or a comment on an old PR does not bring a mention
 * back that the window no longer covers. A PR left without a mention
 * drops out of the result like one that never had any, and a PR that
 * stays carries the ids of the cut mentions as its earlier ids, so the
 * marks made on it keep covering the texts the window no longer shows.
 */
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
