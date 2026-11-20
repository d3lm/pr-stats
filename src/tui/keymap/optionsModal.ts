import type { KeyEvent } from '@opentui/core';
import { FIELDS, writeSavedOptions } from '../state/options';
import type { KeymapContext } from './context';

export function handleOptionsModalKey(key: KeyEvent, context: KeymapContext): void {
  switch (key.name) {
    case 'escape': {
      context.dispatchUi({ type: 'optionsModalClosed' });

      break;
    }
    case 'up':
    case 'k': {
      context.dispatchUi({ type: 'fieldSelectionMoved', delta: -1 });

      break;
    }
    case 'down':
    case 'j': {
      context.dispatchUi({ type: 'fieldSelectionMoved', delta: 1 });

      break;
    }
    case 'return':
    case 'space':
    case 'left':
    case 'right': {
      const field = FIELDS[context.ui.selectedField];

      if (field.kind === 'toggle') {
        context.setOptions((previous) => {
          return { ...previous, [field.key]: !previous[field.key] };
        });
      } else if (field.kind === 'multi') {
        if (key.name === 'return' || key.name === 'space') {
          context.dispatchUi({ type: 'editStarted' });
        }
      } else if (key.name === 'return') {
        context.beginEdit(String(context.options[field.key]));
      }

      break;
    }
    case 's': {
      const saved = writeSavedOptions(context.options);

      if (saved) {
        context.setSaved(context.options);
      }

      context.dispatchUi({ type: 'optionsSaveReported', saved });

      break;
    }
    default: {
      break;
    }
  }
}
