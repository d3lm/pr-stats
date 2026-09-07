import type { RepoOption } from '../views/repos';

export const TABS = ['1 Awaiting you', '2 Your PRs', '3 Reviews', '4 PR size', '5 Comments'];

/**
 * The queue tabs, which render a selectable PR list with an optional
 * repo grouping. The first three are the sub-tabs of the Awaiting you
 * tab, the awaiting-review queue, the PRs you reviewed, and the mention
 * inbox, and the open key is the first sub-tab of the Your PRs tab.
 */
export type QueueTabKey = 'pending' | 'reviewed' | 'mentions' | 'open';

/**
 * The stats tabs, which render scrollable chart panels. The merged key
 * belongs to the second sub-tab of the Your PRs tab rather than a
 * top-level tab, but it scopes and scrolls like the other three.
 */
export type StatsTabKey = 'review' | 'size' | 'comment' | 'merged';

/**
 * The three sub-tabs of the Awaiting you tab, keyed like the queue tabs
 * they render, in the order the t key cycles them forward and shift+t
 * cycles them backward.
 */
export type PendingSubTab = 'pending' | 'reviewed' | 'mentions';

/**
 * The sub-tabs of the Awaiting you tab with their labels, in the order
 * the t key cycles them and the sub-tab bar lists them.
 */
export const PENDING_SUB_TABS: { key: PendingSubTab; label: string }[] = [
  { key: 'pending', label: 'Awaiting review' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'mentions', label: 'Mentions' },
];

/**
 * The two sub-tabs of the Your PRs tab, the queue of your open PRs and
 * the merged-and-closed stats.
 */
export type AuthoredSubTab = 'open' | 'merged';

/**
 * The sub-tabs of the Your PRs tab with their labels, in the order the
 * t key toggles them and the sub-tab bar lists them.
 */
export const AUTHORED_SUB_TABS: { key: AuthoredSubTab; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'merged', label: 'Merged & closed' },
];

/**
 * Resolves the sub-tab of the Awaiting you tab that sits the given
 * number of steps from the given one in the cycle, wrapping around at
 * both ends, so a delta of 1 names the next sub-tab and a delta of -1
 * names the previous one.
 */
export function cycledPendingSubTab(current: PendingSubTab, delta: 1 | -1): { key: PendingSubTab; label: string } {
  const index = PENDING_SUB_TABS.findIndex((entry) => entry.key === current);

  return PENDING_SUB_TABS[(index + PENDING_SUB_TABS.length + delta) % PENDING_SUB_TABS.length];
}

export type BrowseTabKey = QueueTabKey | StatsTabKey;

/**
 * Tracks what a tab shows when the data spans multiple repos. The list
 * view is the repo picker, and the detail view holds the opened repo,
 * where null means the aggregate across every repo.
 */
export type PanelScope = { view: 'list' } | { view: 'detail'; repo: string | null };

/**
 * Holds the scope of every tab that has a repo picker, keyed by tab.
 */
export type TabScopes = Record<BrowseTabKey, PanelScope>;

/**
 * Holds whether the aggregate view of each queue tab groups its rows by
 * repo.
 */
export type QueueGrouping = Record<QueueTabKey, boolean>;

/**
 * Everything that tracks where the user is in the UI, the active tab, the
 * per-tab scopes, the picker and row cursors, and the queue grouping. One
 * reducer owns it all because these values move together, most visibly
 * when fresh data reconciles every scope in a single transition.
 */
export interface BrowseState {
  tab: number;
  /**
   * Selects which sub-tab the Awaiting you tab shows, the awaiting-review
   * queue, the PRs you reviewed, or the mention inbox.
   */
  pendingTab: PendingSubTab;
  /**
   * Selects which sub-tab the Your PRs tab shows, the open queue or the
   * merged-and-closed stats.
   */
  authoredTab: AuthoredSubTab;
  scopes: TabScopes;
  /**
   * Holds the repo-picker cursor of every tab that has a picker.
   */
  repoCursors: Record<BrowseTabKey, number>;
  /**
   * Holds the PR-row cursor of every queue tab.
   */
  rowCursors: Record<QueueTabKey, number>;
  grouped: QueueGrouping;
  /**
   * Holds whether each stats tab renders its capped comparison cards,
   * like the reviewer leaderboard, with the row cap lifted.
   */
  expanded: Record<StatsTabKey, boolean>;
}

export const initialBrowseState: BrowseState = {
  tab: 0,
  pendingTab: 'pending',
  authoredTab: 'open',
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

/**
 * Names the queue tab the Awaiting you tab or the Your PRs tab currently
 * renders, or null while the Your PRs tab shows its merged stats or
 * another tab is active, so the key handler and the footer can treat
 * every queue the same way.
 */
export function activeQueueTab(state: BrowseState): QueueTabKey | null {
  if (state.tab === 0) {
    return state.pendingTab;
  }

  if (state.tab === 1 && state.authoredTab === 'open') {
    return 'open';
  }

  return null;
}

export type BrowseAction =
  | { type: 'tabSelected'; tab: number }
  | { type: 'tabCycled'; delta: 1 | -1 }
  | { type: 'subTabCycled'; delta: 1 | -1 }
  | { type: 'repoCursorMoved'; tab: BrowseTabKey; delta: 1 | -1; count: number }
  | { type: 'rowCursorMoved'; tab: QueueTabKey; delta: 1 | -1; count: number }
  | { type: 'repoOpened'; tab: BrowseTabKey; repo: string | null }
  | { type: 'pickerReturned'; tab: BrowseTabKey }
  | { type: 'groupingToggled'; tab: QueueTabKey }
  | { type: 'expandToggled'; tab: StatsTabKey }
  | { type: 'dataLoaded'; repos: Record<BrowseTabKey, RepoOption[]> };

/**
 * Returns the picker scope when the given scope opens a repo that the
 * repo options no longer contain, and returns the scope unchanged
 * otherwise. Freshly loaded data runs through this to clear vanished
 * repos out of the scope state, so they do not silently reopen if a
 * later reload brings them back.
 */
export function dropVanishedRepo(scope: PanelScope, repos: RepoOption[]): PanelScope {
  if (scope.view === 'detail' && scope.repo !== null && !repos.some((option) => option.repo === scope.repo)) {
    return { view: 'list' };
  }

  return scope;
}

/**
 * Steps a cursor by one row with wrap-around. The clamp keeps a cursor
 * that outlived a shrinking list inside the new bounds before it moves.
 */
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
      /**
       * The cycle acts on the sub-tabs of the active tab, stepping the
       * three of the Awaiting you tab in the given direction and flipping
       * the two of the Your PRs tab, where both directions land on the
       * same sub-tab, and does nothing on a tab without sub-tabs.
       */
      if (state.tab === 0) {
        return { ...state, pendingTab: cycledPendingSubTab(state.pendingTab, action.delta).key };
      }

      if (state.tab === 1) {
        return { ...state, authoredTab: state.authoredTab === 'open' ? 'merged' : 'open' };
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
  }

  return state;
}
