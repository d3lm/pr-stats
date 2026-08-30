import type { AppViews } from '../hooks/useViewModel';
import type { AuthoredSubTab } from '../state/browse';
import type { Modal } from '../state/ui';
import { theme } from '../theme';

/**
 * Renders the footer, a full-width rule above one row with the key hints
 * on the left and the notice slot on the right.
 */
export function Footer({
  width,
  modal,
  editing,
  tab,
  authoredTab,
  views,
  copyLinks,
  openError,
  successNotice,
  stale,
}: {
  width: number;
  modal: Modal;
  editing: boolean;
  tab: number;
  authoredTab: AuthoredSubTab;
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
  const hints = truncated(hintsFor(modal, editing, tab, authoredTab, views, copyLinks), width - 2 - noticeWidth);

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
 * Builds the footer hint line for the current input mode. The queue
 * detail hints name what enter does with the highlighted PR, which the
 * copy-links setting flips from opening to copying. On the Your PRs tab
 * the hints lead with the t toggle that switches between the open queue
 * and the merged stats.
 */
function hintsFor(
  modal: Modal,
  editing: boolean,
  tab: number,
  authoredTab: AuthoredSubTab,
  views: AppViews | null,
  copyLinks: boolean,
): string {
  if (modal === 'options') {
    return editing ? 'enter apply · esc cancel' : '↑/↓ select · enter edit · ←/→ toggle · s save · esc close · q quit';
  }

  if (modal === 'settings') {
    return '↑/↓ select · enter apply · ←/→ toggle · esc close · q quit';
  }

  if (modal === 'theme') {
    return editing ? 'enter apply · esc cancel' : '↑/↓ select · enter edit hex · esc back · q quit';
  }

  const toggle = tab === 1 ? (authoredTab === 'open' ? 't merged stats · ' : 't open PRs · ') : '';

  if (tab === 0 || (tab === 1 && authoredTab === 'open')) {
    const scope = views === null ? null : tab === 0 ? views.pendingScope : views.openScope;
    const repos = views === null ? [] : tab === 0 ? views.pendingRepos : views.openRepos;

    if (scope?.view === 'list') {
      return `↑/↓ select · enter open · ${toggle}←/→ tabs · o options · s settings · r reload · R refetch · q quit`;
    }

    const action = copyLinks ? 'enter copy link' : 'enter open';

    if (scope !== null && repos.length > 0) {
      return scope.repo === null
        ? `↑/↓ select · ${action} · ${toggle}g group by repo · esc back · o options · s settings · r reload · q quit`
        : `↑/↓ select · ${action} · ${toggle}esc back · 1-5 tabs · o options · s settings · r reload · R refetch · q quit`;
    }

    return `↑/↓ select · ${copyLinks ? 'enter copy link' : 'enter open in browser'} · ${toggle}←/→ tabs · o options · s settings · r reload · R refetch · q quit`;
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
    return `↑/↓ select · enter open · ${toggle}←/→ tabs · o options · s settings · r reload · R refetch · q quit`;
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
    return `${toggle}${expand}esc back · j/k scroll · 1-5 tabs · o options · s settings · r reload · R refetch · q quit`;
  }

  return `${toggle}${expand}1-5 tabs · j/k scroll · o options · s settings · r reload · R refetch · q quit`;
}
