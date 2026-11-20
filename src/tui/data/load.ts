import { readCacheFile, writeCacheFile } from '../../cache';
import {
  collectAuthoredPrs,
  collectMentionedPrs,
  fetchMentionsRaw,
  fetchReviewRaw,
  fetchSizeRaw,
  mergeRequestedPrs,
  queueResultsOnly,
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
   * Holds null when the load skipped the mention search, which the notification baseline treats
   * differently from none.
   */
  mentions: MentionEntry[] | null;
  searchCapped: boolean;
  fetchedAt: Date;
}

export interface LoadOptions {
  bypassCache?: boolean;
  mentions?: boolean;
}

export interface LoadPhase {
  phase: 'search' | 'details';
  done?: number;
  total?: number;
  wait?: RateLimitWait | null;
}

interface Snapshot {
  params: FetchParams;
  data: RawData;
}

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
 * Filters unread entries by update time because the mention search does.
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

  if (data.reviewResults.some((result) => result.kind === 'unrequested' && Number.isNaN(result.reviewedAt.getTime()))) {
    return null;
  }

  const hasMissingVerdict = data.reviewResults.some((result) => {
    return result.kind === 'reviewed' && (result.verdict as string | undefined) === undefined;
  });

  if (hasMissingVerdict) {
    return null;
  }

  if (sinceIso === data.sinceIso) {
    return data;
  }

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
     * Inaccessible authored PRs have no known creation date, so their count carries over.
     */
    authoredTotal: sizes.length + (data.authoredTotal - data.sizes.length),
  };
}

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

  const [user, repos] = await Promise.all([resolveUser(options.user, bypassCache), resolveRepos(repoNames)]);

  const includeDrafts = options.includeDrafts;

  /**
   * The searches run in sequence because a refused search fails the load, and parallel ones would
   * keep retrying and hold the GitHub gate against the next reload.
   */
  const runSearches = async () => {
    const reviewSearch = await searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'review' });
    const requestedSearch = await searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'requested' });
    const authoredSearch = await searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'authored' });

    const mentionedSearch = mentions
      ? await searchPrs({ user, sinceIso, repos, includeDrafts, mode: 'mentioned' })
      : null;

    return { reviewSearch, requestedSearch, authoredSearch, mentionedSearch };
  };

  const [{ reviewSearch, requestedSearch, authoredSearch, mentionedSearch }, teams] = await Promise.all([
    runSearches(),
    resolveTeams(user, bypassCache),
  ]);

  const { prs: reviewPrs, outsideWindow } = mergeRequestedPrs(reviewSearch.items, requestedSearch.items);
  const authoredPrs = collectAuthoredPrs(authoredSearch.items);
  const mentionedPrs = mentionedSearch === null ? null : collectMentionedPrs(mentionedSearch.items);

  const searchCapped = [reviewSearch, requestedSearch, authoredSearch, mentionedSearch].some(
    (result) => result?.capped === true,
  );

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
    reviewResults: queueResultsOnly(review.results, outsideWindow),
    sizes: size.sizes,
    authoredTotal: authoredPrs.length,
    mentions: mentionedPrs === null ? null : mention.mentions,
    searchCapped,
    fetchedAt: new Date(),
  };

  saveSnapshot(options, data);

  return data;
}
