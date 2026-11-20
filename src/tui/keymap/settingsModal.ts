import type { KeyEvent } from '@opentui/core';
import { SETTING_PAGES, SETTINGS } from '../state/settings';
import type { KeymapContext } from './context';
import { digitIndex } from './helpers';
import { handleSettingActionKey } from './settingsActions';
import { handleSettingRowKey } from './settingsRows';

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

      if (handleSettingRowKey(key, setting, context)) {
        break;
      }

      handleSettingActionKey(key, setting, context);

      break;
    }
    default: {
      break;
    }
  }
}
