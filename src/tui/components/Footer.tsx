import type { AppViews } from '../hooks/useViewModel';
import { activeQueueTab, cycledPendingSubTab, type BrowseState, type QueueTabKey } from '../state/browse';
import type { Modal } from '../state/ui';
import { theme } from '../theme';
import { mentionActionOf, queueRowAt, snoozeActionOf, unreadMentionRows, type QueueView } from '../views/queue';

/**
 * Renders the footer, a full-width rule above one row with the key hints
 * on the left and the notice slot on the right.
 */
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
  /**
   * Holds where the user is, the active tab and sub-tab, the scopes,
   * and the row cursors, which decide the hints for the queue keys, like
   * whether s offers to snooze or to unsnooze the highlighted row and
   * whether d offers to mark its mention read or unread.
   */
  browse: BrowseState;
  views: AppViews | null;
  copyLinks: boolean;
  openError: string | null;
  successNotice: string | null;
  stale: boolean;
}) {
  /**
   * A failure or a success notice takes the right slot over the stale
   * notice, because it answers the action the user just made, and the
   * next keypress brings the stale notice back. The success notice
   * carries a checkmark in front of it.
   */
  const notice = openError ?? successNotice ?? (stale ? 'options changed · press r to reload' : '');
  const check = openError === null && successNotice !== null;

  /**
   * The notice keeps its full width and the hints truncate to the
   * remaining space, so the two never overlap on a narrow terminal. The
   * two cells of padding frame the row and the checkmark takes two more,
   * with a two-cell gap between the hints and the notice.
   */
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
 * Cuts the hint line to the given number of cells with a trailing
 * ellipsis, so a footer notice never overlaps the hints. Every hint is
 * one cell per character, so the string length counts cells.
 */
function truncated(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return limit <= 1 ? '' : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Resolves the derived view, the repo options, and the scope of the given
 * queue tab.
 */
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

/**
 * Names the t hint of the tabs with sub-tabs, which leads with the
 * sub-tab the next press switches to, and is empty on the other tabs.
 */
function subTabHint(browse: BrowseState): string {
  if (browse.tab === 0) {
    return `t ${cycledPendingSubTab(browse.pendingTab, 1).label.toLowerCase()} · `;
  }

  if (browse.tab === 1) {
    return browse.authoredTab === 'open' ? 't merged stats · ' : 't open PRs · ';
  }

  return '';
}

/**
 * Names the hints of the queue keys for the highlighted row of the given
 * queue view, what s does with it, snoozing an awaiting PR or an unread
 * mention or unsnoozing a snoozed one, and what d does with a mention,
 * marking it read or unread again, with the D hint offering to mark
 * every unread mention read while the inbox shows any.
 */
function queueKeyHints(view: QueueView | null, cursor: number): string {
  const row = queueRowAt(view, cursor);
  const snoozeAction = snoozeActionOf(row);
  const mentionAction = mentionActionOf(row);

  const snooze = snoozeAction === null ? '' : `s ${snoozeAction} · `;
  const mark = mentionAction === null ? '' : `d mark ${mentionAction} · `;
  const markAll = unreadMentionRows(view).length > 0 ? 'D read all · ' : '';

  return `${snooze}${mark}${markAll}`;
}

/**
 * Builds the footer hint line for the current input mode. The queue
 * detail hints name what enter does with the highlighted PR, which the
 * copy-links setting flips from opening to copying, followed by the
 * queue keys that apply to the highlighted row. On the tabs with
 * sub-tabs the hints lead with the t toggle that switches to the next
 * sub-tab.
 */
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

  const { tab } = browse;
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
      return scope.repo === null
        ? `↑/↓ select · ${action} · ${queueKeys}${toggle}g group by repo · esc back · o options · S settings · r reload · q quit`
        : `↑/↓ select · ${action} · ${queueKeys}${toggle}esc back · 1-5 tabs · o options · S settings · r reload · R refetch · q quit`;
    }

    return `↑/↓ select · ${copyLinks ? 'enter copy link' : 'enter open in browser'} · ${queueKeys}${toggle}←/→ tabs · o options · S settings · r reload · R refetch · q quit`;
  }

  const scope =
    views === null
      ? null
      : tab === 1
        ? views.mergedScope
        : tab === 2
          ? views.reviewScope
          : tab === 3
            ? views.sizeScope
            : views.commentScope;

  const repos =
    views === null
      ? []
      : tab === 1
        ? views.mergedRepos
        : tab === 2
          ? views.reviewRepos
          : tab === 3
            ? views.sizeRepos
            : views.commentRepos;

  if (scope?.view === 'list') {
    return `↑/↓ select · enter open · ${toggle}←/→ tabs · o options · S settings · r reload · R refetch · q quit`;
  }

  /**
   * The x hint only shows while the open stats view has a capped card to
   * expand, and it flips to collapse while the cap is lifted.
   */
  const view =
    views === null
      ? null
      : tab === 1
        ? views.merged
        : tab === 2
          ? views.review
          : tab === 3
            ? views.size
            : views.comments;

  const expand = view?.expandable ? (view.expanded ? 'x collapse · ' : 'x expand · ') : '';

  if (scope !== null && repos.length > 0) {
    return `${toggle}${expand}esc back · j/k scroll · 1-5 tabs · o options · S settings · r reload · R refetch · q quit`;
  }

  return `${toggle}${expand}1-5 tabs · j/k scroll · o options · S settings · r reload · R refetch · q quit`;
}
