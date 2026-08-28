import type { ScrollBoxRenderable } from '@opentui/core';
import type { RefObject } from 'react';
import type { LoadPhase } from '../data/load';
import type { AppViews } from '../hooks/useViewModel';
import type { BrowseState, PanelScope } from '../state/browse';
import { queueRows, type QueueView } from '../views/queue';
import type { RepoOption } from '../views/repos';
import type { PrRow } from '../views/rows';
import type { StatsView } from '../views/stats';
import { ChartsPanel } from './ChartsPanel';
import { Placeholder } from './Placeholder';
import { QueuePanel } from './QueuePanel';
import { RepoList } from './RepoList';
import { SubTabBar } from './TabBar';

/**
 * One queue tab, either the repo picker or the selectable PR list of the
 * opened scope. The scope comes resolved from the view model, so a
 * single-repo dataset skips the picker.
 */
function QueueTab({
  prompt,
  repos,
  scope,
  view,
  repoCursor,
  rowCursor,
  grouped,
  warning,
  onRefClick,
}: {
  prompt: string;
  repos: RepoOption[];
  scope: PanelScope;
  view: QueueView | null;
  repoCursor: number;
  rowCursor: number;
  grouped: boolean;
  warning: string | null;
  onRefClick: ((row: PrRow) => void) | null;
}) {
  if (scope.view === 'list') {
    return <RepoList prompt={prompt} options={repos} cursor={Math.min(repoCursor, repos.length - 1)} />;
  }

  if (view === null) {
    return null;
  }

  return (
    <QueuePanel
      heading={repos.length > 0 ? (scope.repo ?? (grouped ? 'All repos · grouped by repo' : 'All repos')) : null}
      warning={warning}
      empty={view.empty}
      lists={view.lists}
      cursor={Math.min(rowCursor, queueRows(view).length - 1)}
      onRefClick={onRefClick}
    />
  );
}

/**
 * One stats tab, either the repo picker or the chart panel of the opened
 * scope.
 */
function StatsTab({
  repos,
  scope,
  view,
  cursor,
  scrollRef,
  focused,
  warning,
}: {
  repos: RepoOption[];
  scope: PanelScope;
  view: StatsView | null;
  cursor: number;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  focused: boolean;
  warning: string | null;
}) {
  if (scope.view === 'list') {
    return <RepoList options={repos} cursor={Math.min(cursor, repos.length - 1)} />;
  }

  if (view === null) {
    return null;
  }

  return (
    <ChartsPanel
      scrollRef={scrollRef}
      focused={focused}
      heading={repos.length > 0 ? (scope.repo ?? 'All repos') : null}
      warning={warning}
      view={view}
    />
  );
}

/**
 * The content area between the tab bar and the footer. Renders the active
 * tab from the derived views and the browse state, and falls back to the
 * placeholder with the load progress or the load error while there is no
 * data yet.
 */
export function MainPanel({
  views,
  browse,
  warning,
  focused,
  scrollRefs,
  error,
  loading,
  load,
  onRefClick,
}: {
  views: AppViews | null;
  browse: BrowseState;
  /**
   * Holds the search-cap warning that the opened panels render above
   * their content, or null when no search hit the cap.
   */
  warning: string | null;
  /**
   * Marks the charts pane of the active stats tab as the scroll focus,
   * which an open modal takes away.
   */
  focused: boolean;
  scrollRefs: Record<'review' | 'size' | 'comment' | 'merged', RefObject<ScrollBoxRenderable | null>>;
  error: string | null;
  loading: boolean;
  load: LoadPhase | null;
  /**
   * Receives the queue row whose PR reference was clicked while the
   * copy-links setting is on, and is null while links open through the
   * terminal.
   */
  onRefClick: ((row: PrRow) => void) | null;
}) {
  return (
    <box flexGrow={1} flexDirection="column" marginTop={1}>
      {views === null ? (
        <Placeholder error={error} loading={loading} load={load} />
      ) : browse.tab === 0 ? (
        <QueueTab
          prompt="Select a repository and press enter to open its review queue."
          repos={views.pendingRepos}
          scope={views.pendingScope}
          view={views.pending}
          repoCursor={browse.repoCursors.pending}
          rowCursor={browse.rowCursors.pending}
          grouped={browse.grouped.pending}
          warning={warning}
          onRefClick={onRefClick}
        />
      ) : browse.tab === 1 ? (
        <box flexGrow={1} flexDirection="column">
          <SubTabBar active={browse.authoredTab} />
          {browse.authoredTab === 'open' ? (
            <QueueTab
              prompt="Select a repository and press enter to list its open PRs."
              repos={views.openRepos}
              scope={views.openScope}
              view={views.open}
              repoCursor={browse.repoCursors.open}
              rowCursor={browse.rowCursors.open}
              grouped={browse.grouped.open}
              warning={warning}
              onRefClick={onRefClick}
            />
          ) : (
            <StatsTab
              repos={views.mergedRepos}
              scope={views.mergedScope}
              view={views.merged}
              cursor={browse.repoCursors.merged}
              scrollRef={scrollRefs.merged}
              focused={focused}
              warning={warning}
            />
          )}
        </box>
      ) : browse.tab === 2 ? (
        <StatsTab
          repos={views.reviewRepos}
          scope={views.reviewScope}
          view={views.review}
          cursor={browse.repoCursors.review}
          scrollRef={scrollRefs.review}
          focused={focused}
          warning={warning}
        />
      ) : browse.tab === 3 ? (
        <StatsTab
          repos={views.sizeRepos}
          scope={views.sizeScope}
          view={views.size}
          cursor={browse.repoCursors.size}
          scrollRef={scrollRefs.size}
          focused={focused}
          warning={warning}
        />
      ) : (
        <StatsTab
          repos={views.commentRepos}
          scope={views.commentScope}
          view={views.comments}
          cursor={browse.repoCursors.comment}
          scrollRef={scrollRefs.comment}
          focused={focused}
          warning={warning}
        />
      )}
    </box>
  );
}
