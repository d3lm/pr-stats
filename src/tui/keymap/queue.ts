import type { KeyEvent } from '@opentui/core';
import { linkUrl } from '../../settings';
import type { AppViews } from '../hooks/useViewModel';
import type { QueueTabKey } from '../state/browse';
import { queueRows, unreadMentionRows, type QueueView } from '../views/queue';
import { spansRepos } from '../views/repos';
import type { PrRow } from '../views/rows';
import type { KeymapContext } from './context';
import { entryAt, handleRepoPickerKey } from './helpers';

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

function openRow(row: PrRow, context: KeymapContext): void {
  if (context.copyLinks) {
    context.copyRow(row);
  } else {
    context.openUrl(linkUrl(row.url, context.openIn), (message) => {
      context.dispatchUi({ type: 'openErrorReported', message });
    });
  }
}

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

function markAllRows(view: QueueView | null, context: KeymapContext): void {
  const unread = unreadMentionRows(view);

  if (unread.length > 0) {
    context.markAllRead(unread);
  }
}

export function handleQueueKey(key: KeyEvent, queue: QueueTabKey, context: KeymapContext): void {
  const { key: tab, view, repos, scope } = queueTabOf(queue, context.views);

  if (handleRepoPickerKey(key, tab, repos, scope, context)) {
    return;
  }

  if (key.name === 'g' && repos.length > 0 && scope?.view === 'detail' && spansRepos(scope.repo)) {
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
    default: {
      break;
    }
  }
}
