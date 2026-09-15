import type { KeyEvent } from '@opentui/core';
import { activeQueueTab, TABS } from '../state/browse';
import type { KeymapContext } from './context';
import { digitIndex } from './helpers';
import { handleModalKey } from './modals';
import { handleQueueKey } from './queue';
import { handleStatsKey } from './stats';

export type { KeymapContext } from './context';

/**
 * Drives the tab strip and the active tab while no dialog covers them. The digits pick a main tab, left and right and tab cycle
 * them, t cycles the sub-tabs of the active tab forward and shift+t
 * backward (the three of the Awaiting you tab and the three of the Stats
 * tab, while either flips the Your PRs tab between the open queue and
 * the merged stats), and every other key goes to the queue or the stats
 * handler of the active tab.
 */
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

/**
 * Routes one keypress by input mode, an editing input first, then the
 * global keys, then the open modal, and finally the active tab.
 */
export function handleAppKey(key: KeyEvent, context: KeymapContext): void {
  /**
   * Any keypress dismisses a pending browser-open failure and a success
   * notice. The keypress that copies a PR or saves the options also
   * lands here, which is fine because a failure reports asynchronously
   * and a fresh success notice dispatches after the dismissal.
   */
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

  // shift makes it a hard reload that bypasses the cache
  if (key.name === 'r') {
    context.reload(key.shift);
    return;
  }

  // an open dialog takes the keys, so the tab keys only run while none covers the tabs
  if (handleModalKey(key, context)) {
    return;
  }

  // shift+s opens the settings, which leaves the plain s to the snooze on the queue
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
