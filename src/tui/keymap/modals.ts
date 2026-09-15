import type { KeyEvent } from '@opentui/core';
import type { KeymapContext } from './context';
import { handleOptionsModalKey } from './optionsModal';
import { handleSettingsModalKey } from './settingsModal';
import { handleThemeModalKey } from './themeModal';

/**
 * Routes a keypress to the open dialog and reports whether one took it.
 * The snooze dialog is not here, because it edits and the editing branch
 * of handleAppKey covers it first.
 */
export function handleModalKey(key: KeyEvent, context: KeymapContext): boolean {
  switch (context.ui.modal) {
    case 'options': {
      handleOptionsModalKey(key, context);

      return true;
    }
    case 'settings': {
      handleSettingsModalKey(key, context);

      return true;
    }
    case 'theme': {
      handleThemeModalKey(key, context);

      return true;
    }
    default: {
      return false;
    }
  }
}
