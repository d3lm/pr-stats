import { readCacheFile, writeCacheFile } from '../../cache';
import {
  collectAuthoredPrs,
  collectReviewPrs,
  fetchReviewRaw,
  fetchSizeRaw,
  resolveUser,
  type ReviewResult,
  type SizeEntry,
} from '../../data';
import { parseReviewTypes, parseSince } from '../../flags';
import { resolveRepos, searchPrs } from '../../github';
import type { FetchParams } from '../state/options';

export type { ReviewResult, SizeEntry } from '../../data';

export interface RawData {
  user: string;
  sinceIso: string;
  repos: string[];
  reviewResults: ReviewResult[];
  sizes: SizeEntry[];
  authoredTotal: number;
  searchCapped: boolean;
  fetchedAt: Date;
}

/**
 * Progress of one load. The search phase has no measurable total, and the
 * details phase covers the review timelines and the size counters, which
 * fetch concurrently and report one combined counter.
 */
export interface LoadPhase {
  phase: 'search' | 'details';
  done?: number;
  total?: number;
}

/**
 * On-disk shape of the startup snapshot, the last successful load together
 * with the options it was loaded for.
 */
interface Snapshot {
  params: FetchParams;
  data: RawData;
}

/**
 * Rebuilds the Date fields after a JSON round trip, which turns them into
 * ISO strings.
 */
function reviveRawData(data: RawData): RawData {
  return {
    ...data,
    fetchedAt: new Date(data.fetchedAt),
    reviewResults: data.reviewResults.map((result) => {
      const pr = { ...result.pr, createdAt: new Date(result.pr.createdAt) };

      if (result.kind === 'pending') {
        return { ...result, pr, requestedAt: new Date(result.requestedAt) };
      }

      if (result.kind === 'reviewed') {
        return { ...result, pr, requestedAt: new Date(result.requestedAt), reviewedAt: new Date(result.reviewedAt) };
      }

      if (result.kind === 'unrequested') {
        return { ...result, pr, reviewedAt: new Date(result.reviewedAt) };
      }

      return { ...result, pr };
    }),
    sizes: data.sizes.map((entry) => {
      return {
        ...entry,
        pr: { ...entry.pr, createdAt: new Date(entry.pr.createdAt) },
        mergedAt: entry.mergedAt === null ? null : new Date(entry.mergedAt),
        closedAt: entry.closedAt === null ? null : new Date(entry.closedAt),
        reviews: entry.reviews.map((review) => {
          return { ...review, submittedAt: review.submittedAt === null ? null : new Date(review.submittedAt) };
        }),
      };
    }),
  };
}

/**
 * Returns the snapshot of the last successful load when the requested
 * options can be served from it, so the TUI can render instantly on
 * startup while the real load runs in the background. The repos, user,
 * drafts, and review-types options must match exactly, because the
 * review-types filter is baked into the classified results the snapshot
 * stores. The since window may be narrower
 * than the stored one, because a narrower window is a subset that gets cut
 * from the snapshot by PR creation date. This also trims relative values
 * like 2w to the current day when the snapshot is from an earlier day.
 * The background refresh replaces the snapshot either way.
 */
export function loadSnapshot(options: FetchParams): RawData | null {
  const stored = readCacheFile('snapshot') as Snapshot | null;

  if (stored?.params === undefined) {
    return null;
  }

  const { params } = stored;

  if (
    params.repos !== options.repos ||
    params.user !== options.user ||
    params.includeDrafts !== options.includeDrafts ||
    params.reviewTypes !== options.reviewTypes
  ) {
    return null;
  }

  const sinceIso = parseSince(options.since).toISOString().slice(0, 10);

  if (sinceIso < stored.data.sinceIso) {
    return null;
  }

  const data = reviveRawData(stored.data);

  /**
   * Snapshots written before unrequested results carried a review time
   * would show broken durations in the reviewing queue, so they never
   * get served and the background load replaces them.
   */
  if (data.reviewResults.some((result) => result.kind === 'unrequested' && Number.isNaN(result.reviewedAt.getTime()))) {
    return null;
  }

  const hasMissingVerdict = data.reviewResults.some((result) => {
    return result.kind === 'reviewed' && (result.verdict as string | undefined) === undefined;
  });

  /**
   * Snapshots written before reviewed results carried a verdict would
   * render an empty verdict gauge, so they never get served either.
   * The cast reflects that stored data can predate the field the type
   * promises.
   */
  if (hasMissingVerdict) {
    return null;
  }

  if (sinceIso === data.sinceIso) {
    return data;
  }

  /**
   * Snapshots written before review PRs carried a creation date cannot be
   * cut down, so they only serve the exact window.
   */
  if (data.reviewResults.some((result) => Number.isNaN(result.pr.createdAt.getTime()))) {
    return null;
  }

  const cutoff = new Date(sinceIso);
  const reviewResults = data.reviewResults.filter((result) => result.pr.createdAt >= cutoff);
  const sizes = data.sizes.filter((entry) => entry.pr.createdAt >= cutoff);

  return {
    ...data,
    sinceIso,
    reviewResults,
    sizes,
    /**
     * The creation dates of inaccessible authored PRs are unknown, so the
     * inaccessible count carries over unchanged.
     */
    authoredTotal: sizes.length + (data.authoredTotal - data.sizes.length),
  };
}

/**
 * Stores the result of a successful load as the startup snapshot for the
 * options it was loaded with.
 */
export function saveSnapshot(options: FetchParams, data: RawData): void {
  const params: FetchParams = {
    since: options.since,
    repos: options.repos,
    user: options.user,
    includeDrafts: options.includeDrafts,
    reviewTypes: options.reviewTypes,
  };

  writeCacheFile('snapshot', { params, data } satisfies Snapshot);
}

/**
 * Runs the full fetch pipeline, resolving the user, searching PRs, and
 * fetching timelines and sizes in batches. Closed PRs and the login come
 * from the on-disk cache unless bypassCache is set, which refetches
 * everything and rewrites the cached entries. A successful load also
 * becomes the next startup snapshot. Reports progress through onPhase so
 * the UI can show what is happening. Throws CliError on expected failures
 * like a broken gh login.
 */
export async function loadData(
  options: FetchParams,
  onPhase: (phase: LoadPhase) => void,
  { bypassCache = false }: { bypassCache?: boolean } = {},
): Promise<RawData> {
  const sinceIso = parseSince(options.since).toISOString().slice(0, 10);

  onPhase({ phase: 'search' });

  const repoNames = options.repos
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');

  /**
   * The user lookup and the repo owner resolution are independent GitHub
   * round trips, so they run concurrently.
   */
  const [user, repos] = await Promise.all([resolveUser(options.user, bypassCache), resolveRepos(repoNames)]);

  const includeDrafts = options.includeDrafts;

  const [requested, reviewed, authored] = await Promise.all([
    searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'requested' }),
    searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'reviewed' }),
    searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'authored' }),
  ]);

  const reviewPrs = collectReviewPrs(requested, reviewed);
  const authoredPrs = collectAuthoredPrs(authored);

  /**
   * The timeline and size fetches are independent, so they run
   * concurrently and the load takes as long as the slower one. The shared
   * batch gate in the data module keeps the combined request rate within
   * the same bound a single fetch uses. Each fetch reports its own
   * counter, and the sum drives one combined progress bar.
   */
  const progress = { review: 0, sizes: 0 };
  const total = reviewPrs.length + authoredPrs.length;

  const report = () => {
    onPhase({ phase: 'details', done: progress.review + progress.sizes, total });
  };

  report();

  const countedStates = options.reviewTypes === '' ? undefined : parseReviewTypes(options.reviewTypes);

  const [review, size] = await Promise.all([
    reviewPrs.length === 0
      ? { results: [], cacheHits: 0 }
      : fetchReviewRaw(
          reviewPrs,
          user,
          (done) => {
            progress.review = done;
            report();
          },
          { bypassCache, countedStates },
        ),
    authoredPrs.length === 0
      ? { sizes: [], cacheHits: 0 }
      : fetchSizeRaw(
          authoredPrs,
          (done) => {
            progress.sizes = done;
            report();
          },
          { bypassCache },
        ),
  ]);

  const data: RawData = {
    user,
    sinceIso,
    repos,
    reviewResults: review.results,
    sizes: size.sizes,
    authoredTotal: authoredPrs.length,
    searchCapped: requested.length >= 1000 || reviewed.length >= 1000 || authored.length >= 1000,
    fetchedAt: new Date(),
  };

  saveSnapshot(options, data);

  return data;
}
