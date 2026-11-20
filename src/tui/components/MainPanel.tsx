import type { ScrollBoxRenderable } from '@opentui/core';
import type { RefObject } from 'react';
import type { LinkTarget } from '../../settings';
import type { LoadPhase } from '../data/load';
import type { AppViews } from '../hooks/useViewModel';
import {
  AUTHORED_SUB_TABS,
  PENDING_SUB_TABS,
  STATS_SUB_TABS,
  type BrowseState,
  type PanelScope,
  type StatsTabKey,
} from '../state/browse';
import { queueRows, type QueueView } from '../views/queue';
import { scopeLabel, spansRepos, type RepoOption } from '../views/repos';
import type { PrRow } from '../views/rows';
import type { StatsView } from '../views/stats';
import { ChartsPanel } from './ChartsPanel';
import { Placeholder } from './Placeholder';
import { QueuePanel } from './QueuePanel';
import { RepoList } from './RepoList';
import { SubTabBar } from './TabBar';

function QueueTab({
  prompt,
  repos,
  scope,
  view,
  repoCursor,
  rowCursor,
  grouped,
  warning,
  openIn,
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
  openIn: LinkTarget;
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
      heading={
        repos.length > 0
          ? scopeLabel(scope.repo) + (grouped && spansRepos(scope.repo) ? ' · grouped by repo' : '')
          : null
      }
      warning={warning}
      empty={view.empty}
      sections={view.sections}
      cursor={Math.min(rowCursor, queueRows(view).length - 1)}
      openIn={openIn}
      onRefClick={onRefClick}
    />
  );
}

function StatsTab({
  repos,
  scope,
  view,
  cursor,
  scrollRef,
  warning,
  openIn,
}: {
  repos: RepoOption[];
  scope: PanelScope;
  view: StatsView | null;
  cursor: number;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  warning: string | null;
  openIn: LinkTarget;
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
      heading={repos.length > 0 ? scopeLabel(scope.repo) : null}
      warning={warning}
      view={view}
      openIn={openIn}
    />
  );
}

export function MainPanel({
  views,
  browse,
  warning,
  scrollRefs,
  error,
  loading,
  load,
  openIn,
  onRefClick,
}: {
  views: AppViews | null;
  browse: BrowseState;
  warning: string | null;
  scrollRefs: Record<StatsTabKey, RefObject<ScrollBoxRenderable | null>>;
  error: string | null;
  loading: boolean;
  load: LoadPhase | null;
  openIn: LinkTarget;
  onRefClick: ((row: PrRow) => void) | null;
}) {
  return (
    <box flexGrow={1} flexDirection="column" marginTop={1}>
      {views === null ? (
        <Placeholder error={error} loading={loading} load={load} />
      ) : browse.tab === 0 ? (
        <box flexGrow={1} flexDirection="column">
          <SubTabBar tabs={PENDING_SUB_TABS} active={browse.pendingTab} alerts={views.alerts} />
          {browse.pendingTab === 'pending' ? (
            <QueueTab
              prompt="Select a repository and press enter to open its review queue."
              repos={views.pendingRepos}
              scope={views.pendingScope}
              view={views.pending}
              repoCursor={browse.repoCursors.pending}
              rowCursor={browse.rowCursors.pending}
              grouped={browse.grouped.pending}
              warning={warning}
              openIn={openIn}
              onRefClick={onRefClick}
            />
          ) : browse.pendingTab === 'reviewed' ? (
            <QueueTab
              prompt="Select a repository and press enter to list the open PRs you reviewed."
              repos={views.reviewedRepos}
              scope={views.reviewedScope}
              view={views.reviewed}
              repoCursor={browse.repoCursors.reviewed}
              rowCursor={browse.rowCursors.reviewed}
              grouped={browse.grouped.reviewed}
              warning={warning}
              openIn={openIn}
              onRefClick={onRefClick}
            />
          ) : (
            <QueueTab
              prompt="Select a repository and press enter to open its mention inbox."
              repos={views.mentionsRepos}
              scope={views.mentionsScope}
              view={views.mentions}
              repoCursor={browse.repoCursors.mentions}
              rowCursor={browse.rowCursors.mentions}
              grouped={browse.grouped.mentions}
              warning={warning}
              openIn={openIn}
              onRefClick={onRefClick}
            />
          )}
        </box>
      ) : browse.tab === 1 ? (
        <box flexGrow={1} flexDirection="column">
          <SubTabBar tabs={AUTHORED_SUB_TABS} active={browse.authoredTab} />
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
              openIn={openIn}
              onRefClick={onRefClick}
            />
          ) : (
            <StatsTab
              repos={views.mergedRepos}
              scope={views.mergedScope}
              view={views.merged}
              cursor={browse.repoCursors.merged}
              scrollRef={scrollRefs.merged}
              warning={warning}
              openIn={openIn}
            />
          )}
        </box>
      ) : (
        <box flexGrow={1} flexDirection="column">
          <SubTabBar tabs={STATS_SUB_TABS} active={browse.statsTab} />
          {browse.statsTab === 'review' ? (
            <StatsTab
              key="review"
              repos={views.reviewRepos}
              scope={views.reviewScope}
              view={views.review}
              cursor={browse.repoCursors.review}
              scrollRef={scrollRefs.review}
              warning={warning}
              openIn={openIn}
            />
          ) : browse.statsTab === 'size' ? (
            <StatsTab
              key="size"
              repos={views.sizeRepos}
              scope={views.sizeScope}
              view={views.size}
              cursor={browse.repoCursors.size}
              scrollRef={scrollRefs.size}
              warning={warning}
              openIn={openIn}
            />
          ) : (
            <StatsTab
              key="comment"
              repos={views.commentRepos}
              scope={views.commentScope}
              view={views.comments}
              cursor={browse.repoCursors.comment}
              scrollRef={scrollRefs.comment}
              warning={warning}
              openIn={openIn}
            />
          )}
        </box>
      )}
    </box>
  );
}
