import { readCacheFile, writeCacheFile } from '../../cache';
import {
  collectAuthoredPrs,
  collectMentionedPrs,
  collectReviewPrs,
  fetchMentionsRaw,
  fetchReviewRaw,
  fetchSizeRaw,
  resolveTeams,
  resolveUser,
  type MentionEntry,
  type ReviewResult,
  type SizeEntry,
} from '../../data';
import { parseReviewTypes, parseSince } from '../../flags';
import { onRateLimitWait, resolveRepos, searchPrs, type RateLimitWait } from '../../github';
import type { FetchParams } from '../state/options';

export type { MentionEntry, ReviewResult, SizeEntry } from '../../data';
export type { RateLimitWait } from '../../github';

export interface RawData {
  user: string;
  sinceIso: string;
  repos: string[];
  reviewResults: ReviewResult[];
  sizes: SizeEntry[];
  authoredTotal: number;
  /**
   * Lists the PRs that mention you with the time of the newest mention,
   * or null when the load did not look for mentions, which is the case
   * while mention notifications are off. The null keeps a load without
   * the data apart from a load that found no mention, so turning the
   * setting on starts from a fresh baseline instead of reporting every
   * mention already there.
   */
  mentions: MentionEntry[] | null;
  searchCapped: boolean;
  fetchedAt: Date;
}

/**
 * Options of one load beyond the fetch params.
 */
export interface LoadOptions {
  /**
   * Skips reading the cache so every PR gets refetched from GitHub.
   * Fresh results still get written back.
   */
  bypassCache?: boolean;
  /**
   * Runs the mentions search and fetch on top of the review and size
   * fetches, so the load can report new mentions. The mention
   * notifications setting drives it.
   */
  mentions?: boolean;
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
  /**
   * Holds the pause the load sits in while GitHub's rate limits hold its
   * requests back, so the UI can show a countdown instead of a stalled
   * spinner, and is absent or null while the requests flow.
   */
  wait?: RateLimitWait | null;
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
 * ISO strings. Snapshots written before loads looked for mentions carry
 * no mentions field at all, which reads like a load that did not look,
 * and entries written before the window cut kept the earlier ids carry
 * none, which reads like a cut that dropped nothing, so the casts cover
 * stored data that predates the fields.
 */
function reviveRawData(data: RawData): RawData {
  const mentions = (data as { mentions?: MentionEntry[] | null }).mentions ?? null;

  return {
    ...data,
    fetchedAt: new Date(data.fetchedAt),
    mentions:
      mentions === null
        ? null
        : mentions.map((entry) => {
            return {
              pr: { ...entry.pr, createdAt: new Date(entry.pr.createdAt), updatedAt: new Date(entry.pr.updatedAt) },
              mentions:
                entry.mentions === null
                  ? null
                  : entry.mentions.map((mention) => {
                      return { id: mention.id, at: new Date(mention.at) };
                    }),
              earlier: (entry as { earlier?: string[] }).earlier ?? [],
            };
          }),
    reviewResults: data.reviewResults.map((result) => {
      const pr = { ...result.pr, createdAt: new Date(result.pr.createdAt) };

      if (result.kind === 'pending' || result.kind === 'team-pending') {
        return { ...result, pr, requestedAt: new Date(result.requestedAt) };
      }

      if (result.kind === 'reviewed' || result.kind === 'team-reviewed') {
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
 * Cuts the mention entries of a snapshot down to a narrower window the
 * way a fresh load would fill it. The mentions of an entry are cut by
 * the time they became visible, the ids of the cut ones join the earlier
 * ids of the entry, and an entry left without any mention drops out. An
 * entry the load could not read keeps its null mentions while the PR's
 * update time falls in the window, because that is the rule the search
 * applies, and a fresh load would carry the PR the same way.
 */
function cutMentions(entries: MentionEntry[], cutoff: Date): MentionEntry[] {
  return entries.flatMap((entry) => {
    if (entry.mentions === null) {
      return entry.pr.updatedAt >= cutoff ? [entry] : [];
    }

    const mentions = entry.mentions.filter((mention) => mention.at >= cutoff);

    if (mentions.length === 0) {
      return [];
    }

    const cut = entry.mentions.filter((mention) => mention.at < cutoff).map((mention) => mention.id);

    return [{ ...entry, mentions, earlier: [...entry.earlier, ...cut] }];
  });
}

/**
 * Returns the snapshot of the last successful load when the requested
 * options can be served from it, so the TUI can render instantly on
 * startup while the real load runs in the background. The repos, user,
 * drafts, and review-types options must match exactly, because the
 * review-types filter is baked into the classified results the snapshot
 * stores. The since window may be narrower than the stored one, because
 * a narrower window is a subset that gets cut from the snapshot, by PR
 * creation date for the review results and the sizes and by mention time
 * for the mentions. This also trims relative values like 2w to the
 * current day when the snapshot is from an earlier day. The background
 * refresh replaces the snapshot either way.
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

  const mentions = data.mentions === null ? null : cutMentions(data.mentions, cutoff);

  return {
    ...data,
    sinceIso,
    reviewResults,
    sizes,
    mentions,
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
 * Runs the full fetch pipeline, resolving the user and the teams, searching
 * PRs, and fetching timelines and sizes in batches. Closed PRs, the login,
 * and the team memberships come from the on-disk cache unless bypassCache
 * is set, which refetches everything and rewrites the cached entries. With
 * the mentions option
 * the pipeline also searches the PRs that mention the user and fetches
 * their newest mention. A successful load also becomes the next startup
 * snapshot. Reports progress through onPhase so the UI can show what is
 * happening, and folds every rate-limit pause the GitHub module reports
 * into the current phase, so a load that waits out a limit shows the
 * wait where a stalled spinner would be. Throws CliError on expected
 * failures like a broken gh login, and a RateLimitError when GitHub kept
 * refusing requests through the retries.
 */
export async function loadData(
  options: FetchParams,
  onPhase: (phase: LoadPhase) => void,
  loadOptions: LoadOptions = {},
): Promise<RawData> {
  let phase: LoadPhase = { phase: 'search' };
  let wait: RateLimitWait | null = null;

  const publish = (next: LoadPhase) => {
    phase = next;
    onPhase({ ...phase, wait });
  };

  const unsubscribe = onRateLimitWait((next) => {
    wait = next;
    onPhase({ ...phase, wait });
  });

  try {
    return await runLoad(options, publish, loadOptions);
  } finally {
    unsubscribe();
  }
}

/**
 * Runs the pipeline of loadData once the wait listener is in place, with
 * an onPhase that already folds the current wait into every report.
 */
async function runLoad(
  options: FetchParams,
  onPhase: (phase: LoadPhase) => void,
  { bypassCache = false, mentions = false }: LoadOptions,
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

  /**
   * The mentions search only runs when the load looks for mentions,
   * so a session without mention notifications pays nothing for them.
   * The searches run one after the other, and each starts only once the
   * previous one succeeded, because a search GitHub kept refusing fails
   * the whole load, and searches queued up behind it would otherwise run
   * on through their own retries and hold the gate in the GitHub module
   * against the next reload. The team lookup rides along with the
   * searches, because the classification that needs it only runs once
   * the details are fetched.
   */
  const runSearches = async () => {
    const reviewSearch = await searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'review' });
    const authoredSearch = await searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'authored' });

    const mentionedSearch = mentions
      ? await searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'mentioned' })
      : null;

    return { reviewSearch, authoredSearch, mentionedSearch };
  };

  const [{ reviewSearch, authoredSearch, mentionedSearch }, teams] = await Promise.all([
    runSearches(),
    resolveTeams(user, bypassCache),
  ]);

  const reviewPrs = collectReviewPrs(reviewSearch.items);
  const authoredPrs = collectAuthoredPrs(authoredSearch.items);
  const mentionedPrs = mentionedSearch === null ? null : collectMentionedPrs(mentionedSearch.items);

  const searchCapped = [reviewSearch, authoredSearch, mentionedSearch].some((result) => result?.capped === true);

  /**
   * The timeline, size, and mention fetches are independent, so they run
   * concurrently and the load takes as long as the slowest one. The
   * shared batch gate in the data module keeps the combined request rate
   * within the same bound a single fetch uses. Each fetch reports its own
   * counter, and the sum drives one combined progress bar.
   */
  const progress = { review: 0, sizes: 0, mentions: 0 };
  const total = reviewPrs.length + authoredPrs.length + (mentionedPrs?.length ?? 0);

  const report = () => {
    onPhase({ phase: 'details', done: progress.review + progress.sizes + progress.mentions, total });
  };

  report();

  const countedStates = options.reviewTypes === '' ? undefined : parseReviewTypes(options.reviewTypes);

  const [review, size, mention] = await Promise.all([
    reviewPrs.length === 0
      ? { results: [], cacheHits: 0 }
      : fetchReviewRaw(
          reviewPrs,
          user,
          (done) => {
            progress.review = done;
            report();
          },
          { bypassCache, countedStates, teams },
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
    mentionedPrs === null || mentionedPrs.length === 0
      ? { mentions: [], cacheHits: 0 }
      : fetchMentionsRaw(
          mentionedPrs,
          user,
          (done) => {
            progress.mentions = done;
            report();
          },
          {
            bypassCache,
            since: new Date(sinceIso),
          },
        ),
  ]);

  const data: RawData = {
    user,
    sinceIso,
    repos,
    reviewResults: review.results,
    sizes: size.sizes,
    authoredTotal: authoredPrs.length,
    mentions: mentionedPrs === null ? null : mention.mentions,
    searchCapped,
    fetchedAt: new Date(),
  };

  saveSnapshot(options, data);

  return data;
}
