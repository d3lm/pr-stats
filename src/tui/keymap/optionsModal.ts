import type { KeyEvent } from '@opentui/core';
import { FIELDS, writeSavedOptions } from '../state/options';
import type { KeymapContext } from './context';

/**
 * Drives the options dialog, whose rows list the load options. Up and
 * down move between the rows, enter and the arrows act on the selected
 * row by its kind, and s persists the current options.
 */
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
        /**
         * Opens the checklist dropdown in the shared edit mode. The
         * focused select handles the keys from here, and escape falls
         * back to the edit-cancel path like a text input.
         */
        if (key.name === 'return' || key.name === 'space') {
          context.dispatchUi({ type: 'editStarted' });
        }
      } else if (key.name === 'return') {
        context.beginEdit(String(context.options[field.key]));
      }

      break;
    }
    case 's': {
      /**
       * Persists the current options, so later runs start from them
       * where no flag overrides them. A landed save confirms through
       * the footer's success notice. Debug runs keep the cache disabled,
       * in which case nothing gets stored and the error slot says so.
       */
      const saved = writeSavedOptions(context.options);

      if (saved) {
        context.setSaved(context.options);
      }

      context.dispatchUi({ type: 'optionsSaveReported', saved });

      break;
    }
  }
}
