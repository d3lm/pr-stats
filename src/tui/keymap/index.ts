import type { KeyEvent } from '@opentui/core';
import { activeQueueTab, TABS } from '../state/browse';
import type { KeymapContext } from './context';
import { digitIndex } from './helpers';
import { handleModalKey } from './modals';
import { handleQueueKey } from './queue';
import { handleStatsKey } from './stats';

export type { KeymapContext } from './context';

function handleTabKey(key: KeyEvent, context: KeymapContext): void {
  const tab = digitIndex(key, TABS);

  if (tab !== -1) {
    context.dispatchBrowse({ type: 'tabSelected', tab });
    return;
  }

  if (key.name === 'left' || (key.name === 'tab' && key.shift)) {
    context.dispatchBrowse({ type: 'tabCycled', delta: -1 });
    return;
  }

  if (key.name === 'right' || key.name === 'tab') {
    context.dispatchBrowse({ type: 'tabCycled', delta: 1 });
    return;
  }

  if (key.name === 't') {
    context.dispatchBrowse({ type: 'subTabCycled', delta: key.shift ? -1 : 1 });
    return;
  }

  const queue = activeQueueTab(context.browse);

  if (queue === null) {
    handleStatsKey(key, context);
  } else {
    handleQueueKey(key, queue, context);
  }
}

export function handleAppKey(key: KeyEvent, context: KeymapContext): void {
  // runs before the handlers, so notices they report survive this keypress
  context.dispatchUi({ type: 'noticesDismissed' });

  if (context.ui.editing) {
    if (key.name === 'escape') {
      context.dispatchUi({ type: 'editCancelled' });
    }

    return;
  }

  if (key.name === 'q') {
    context.quit();
    return;
  }

  if (key.name === 'r') {
    context.reload(key.shift);
    return;
  }

  if (handleModalKey(key, context)) {
    return;
  }

  if (key.name === 's' && key.shift) {
    context.dispatchUi({ type: 'modalOpened', modal: 'settings' });
    return;
  }

  if (key.name === 'o') {
    context.dispatchUi({ type: 'modalOpened', modal: 'options' });
    return;
  }

  handleTabKey(key, context);
}
