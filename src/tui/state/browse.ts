import type { RepoOption, RepoScope } from '../views/repos';

export const TABS = ['1 Awaiting you', '2 Your PRs', '3 Stats'];

export type QueueTabKey = 'pending' | 'reviewed' | 'mentions' | 'open';

export type StatsSubTab = 'review' | 'size' | 'comment';

export type StatsTabKey = StatsSubTab | 'merged';

export type PendingSubTab = 'pending' | 'reviewed' | 'mentions';

export const PENDING_SUB_TABS: { key: PendingSubTab; label: string }[] = [
  { key: 'pending', label: 'Awaiting review' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'mentions', label: 'Mentions' },
];

export type AuthoredSubTab = 'open' | 'merged';

export const AUTHORED_SUB_TABS: { key: AuthoredSubTab; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'merged', label: 'Merged & closed' },
];

export const STATS_SUB_TABS: { key: StatsSubTab; label: string }[] = [
  { key: 'review', label: 'Review time' },
  { key: 'size', label: 'PR size' },
  { key: 'comment', label: 'Comments' },
];

export function cycledSubTab<K extends string>(
  tabs: readonly { key: K; label: string }[],
  current: K,
  delta: 1 | -1,
): { key: K; label: string } {
  const index = tabs.findIndex((entry) => entry.key === current);

  return tabs[(index + tabs.length + delta) % tabs.length];
}

export type BrowseTabKey = QueueTabKey | StatsTabKey;

export type PanelScope = { view: 'list' } | { view: 'detail'; repo: RepoScope };

export type TabScopes = Record<BrowseTabKey, PanelScope>;

export type QueueGrouping = Record<QueueTabKey, boolean>;

export interface BrowseState {
  tab: number;
  pendingTab: PendingSubTab;
  authoredTab: AuthoredSubTab;
  statsTab: StatsSubTab;
  scopes: TabScopes;
  repoCursors: Record<BrowseTabKey, number>;
  rowCursors: Record<QueueTabKey, number>;
  grouped: QueueGrouping;
  expanded: Record<StatsTabKey, boolean>;
}

export const initialBrowseState: BrowseState = {
  tab: 0,
  pendingTab: 'pending',
  authoredTab: 'open',
  statsTab: 'review',
  scopes: {
    pending: { view: 'list' },
    reviewed: { view: 'list' },
    mentions: { view: 'list' },
    open: { view: 'list' },
    review: { view: 'list' },
    size: { view: 'list' },
    comment: { view: 'list' },
    merged: { view: 'list' },
  },
  repoCursors: { pending: 0, reviewed: 0, mentions: 0, open: 0, review: 0, size: 0, comment: 0, merged: 0 },
  rowCursors: { pending: 0, reviewed: 0, mentions: 0, open: 0 },
  grouped: { pending: false, reviewed: false, mentions: false, open: false },
  expanded: { review: false, size: false, comment: false, merged: false },
};

export function activeQueueTab(state: BrowseState): QueueTabKey | null {
  if (state.tab === 0) {
    return state.pendingTab;
  }

  if (state.tab === 1 && state.authoredTab === 'open') {
    return 'open';
  }

  return null;
}

/**
 * Assumes no queue tab is active.
 */
export function activeStatsTab(state: BrowseState): StatsTabKey {
  if (state.tab === 1) {
    return 'merged';
  }

  return state.statsTab;
}

export type BrowseAction =
  | { type: 'tabSelected'; tab: number }
  | { type: 'tabCycled'; delta: 1 | -1 }
  | { type: 'subTabCycled'; delta: 1 | -1 }
  | { type: 'repoCursorMoved'; tab: BrowseTabKey; delta: 1 | -1; count: number }
  | { type: 'rowCursorMoved'; tab: QueueTabKey; delta: 1 | -1; count: number }
  | { type: 'repoOpened'; tab: BrowseTabKey; repo: RepoScope }
  | { type: 'pickerReturned'; tab: BrowseTabKey }
  | { type: 'groupingToggled'; tab: QueueTabKey }
  | { type: 'expandToggled'; tab: StatsTabKey }
  | { type: 'dataLoaded'; repos: Record<BrowseTabKey, RepoOption[]> };

export function dropVanishedRepo(scope: PanelScope, repos: RepoOption[]): PanelScope {
  if (scope.view === 'detail' && scope.repo !== null && !repos.some((option) => option.repo === scope.repo)) {
    return { view: 'list' };
  }

  return scope;
}

function cycled(previous: number, delta: 1 | -1, count: number): number {
  return (Math.min(previous, count - 1) + count + delta) % count;
}

export function browseReducer(state: BrowseState, action: BrowseAction): BrowseState {
  switch (action.type) {
    case 'tabSelected': {
      return { ...state, tab: action.tab };
    }
    case 'tabCycled': {
      return { ...state, tab: (state.tab + TABS.length + action.delta) % TABS.length };
    }
    case 'subTabCycled': {
      if (state.tab === 0) {
        return { ...state, pendingTab: cycledSubTab(PENDING_SUB_TABS, state.pendingTab, action.delta).key };
      }

      if (state.tab === 1) {
        return { ...state, authoredTab: state.authoredTab === 'open' ? 'merged' : 'open' };
      }

      if (state.tab === 2) {
        return { ...state, statsTab: cycledSubTab(STATS_SUB_TABS, state.statsTab, action.delta).key };
      }

      return state;
    }
    case 'repoCursorMoved': {
      return {
        ...state,
        repoCursors: {
          ...state.repoCursors,
          [action.tab]: cycled(state.repoCursors[action.tab], action.delta, action.count),
        },
      };
    }
    case 'rowCursorMoved': {
      return {
        ...state,
        rowCursors: {
          ...state.rowCursors,
          [action.tab]: cycled(state.rowCursors[action.tab], action.delta, action.count),
        },
      };
    }
    case 'repoOpened': {
      return { ...state, scopes: { ...state.scopes, [action.tab]: { view: 'detail', repo: action.repo } } };
    }
    case 'pickerReturned': {
      return { ...state, scopes: { ...state.scopes, [action.tab]: { view: 'list' } } };
    }
    case 'groupingToggled': {
      return { ...state, grouped: { ...state.grouped, [action.tab]: !state.grouped[action.tab] } };
    }
    case 'expandToggled': {
      return { ...state, expanded: { ...state.expanded, [action.tab]: !state.expanded[action.tab] } };
    }
    case 'dataLoaded': {
      return {
        ...state,
        scopes: {
          pending: dropVanishedRepo(state.scopes.pending, action.repos.pending),
          reviewed: dropVanishedRepo(state.scopes.reviewed, action.repos.reviewed),
          mentions: dropVanishedRepo(state.scopes.mentions, action.repos.mentions),
          open: dropVanishedRepo(state.scopes.open, action.repos.open),
          review: dropVanishedRepo(state.scopes.review, action.repos.review),
          size: dropVanishedRepo(state.scopes.size, action.repos.size),
          comment: dropVanishedRepo(state.scopes.comment, action.repos.comment),
          merged: dropVanishedRepo(state.scopes.merged, action.repos.merged),
        },
      };
    }
    default: {
      return state;
    }
  }
}
