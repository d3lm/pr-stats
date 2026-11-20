import type { AppViews } from '../hooks/useViewModel';
import {
  activeQueueTab,
  activeStatsTab,
  cycledSubTab,
  PENDING_SUB_TABS,
  STATS_SUB_TABS,
  TABS,
  type BrowseState,
  type QueueTabKey,
  type StatsTabKey,
} from '../state/browse';
import type { Modal } from '../state/ui';
import { theme } from '../theme';
import { mentionActionOf, queueRowAt, snoozeActionOf, unreadMentionRows, type QueueView } from '../views/queue';
import { spansRepos } from '../views/repos';

export function Footer({
  width,
  modal,
  editing,
  browse,
  views,
  copyLinks,
  openError,
  successNotice,
  stale,
}: {
  width: number;
  modal: Modal;
  editing: boolean;
  browse: BrowseState;
  views: AppViews | null;
  copyLinks: boolean;
  openError: string | null;
  successNotice: string | null;
  stale: boolean;
}) {
  const notice = openError ?? successNotice ?? (stale ? 'options changed · press r to reload' : '');
  const check = openError === null && successNotice !== null;

  const noticeWidth = notice === '' ? 0 : notice.length + (check ? 2 : 0) + 2;

  const hints = truncated(hintsFor(modal, editing, browse, views, copyLinks), width - 2 - noticeWidth);

  return (
    <>
      <box height={1}>
        <text wrapMode="none" fg={theme.border}>
          {'─'.repeat(width)}
        </text>
      </box>

      <box
        flexDirection="row"
        height={1}
        marginBottom={1}
        paddingLeft={1}
        paddingRight={1}
        justifyContent="space-between"
      >
        <text wrapMode="none" fg={theme.dim}>
          {hints}
        </text>
        <text wrapMode="none">
          {check && <span fg={theme.success}>✔ </span>}
          <span fg={openError !== null ? theme.error : successNotice !== null ? theme.muted : theme.warn}>
            {notice}
          </span>
        </text>
      </box>
    </>
  );
}

/**
 * Assumes every hint is single-width, so one character is one cell.
 */
function truncated(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return limit <= 1 ? '' : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function queueViewsOf(key: QueueTabKey, views: AppViews) {
  if (key === 'pending') {
    return { view: views.pending, repos: views.pendingRepos, scope: views.pendingScope };
  }

  if (key === 'reviewed') {
    return { view: views.reviewed, repos: views.reviewedRepos, scope: views.reviewedScope };
  }

  if (key === 'mentions') {
    return { view: views.mentions, repos: views.mentionsRepos, scope: views.mentionsScope };
  }

  return { view: views.open, repos: views.openRepos, scope: views.openScope };
}

function statsViewsOf(key: StatsTabKey, views: AppViews | null) {
  if (views === null) {
    return { view: null, repos: [], scope: null };
  }

  if (key === 'merged') {
    return { view: views.merged, repos: views.mergedRepos, scope: views.mergedScope };
  }

  if (key === 'review') {
    return { view: views.review, repos: views.reviewRepos, scope: views.reviewScope };
  }

  if (key === 'size') {
    return { view: views.size, repos: views.sizeRepos, scope: views.sizeScope };
  }

  return { view: views.comments, repos: views.commentRepos, scope: views.commentScope };
}

const TAB_DIGITS = `1-${TABS.length}`;

function subTabHint(browse: BrowseState): string {
  if (browse.tab === 0) {
    return `t ${cycledSubTab(PENDING_SUB_TABS, browse.pendingTab, 1).label.toLowerCase()} · `;
  }

  if (browse.tab === 1) {
    return browse.authoredTab === 'open' ? 't merged stats · ' : 't open PRs · ';
  }

  return `t ${cycledSubTab(STATS_SUB_TABS, browse.statsTab, 1).label.toLowerCase()} · `;
}

function queueKeyHints(view: QueueView | null, cursor: number): string {
  const row = queueRowAt(view, cursor);
  const snoozeAction = snoozeActionOf(row);
  const mentionAction = mentionActionOf(row);

  const snooze = snoozeAction === null ? '' : `s ${snoozeAction} · `;
  const mark = mentionAction === null ? '' : `d mark ${mentionAction} · `;
  const markAll = unreadMentionRows(view).length > 0 ? 'D read all · ' : '';

  return `${snooze}${mark}${markAll}`;
}

function hintsFor(
  modal: Modal,
  editing: boolean,
  browse: BrowseState,
  views: AppViews | null,
  copyLinks: boolean,
): string {
  if (modal === 'options') {
    return editing ? 'enter apply · esc cancel' : '↑/↓ select · enter edit · ←/→ toggle · s save · esc close · q quit';
  }

  if (modal === 'settings') {
    return editing
      ? 'enter apply · esc cancel'
      : '↑/↓ select · tab/1-5 page · enter apply · ←/→ toggle · esc close · q quit';
  }

  if (modal === 'theme') {
    return editing ? 'enter apply · esc cancel' : '↑/↓ select · enter edit hex · esc back · q quit';
  }

  if (modal === 'snooze') {
    return 'enter snooze · esc cancel';
  }

  const toggle = subTabHint(browse);
  const queue = activeQueueTab(browse);

  if (queue !== null) {
    const { view, repos, scope } = views === null ? { view: null, repos: [], scope: null } : queueViewsOf(queue, views);

    if (scope?.view === 'list') {
      return `↑/↓ select · enter open · ${toggle}←/→ tabs · o options · S settings · r reload · R refetch · q quit`;
    }

    const queueKeys = queueKeyHints(view, browse.rowCursors[queue]);
    const action = copyLinks ? 'enter copy link' : 'enter open';

    if (scope !== null && repos.length > 0) {
      return spansRepos(scope.repo)
        ? `↑/↓ select · ${action} · ${queueKeys}${toggle}g group by repo · esc back · o options · S settings · r reload · q quit`
        : `↑/↓ select · ${action} · ${queueKeys}${toggle}esc back · ${TAB_DIGITS} tabs · o options · S settings · r reload · R refetch · q quit`;
    }

    return `↑/↓ select · ${copyLinks ? 'enter copy link' : 'enter open in browser'} · ${queueKeys}${toggle}←/→ tabs · o options · S settings · r reload · R refetch · q quit`;
  }

  const { view, repos, scope } = statsViewsOf(activeStatsTab(browse), views);

  if (scope?.view === 'list') {
    return `↑/↓ select · enter open · ${toggle}←/→ tabs · o options · S settings · r reload · R refetch · q quit`;
  }

  const expand = view?.expandable ? (view.expanded ? 'x collapse · ' : 'x expand · ') : '';

  if (scope !== null && repos.length > 0) {
    return `${toggle}${expand}esc back · j/k scroll · ${TAB_DIGITS} tabs · o options · S settings · r reload · R refetch · q quit`;
  }

  return `${toggle}${expand}${TAB_DIGITS} tabs · j/k scroll · o options · S settings · r reload · R refetch · q quit`;
}
