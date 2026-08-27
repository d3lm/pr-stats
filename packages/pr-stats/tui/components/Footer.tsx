import type { AppViews } from '../hooks/useViewModel';
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
  views,
  openError,
  stale,
}: {
  width: number;
  modal: Modal;
  editing: boolean;
  tab: number;
  views: AppViews | null;
  openError: string | null;
  stale: boolean;
}) {
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
          {hintsFor(modal, editing, tab, views)}
        </text>
        {/**
         * A browser-open failure takes the right slot over the stale
         * notice, because it answers the enter press the user just made,
         * and the next keypress brings the stale notice back.
         */}
        <text wrapMode="none" fg={openError !== null ? theme.error : theme.warn}>
          {openError ?? (stale ? 'options changed · press r to reload' : '')}
        </text>
      </box>
    </>
  );
}

/**
 * Builds the footer hint line for the current input mode.
 */
function hintsFor(modal: Modal, editing: boolean, tab: number, views: AppViews | null): string {
  if (modal === 'options') {
    return editing ? 'enter apply · esc cancel' : '↑/↓ select · enter edit · ←/→ toggle · s save · esc close · q quit';
  }

  if (modal === 'settings') {
    return '↑/↓ select · enter apply · ←/→ toggle · esc close · q quit';
  }

  if (modal === 'theme') {
    return editing ? 'enter apply · esc cancel' : '↑/↓ select · enter edit hex · esc back · q quit';
  }

  if (tab <= 1) {
    const scope = views === null ? null : tab === 0 ? views.pendingScope : views.openScope;
    const repos = views === null ? [] : tab === 0 ? views.pendingRepos : views.openRepos;

    if (scope?.view === 'list') {
      return '↑/↓ select · enter open · ←/→ tabs · o options · s settings · r reload · R refetch · q quit';
    }

    if (scope !== null && repos.length > 0) {
      return scope.repo === null
        ? '↑/↓ select · enter open · g group by repo · esc back · o options · s settings · r reload · q quit'
        : '↑/↓ select · enter open · esc back · 1-5 tabs · o options · s settings · r reload · R refetch · q quit';
    }

    return '↑/↓ select · enter open in browser · ←/→ tabs · o options · s settings · r reload · R refetch · q quit';
  }

  const scope =
    views === null ? null : tab === 2 ? views.reviewScope : tab === 3 ? views.sizeScope : views.commentScope;

  const repos = views === null ? [] : tab === 2 ? views.reviewRepos : tab === 3 ? views.sizeRepos : views.commentRepos;

  if (scope?.view === 'list') {
    return '↑/↓ select · enter open · ←/→ tabs · o options · s settings · r reload · R refetch · q quit';
  }

  if (scope !== null && repos.length > 0) {
    return 'esc back · j/k scroll · 1-5 tabs · o options · s settings · r reload · R refetch · q quit';
  }

  return '1-5 tabs · j/k scroll · o options · s settings · r reload · R refetch · q quit';
}
