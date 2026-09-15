import type { KeyEvent } from '@opentui/core';
import { linkUrl } from '../../settings';
import type { AppViews } from '../hooks/useViewModel';
import type { QueueTabKey } from '../state/browse';
import { queueRows, unreadMentionRows, type QueueView } from '../views/queue';
import type { PrRow } from '../views/rows';
import type { KeymapContext } from './context';
import { entryAt, handleRepoPickerKey } from './helpers';

/**
 * Resolves the derived views and the state key of the given queue tab,
 * so the key handler below works the same on the three sub-tabs of the
 * Awaiting you tab and on the open-PRs tab.
 */
function queueTabOf(key: QueueTabKey, views: AppViews | null) {
  if (key === 'pending') {
    return { key, view: views?.pending ?? null, repos: views?.pendingRepos ?? [], scope: views?.pendingScope ?? null };
  }

  if (key === 'reviewed') {
    return {
      key,
      view: views?.reviewed ?? null,
      repos: views?.reviewedRepos ?? [],
      scope: views?.reviewedScope ?? null,
    };
  }

  if (key === 'mentions') {
    return {
      key,
      view: views?.mentions ?? null,
      repos: views?.mentionsRepos ?? [],
      scope: views?.mentionsScope ?? null,
    };
  }

  return { key, view: views?.open ?? null, repos: views?.openRepos ?? [], scope: views?.openScope ?? null };
}

/**
 * Opens the PR of the row under the cursor on the site the open-in
 * setting names, or copies its link while the copy-links setting is on,
 * and reports a failed open in the footer.
 */
function openRow(row: PrRow, context: KeymapContext): void {
  if (context.copyLinks) {
    context.copyRow(row);
  } else {
    context.openUrl(linkUrl(row.url, context.openIn), (message) => {
      context.dispatchUi({ type: 'openErrorReported', message });
    });
  }
}

/**
 * Snoozes or unsnoozes the row under the cursor. Only the pending rows
 * and the inbox rows carry an ask to park, so the reviewed queue, the
 * read mentions, and the open authored PRs ignore the key. A snoozed row
 * unsnoozes right away, and an awaiting or unread row opens the snooze
 * dialog, which starts in the edit mode with the default duration as
 * the draft.
 */
function snoozeRow(row: PrRow, context: KeymapContext): void {
  const ask =
    row.pending !== undefined
      ? { kind: 'review' as const, at: row.pending.requestedAt }
      : row.mention !== undefined && row.mention.state !== 'read'
        ? { kind: 'mention' as const, at: row.mention.mark.at, ids: row.mention.mark.ids }
        : null;

  if (ask === null) {
    return;
  }

  if (row.pending?.snoozed ?? row.mention?.state === 'snoozed') {
    context.unsnooze({ kind: ask.kind, ref: row.ref });
    return;
  }

  context.dispatchUi({ type: 'snoozeModalOpened', target: { ...ask, ref: row.ref, title: row.title } });

  context.beginEdit(context.snoozeDuration);
}

/**
 * Acts on the d key for the row under the cursor. The key marks an
 * unread or a snoozed mention read and a read one unread again, and
 * leaves every row without a mention alone.
 */
function markRow(row: PrRow, context: KeymapContext): void {
  if (row.mention === undefined) {
    return;
  }

  if (row.mention.state === 'read') {
    context.markUnread(row);
  } else {
    context.markRead(row);
  }
}

/**
 * Marks every unread mention on screen read in one go, which clears the
 * inbox of the opened scope.
 */
function markAllRows(view: QueueView | null, context: KeymapContext): void {
  const unread = unreadMentionRows(view);

  if (unread.length > 0) {
    context.markAllRead(unread);
  }
}

/**
 * The queue tabs open on a repo picker when the data spans multiple
 * repos, like the stats tabs, and otherwise render one selectable PR
 * list, whose cursor the movement keys drive and whose highlighted PR
 * enter opens in the browser. On the aggregate list, g toggles grouping
 * the rows by repo. On the awaiting queue, s opens the snooze dialog for
 * an awaiting PR and unsnoozes a snoozed one, and on the mention inbox
 * it does the same for an unread mention, while shift+s opens the
 * settings before the key gets here. On the inbox, d marks the mention
 * under the cursor read, or unread again from the read list, and shift+d
 * marks every unread mention on screen read. The panel scrolls the
 * cursor row into view on its own.
 */
export function handleQueueKey(key: KeyEvent, queue: QueueTabKey, context: KeymapContext): void {
  const { key: tab, view, repos, scope } = queueTabOf(queue, context.views);

  if (handleRepoPickerKey(key, tab, repos, scope, context)) {
    return;
  }

  if (key.name === 'g' && repos.length > 0 && scope?.view === 'detail' && scope.repo === null) {
    context.dispatchBrowse({ type: 'groupingToggled', tab });
    return;
  }

  const rows = view === null ? [] : queueRows(view);

  if (rows.length === 0) {
    return;
  }

  const row = entryAt(rows, context.browse.rowCursors[tab]);

  switch (key.name) {
    case 'up':
    case 'k': {
      context.dispatchBrowse({ type: 'rowCursorMoved', tab, delta: -1, count: rows.length });

      break;
    }
    case 'down':
    case 'j': {
      context.dispatchBrowse({ type: 'rowCursorMoved', tab, delta: 1, count: rows.length });

      break;
    }
    case 'return': {
      openRow(row, context);

      break;
    }
    case 's': {
      snoozeRow(row, context);

      break;
    }
    case 'd': {
      if (key.shift) {
        markAllRows(view, context);
      } else {
        markRow(row, context);
      }

      break;
    }
  }
}
