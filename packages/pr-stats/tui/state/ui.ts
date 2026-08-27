import { FIELDS } from './options';
import { SETTINGS, THEME_COLORS, type CacheAction } from './settings';

/**
 * Names the dialog currently covering the charts, where null means none is
 * open. The options dialog edits the data and analysis options, the
 * settings dialog holds app-level settings like the cache and the theme,
 * and the theme dialog opens from the settings dialog with the editable
 * color list.
 */
export type Modal = 'options' | 'settings' | 'theme' | null;

/**
 * Everything that tracks the dialogs and their feedback, the open modal,
 * the edit mode, the selected row of each dialog, the validation errors,
 * the settings-action message, and the browser-open failure. One reducer
 * owns it all because these values move together, like a selection move
 * clearing the row's error or an escape closing the dialog and its
 * feedback at once.
 */
export interface UiState {
  modal: Modal;
  editing: boolean;
  selectedField: number;
  selectedSetting: number;
  selectedThemeColor: number;
  fieldError: string | null;
  themeColorError: string | null;
  cacheAction: CacheAction | null;
  openError: string | null;
}

export const initialUiState: UiState = {
  modal: null,
  editing: false,
  selectedField: 0,
  selectedSetting: 0,
  selectedThemeColor: 0,
  fieldError: null,
  themeColorError: null,
  cacheAction: null,
  openError: null,
};

export type UiAction =
  | { type: 'openErrorDismissed' }
  | { type: 'openErrorReported'; message: string }
  | { type: 'modalOpened'; modal: 'options' | 'settings' | 'theme' }
  | { type: 'optionsModalClosed' }
  | { type: 'settingsModalEscaped' }
  | { type: 'themeModalClosed' }
  | { type: 'fieldSelectionMoved'; delta: 1 | -1 }
  | { type: 'settingSelectionMoved'; delta: 1 | -1 }
  | { type: 'themeColorSelectionMoved'; delta: 1 | -1 }
  | { type: 'editStarted' }
  | { type: 'editCancelled' }
  | { type: 'fieldCommitted' }
  | { type: 'fieldErrorReported'; message: string }
  | { type: 'optionsSaveReported'; saved: boolean }
  | { type: 'themeColorCommitted'; action: CacheAction }
  | { type: 'themeColorErrorReported'; message: string }
  | { type: 'cacheActionReported'; action: CacheAction };

/**
 * Steps a dialog selection by one row with wrap-around.
 */
function cycled(previous: number, delta: 1 | -1, count: number): number {
  return (previous + count + delta) % count;
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'openErrorDismissed': {
      // returning the same state skips the re-render, and every keypress dispatches this
      return state.openError === null ? state : { ...state, openError: null };
    }
    case 'openErrorReported': {
      return { ...state, openError: action.message };
    }
    case 'modalOpened': {
      return { ...state, modal: action.modal, fieldError: null, themeColorError: null, cacheAction: null };
    }
    case 'optionsModalClosed': {
      return { ...state, modal: null, fieldError: null };
    }
    case 'settingsModalEscaped': {
      // the first escape only backs out of a pending confirmation
      if (state.cacheAction === 'confirm' || state.cacheAction === 'resetConfirm') {
        return { ...state, cacheAction: null };
      }

      return { ...state, modal: null, cacheAction: null };
    }
    case 'themeModalClosed': {
      return { ...state, modal: 'settings', themeColorError: null, cacheAction: null };
    }
    case 'fieldSelectionMoved': {
      return { ...state, selectedField: cycled(state.selectedField, action.delta, FIELDS.length), fieldError: null };
    }
    case 'settingSelectionMoved': {
      return {
        ...state,
        selectedSetting: cycled(state.selectedSetting, action.delta, SETTINGS.length),
        cacheAction: null,
      };
    }
    case 'themeColorSelectionMoved': {
      return {
        ...state,
        selectedThemeColor: cycled(state.selectedThemeColor, action.delta, THEME_COLORS.length),
        themeColorError: null,
        cacheAction: null,
      };
    }
    case 'editStarted': {
      return { ...state, editing: true, fieldError: null, themeColorError: null };
    }
    case 'editCancelled': {
      return { ...state, editing: false, fieldError: null, themeColorError: null };
    }
    case 'fieldCommitted': {
      return { ...state, editing: false, fieldError: null };
    }
    case 'fieldErrorReported': {
      return { ...state, fieldError: action.message };
    }
    case 'optionsSaveReported': {
      return {
        ...state,
        fieldError: action.saved ? null : 'the cache is disabled for this session · options not saved',
      };
    }
    case 'themeColorCommitted': {
      return { ...state, editing: false, themeColorError: null, cacheAction: action.action };
    }
    case 'themeColorErrorReported': {
      return { ...state, themeColorError: action.message };
    }
    case 'cacheActionReported': {
      return { ...state, cacheAction: action.action };
    }
  }

  return state;
}
