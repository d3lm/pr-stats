import type { KeyEvent } from '@opentui/core';
import { THEME_COLORS } from '../state/settings';
import { themeColorText } from '../theme';
import type { KeymapContext } from './context';

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
    default: {
      break;
    }
  }
}
