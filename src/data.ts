import { PrCache, prKey, readCachedLogin, writeCachedLogin } from './cache';
import {
  authFingerprint,
  fetchCurrentUser,
  fetchPrDetails,
  fetchPrSizes,
  type PrDetails,
  type PrSize,
  type SearchPrItem,
} from './github';

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
 * recompute durations without refetching anything.
 */
export type ReviewResult =
  | { kind: 'inaccessible'; pr: ReviewPr }
  | { kind: 'unrequested'; pr: ReviewPr }
  | { kind: 'pending'; pr: ReviewPr; requestedAt: Date }
  | { kind: 'reviewed'; pr: ReviewPr; requestedAt: Date; reviewedAt: Date };

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

export interface SizeEntry {
  pr: AuthoredPr;
  files: number;
  additions: number;
  deletions: number;
  total: number;
  comments: CommentCounts;
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
 * Creates a gate that runs async tasks with at most maxConcurrent of them
 * in flight. A finishing task hands its slot to the oldest waiter, so the
 * number of running tasks never overshoots the bound.
 */
function createLimiter(maxConcurrent: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;

  const waiting: (() => void)[] = [];

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < maxConcurrent) {
      active += 1;
    } else {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }

    try {
      return await task();
    } finally {
      const next = waiting.shift();

      if (next === undefined) {
        active -= 1;
      } else {
        next();
      }
    }
  };
}

/**
 * The shared gate every fetch runs its batches through. Sharing one gate
 * keeps the process-wide number of in-flight GraphQL calls at the bound
 * when the review and size fetches run concurrently.
 */
const limit = createLimiter(MAX_CONCURRENT_BATCHES);

/**
 * Fetches the given PRs in batches with a bounded number of calls in
 * flight, stores every result into the found map, and writes closed PRs
 * back to the cache. The onBatchDone callback receives the number of PRs
 * processed so far. Batches can finish out of order, so that count grows
 * monotonically but not in input order.
 */
async function fetchMissing<Pr extends { repo: string; number: number; state: string }, T>(
  misses: Pr[],
  fetchBatch: (batch: Pr[]) => Promise<(T | null)[]>,
  found: Map<string, T | null>,
  cache: PrCache<T>,
  onBatchDone: (completed: number) => void,
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

          if (details !== null && pr.state !== 'open') {
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
 * Merges the review-requested and reviewed-by search results into one
 * deduplicated PR list. Both searches can return the same PR, so the key
 * combines repo and number.
 */
export function collectReviewPrs(requested: SearchPrItem[], reviewed: SearchPrItem[]): ReviewPr[] {
  const prByKey = new Map<string, ReviewPr>();

  for (const item of [...requested, ...reviewed]) {
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
 * Exported for the classification tests, the fetch pipeline is the only
 * production caller.
 */
export function classifyPr(pr: ReviewPr, details: PrDetails | null, user: string): ReviewResult[] {
  if (!details) {
    return [{ kind: 'inaccessible', pr }];
  }

  const requests = details.timelineItems.nodes.flatMap((node) =>
    node?.requestedReviewer?.login === user ? [new Date(node.createdAt)] : [],
  );

  const reviews = details.reviews.nodes.flatMap((node) =>
    node?.author?.login === user && node.submittedAt ? [new Date(node.submittedAt)] : [],
  );

  if (requests.length === 0) {
    /**
     * The reviewed-by search also returns PRs where you reviewed without a
     * direct request, for example via a team request. There is no personal
     * request timestamp, so these cannot go into the histogram.
     */
    return reviews.length > 0 ? [{ kind: 'unrequested', pr }] : [{ kind: 'inaccessible', pr }];
  }

  /**
   * Requests sort before reviews at the same timestamp, so a review that
   * lands at the exact moment of a request closes that request's cycle.
   */
  const events = [
    ...requests.map((at) => {
      return { at, isRequest: true };
    }),
    ...reviews.map((at) => {
      return { at, isRequest: false };
    }),
  ].toSorted((a, b) => a.at.getTime() - b.at.getTime() || Number(b.isRequest) - Number(a.isRequest));

  const results: ReviewResult[] = [];

  let openedAt: Date | null = null;

  for (const event of events) {
    if (event.isRequest) {
      openedAt ??= event.at;
    } else if (openedAt !== null) {
      results.push({ kind: 'reviewed', pr, requestedAt: openedAt, reviewedAt: event.at });
      openedAt = null;
    }
  }

  if (openedAt !== null) {
    results.push({ kind: 'pending', pr, requestedAt: openedAt });
  }

  return results;
}

/**
 * Splits the PRs into cached results and PRs that need a fetch. Only closed
 * and merged PRs are ever served from the cache, because their timelines and
 * sizes no longer change. A cached entry for a PR that shows up open again
 * was written before a reopen, so it gets dropped and the PR gets refetched.
 */
function partitionCached<Pr extends { repo: string; number: number; state: string }, T>(
  prs: Pr[],
  cache: PrCache<T>,
  bypass: boolean,
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

    if (cached === undefined) {
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

/**
 * Fetches the review timeline for every PR and classifies each one into
 * its request cycles, so the result list can be longer than the PR list.
 * Closed PRs come from the on-disk cache when possible, and freshly
 * fetched closed PRs get written back to it. Inaccessible PRs are
 * never cached, so a transient failure cannot hide a PR permanently.
 * The onProgress callback receives the number of processed PRs and
 * the total, first for the cache hits and then after every batch.
 */
export async function fetchReviewRaw(
  prs: ReviewPr[],
  user: string,
  onProgress?: ProgressCallback,
  options: FetchOptions = {},
): Promise<ReviewFetch> {
  const cache = new PrCache<PrDetails>('details');
  const { found, misses } = partitionCached(prs, cache, options.bypassCache === true);
  const cacheHits = prs.length - misses.length;

  onProgress?.(cacheHits, prs.length);

  await fetchMissing(misses, fetchPrDetails, found, cache, (completed) => {
    onProgress?.(cacheHits + completed, prs.length);
  });

  cache.save();

  return {
    results: prs.flatMap((pr) => classifyPr(pr, found.get(prKey(pr.repo, pr.number)) ?? null, user)),
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

      sizes.push({
        pr,
        files: details.changedFiles,
        additions: details.additions,
        deletions: details.deletions,
        total: details.additions + details.deletions,
        comments: { discussion, review, total: discussion + review },
      });
    }
  }

  return { sizes, cacheHits };
}
