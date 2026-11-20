import { useMemo } from 'react';
import {
  DEFAULT_TARGET_PERCENTILE,
  parseSizeTarget,
  parseTarget,
  parseTargetPercentile,
  parseWorkDays,
  parseWorkHours,
  resolveTimezone,
} from '../../flags';
import type { MentionReads } from '../../mentions';
import { initBuckets } from '../../report';
import type { Snooze } from '../../snooze';
import { configureTimeMode } from '../../time';
import type { RawData } from '../data/load';
import {
  dropVanishedRepo,
  type PanelScope,
  type QueueGrouping,
  type StatsTabKey,
  type TabScopes,
} from '../state/browse';
import { targetLabelOf, type OptionsState } from '../state/options';
import {
  buildMentionsView,
  buildOpenAuthoredView,
  buildPendingReviewView,
  buildReviewedView,
  queueAlerts,
  type QueueAlerts,
  type QueueView,
} from '../views/queue';
import {
  buildCommentRepoOptions,
  buildMentionRepoOptions,
  buildMergedRepoOptions,
  buildOpenRepoOptions,
  buildPendingRepoOptions,
  buildReviewedRepoOptions,
  buildReviewRepoOptions,
  buildSizeRepoOptions,
  type RepoOption,
} from '../views/repos';
import {
  buildCommentView,
  buildMergedView,
  buildReviewView,
  buildSizeView,
  type ReviewTarget,
  type StatsView,
} from '../views/stats';

function resolveScope(scope: PanelScope, repos: RepoOption[]): PanelScope {
  if (repos.length === 0) {
    return { view: 'detail', repo: null };
  }

  return dropVanishedRepo(scope, repos);
}

export interface AppViews {
  pendingRepos: RepoOption[];
  reviewedRepos: RepoOption[];
  mentionsRepos: RepoOption[];
  openRepos: RepoOption[];
  mergedRepos: RepoOption[];
  reviewRepos: RepoOption[];
  sizeRepos: RepoOption[];
  commentRepos: RepoOption[];
  pendingScope: PanelScope;
  reviewedScope: PanelScope;
  mentionsScope: PanelScope;
  openScope: PanelScope;
  mergedScope: PanelScope;
  reviewScope: PanelScope;
  sizeScope: PanelScope;
  commentScope: PanelScope;
  pending: QueueView | null;
  reviewed: QueueView | null;
  mentions: QueueView | null;
  open: QueueView | null;
  alerts: QueueAlerts;
  merged: StatsView | null;
  review: StatsView | null;
  size: StatsView | null;
  comments: StatsView | null;
}

export interface TeamViewSettings {
  teamReviews: boolean;
  teamReviewStats: boolean;
}

export function useViewModel(
  raw: RawData | null,
  options: OptionsState,
  width: number,
  scopes: TabScopes,
  grouping: QueueGrouping,
  expanded: Record<StatsTabKey, boolean>,
  snoozes: Snooze[],
  reads: MentionReads,
  { teamReviews, teamReviewStats }: TeamViewSettings,
  themeEpoch: unknown,
): AppViews | null {
  return useMemo(() => {
    // the builders bake theme colors into their lines, so a theme change rebuilds the views
    void themeEpoch;

    // the compute layers read this global, which stays consistent only because the code below is synchronous
    configureTimeMode({
      business: !options.wallClock,
      workWindows: parseWorkHours(options.workHours),
      workDays: parseWorkDays(options.workDays),
      tz: resolveTimezone(options.tz === '' ? undefined : options.tz),
    });

    initBuckets();

    if (!raw) {
      return null;
    }

    const targetLabel = targetLabelOf(options.target);

    const reviewTarget: ReviewTarget | undefined =
      targetLabel === undefined
        ? undefined
        : {
            hours: parseTarget(options.target),
            label: targetLabel,
            percentile:
              options.targetPercentile === ''
                ? DEFAULT_TARGET_PERCENTILE
                : parseTargetPercentile(options.targetPercentile),
          };

    const sizeTarget = options.sizeTarget === '' ? undefined : parseSizeTarget(options.sizeTarget);

    const now = undefined;

    const pendingRepos = buildPendingRepoOptions(raw, snoozes, now, teamReviews);
    const reviewedRepos = buildReviewedRepoOptions(raw);
    const mentionsRepos = buildMentionRepoOptions(raw, snoozes, reads);
    const openRepos = buildOpenRepoOptions(raw);
    const mergedRepos = buildMergedRepoOptions(raw);
    const reviewRepos = buildReviewRepoOptions(raw, teamReviewStats);
    const sizeRepos = buildSizeRepoOptions(raw);
    const commentRepos = buildCommentRepoOptions(raw);
    const pendingScope = resolveScope(scopes.pending, pendingRepos);
    const reviewedScope = resolveScope(scopes.reviewed, reviewedRepos);
    const mentionsScope = resolveScope(scopes.mentions, mentionsRepos);
    const openScope = resolveScope(scopes.open, openRepos);
    const mergedScope = resolveScope(scopes.merged, mergedRepos);
    const reviewScope = resolveScope(scopes.review, reviewRepos);
    const sizeScope = resolveScope(scopes.size, sizeRepos);
    const commentScope = resolveScope(scopes.comment, commentRepos);

    const review =
      reviewScope.view === 'detail'
        ? buildReviewView(raw, reviewTarget, reviewScope.repo, width, expanded.review, teamReviewStats)
        : null;

    return {
      pendingRepos,
      reviewedRepos,
      mentionsRepos,
      openRepos,
      mergedRepos,
      reviewRepos,
      sizeRepos,
      commentRepos,
      pendingScope,
      reviewedScope,
      mentionsScope,
      openScope,
      mergedScope,
      reviewScope,
      sizeScope,
      commentScope,
      pending:
        pendingScope.view === 'detail'
          ? buildPendingReviewView(raw, pendingScope.repo, grouping.pending, snoozes, reads, now, teamReviews)
          : null,
      reviewed:
        reviewedScope.view === 'detail'
          ? buildReviewedView(raw, reviewedScope.repo, grouping.reviewed, snoozes, reads)
          : null,
      mentions:
        mentionsScope.view === 'detail'
          ? buildMentionsView(raw, mentionsScope.repo, grouping.mentions, snoozes, reads)
          : null,
      open: openScope.view === 'detail' ? buildOpenAuthoredView(raw, openScope.repo, grouping.open) : null,
      alerts: queueAlerts(raw, snoozes, reads, now, teamReviews),
      merged: mergedScope.view === 'detail' ? buildMergedView(raw, mergedScope.repo, width, expanded.merged) : null,
      review,
      size: sizeScope.view === 'detail' ? buildSizeView(raw, sizeTarget, sizeScope.repo, width) : null,
      comments: commentScope.view === 'detail' ? buildCommentView(raw, commentScope.repo, width) : null,
    };
  }, [
    raw,
    options.workDays,
    options.workHours,
    options.tz,
    options.wallClock,
    options.target,
    options.targetPercentile,
    options.sizeTarget,
    width,
    scopes.pending,
    scopes.reviewed,
    scopes.mentions,
    scopes.open,
    scopes.merged,
    scopes.review,
    scopes.size,
    scopes.comment,
    grouping.pending,
    grouping.reviewed,
    grouping.mentions,
    grouping.open,
    expanded.review,
    expanded.merged,
    snoozes,
    reads,
    teamReviews,
    teamReviewStats,
    themeEpoch,
  ]);
}
