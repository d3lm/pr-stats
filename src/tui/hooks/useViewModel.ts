import { useMemo } from 'react';
import { parseSizeTarget, parseTarget, parseWorkHours, resolveTimezone } from '../../flags';
import { initBuckets } from '../../report';
import { configureTimeMode } from '../../time';
import type { RawData } from '../data/load';
import { dropVanishedRepo, type PanelScope, type QueueGrouping, type TabScopes } from '../state/browse';
import { targetLabelOf, type OptionsState } from '../state/options';
import { buildOpenAuthoredView, buildPendingReviewView, type QueueView } from '../views/queue';
import {
  buildCommentRepoOptions,
  buildMergedRepoOptions,
  buildOpenRepoOptions,
  buildPendingRepoOptions,
  buildReviewRepoOptions,
  buildSizeRepoOptions,
  type RepoOption,
} from '../views/repos';
import { buildCommentView, buildMergedView, buildReviewView, buildSizeView, type StatsView } from '../views/stats';

/**
 * Resolves the scope a tab actually renders. Data that spans at most one
 * repo has no picker and always shows the aggregate view, and an opened
 * repo that vanished falls back to the picker.
 */
function resolveScope(scope: PanelScope, repos: RepoOption[]): PanelScope {
  if (repos.length === 0) {
    return { view: 'detail', repo: null };
  }

  return dropVanishedRepo(scope, repos);
}

/**
 * Everything the five tabs render, derived from the loaded data and the
 * live options in one synchronous pass.
 */
export interface AppViews {
  pendingRepos: RepoOption[];
  openRepos: RepoOption[];
  mergedRepos: RepoOption[];
  reviewRepos: RepoOption[];
  sizeRepos: RepoOption[];
  commentRepos: RepoOption[];
  pendingScope: PanelScope;
  openScope: PanelScope;
  mergedScope: PanelScope;
  reviewScope: PanelScope;
  sizeScope: PanelScope;
  commentScope: PanelScope;
  /**
   * Holds the view of the opened scope, or null while the tab shows the
   * repo picker instead.
   */
  pending: QueueView | null;
  open: QueueView | null;
  merged: StatsView | null;
  review: StatsView | null;
  size: StatsView | null;
  comments: StatsView | null;
}

/**
 * Derives everything the tabs render from the loaded data, the live
 * options, the per-tab scopes with the queue grouping, and the terminal
 * width. Returns null before the first data arrives. Pure apart from
 * configuring the shared time-mode singleton the compute layers read,
 * which happens right before they run so it stays consistent for this
 * render.
 *
 * The view builders bake the current theme colors into their lines, so
 * the theme epoch invalidates the memo. It changes identity whenever the
 * settings dialog changes the theme, which rebuilds the views with the
 * new colors.
 */
export function useViewModel(
  raw: RawData | null,
  options: OptionsState,
  width: number,
  scopes: TabScopes,
  grouping: QueueGrouping,
  themeEpoch: unknown,
): AppViews | null {
  return useMemo(() => {
    // referenced for the memo alone, the builders read the theme directly
    void themeEpoch;

    /**
     * The compute and format layers read the shared time-mode singleton, so
     * it gets configured here right before they run. Everything below is
     * synchronous, which keeps the singleton consistent for this render.
     */
    configureTimeMode({
      business: !options.wallClock,
      workWindows: parseWorkHours(options.workHours),
      tz: resolveTimezone(options.tz === '' ? undefined : options.tz),
    });

    initBuckets();

    if (!raw) {
      return null;
    }

    const targetHours = options.target === '' ? undefined : parseTarget(options.target);
    const sizeTarget = options.sizeTarget === '' ? undefined : parseSizeTarget(options.sizeTarget);

    const pendingRepos = buildPendingRepoOptions(raw);
    const openRepos = buildOpenRepoOptions(raw);
    const mergedRepos = buildMergedRepoOptions(raw);
    const reviewRepos = buildReviewRepoOptions(raw);
    const sizeRepos = buildSizeRepoOptions(raw);
    const commentRepos = buildCommentRepoOptions(raw);
    const pendingScope = resolveScope(scopes.pending, pendingRepos);
    const openScope = resolveScope(scopes.open, openRepos);
    const mergedScope = resolveScope(scopes.merged, mergedRepos);
    const reviewScope = resolveScope(scopes.review, reviewRepos);
    const sizeScope = resolveScope(scopes.size, sizeRepos);
    const commentScope = resolveScope(scopes.comment, commentRepos);

    const review =
      reviewScope.view === 'detail'
        ? buildReviewView(raw, targetHours, targetLabelOf(options.target), reviewScope.repo, width)
        : null;

    return {
      pendingRepos,
      openRepos,
      mergedRepos,
      reviewRepos,
      sizeRepos,
      commentRepos,
      pendingScope,
      openScope,
      mergedScope,
      reviewScope,
      sizeScope,
      commentScope,
      pending: pendingScope.view === 'detail' ? buildPendingReviewView(raw, pendingScope.repo, grouping.pending) : null,
      open: openScope.view === 'detail' ? buildOpenAuthoredView(raw, openScope.repo, grouping.open) : null,
      merged: mergedScope.view === 'detail' ? buildMergedView(raw, mergedScope.repo, width) : null,
      review,
      size: sizeScope.view === 'detail' ? buildSizeView(raw, sizeTarget, sizeScope.repo, width) : null,
      comments: commentScope.view === 'detail' ? buildCommentView(raw, commentScope.repo, width) : null,
    };
  }, [
    raw,
    options.workHours,
    options.tz,
    options.wallClock,
    options.target,
    options.sizeTarget,
    width,
    scopes.pending,
    scopes.open,
    scopes.merged,
    scopes.review,
    scopes.size,
    scopes.comment,
    grouping.pending,
    grouping.open,
    themeEpoch,
  ]);
}
