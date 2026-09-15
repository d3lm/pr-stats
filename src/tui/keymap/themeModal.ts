import type { KeyEvent } from '@opentui/core';
import { THEME_COLORS } from '../state/settings';
import { themeColorText } from '../theme';
import type { KeymapContext } from './context';

/**
 * Drives the theme colors dialog, which lists every theme color as one
 * selectable row. Enter starts editing the selected color in the App's
 * shared edit mode, whose commit handler applies and persists the value.
 * Escape returns to the settings dialog the list opened from.
 */
export function handleThemeModalKey(key: KeyEvent, context: KeymapContext): void {
  switch (key.name) {
    case 'escape': {
      context.dispatchUi({ type: 'themeModalClosed' });

      break;
    }
    case 'up':
    case 'k': {
      context.dispatchUi({ type: 'themeColorSelectionMoved', delta: -1 });

      break;
    }
    case 'down':
    case 'j': {
      context.dispatchUi({ type: 'themeColorSelectionMoved', delta: 1 });

      break;
    }
    case 'return': {
      context.beginEdit(themeColorText(THEME_COLORS[context.ui.selectedThemeColor].key));

      break;
    }
  }
}
