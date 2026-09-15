import type { KeyEvent } from '@opentui/core';
import { SETTING_PAGES, SETTINGS } from '../state/settings';
import type { KeymapContext } from './context';
import { digitIndex } from './helpers';
import { handleSettingActionKey } from './settingsActions';
import { handleSettingRowKey } from './settingsRows';

/**
 * Drives the settings dialog, whose rows spread over the pages of a tab
 * strip. Up and down walk the rows across the page boundaries, tab and
 * shift+tab cycle the pages, and a digit jumps to the page at that
 * position, the way the digits pick the main tabs. Left and right stay
 * with the toggles, which is why the pages take tab instead.
 */
export function handleSettingsModalKey(key: KeyEvent, context: KeymapContext): void {
  const page = digitIndex(key, SETTING_PAGES);

  if (page !== -1) {
    context.dispatchUi({ type: 'settingPageSelected', page });
    return;
  }

  switch (key.name) {
    case 'escape': {
      context.dispatchUi({ type: 'settingsModalEscaped' });

      break;
    }
    case 'tab': {
      context.dispatchUi({ type: 'settingPageCycled', delta: key.shift ? -1 : 1 });

      break;
    }
    case 'up':
    case 'k': {
      context.dispatchUi({ type: 'settingSelectionMoved', delta: -1 });

      break;
    }
    case 'down':
    case 'j': {
      context.dispatchUi({ type: 'settingSelectionMoved', delta: 1 });

      break;
    }
    case 'return':
    case 'space':
    case 'left':
    case 'right': {
      const setting = SETTINGS[context.ui.selectedSetting].key;

      /**
       * The toggles and choices flip or cycle a persisted value, and the
       * rest edit, confirm, or run an action. The row handler reports
       * whether the row was one of its own, so the action handler only
       * sees the others.
       */
      if (handleSettingRowKey(key, setting, context)) {
        break;
      }

      handleSettingActionKey(key, setting, context);

      break;
    }
  }
}
