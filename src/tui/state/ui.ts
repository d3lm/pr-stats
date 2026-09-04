import { FIELDS } from './options';
import { SETTINGS, THEME_COLORS, type CacheAction } from './settings';

/**
 * Names the dialog currently covering the charts, where null means none is
 * open. The options dialog edits the data and analysis options, the
 * settings dialog holds app-level settings like the cache and the theme,
 * the theme dialog opens from the settings dialog with the editable color
 * list, and the snooze dialog asks how long to park the highlighted PR of
 * the awaiting-review queue.
 */
export type Modal = 'options' | 'settings' | 'theme' | 'snooze' | null;

/**
 * Names the PR the snooze dialog is about, with the request time the
 * snooze records so a later re-request voids it.
 */
export interface SnoozeTarget {
  ref: string;
  title: string;
  requestedAt: number;
}

/**
 * Everything that tracks the dialogs and their feedback, the open modal,
 * the edit mode, the selected row of each dialog, the validation errors,
 * the settings-action message, the browser-open failure, and the success
 * notice. One reducer owns it all because these values move together,
 * like a selection move clearing the row's error or an escape closing
 * the dialog and its feedback at once.
 */
export interface UiState {
  modal: Modal;
  editing: boolean;
  selectedField: number;
  selectedSetting: number;
  selectedThemeColor: number;
  fieldError: string | null;
  /**
   * Holds the validation error of the reload interval edit in the
   * settings dialog, shown in place of the row hint until the next edit,
   * selection move, or escape.
   */
  settingError: string | null;
  themeColorError: string | null;
  /**
   * Holds the PR the open snooze dialog is about, or null while no
   * snooze dialog is open.
   */
  snoozeTarget: SnoozeTarget | null;
  /**
   * Holds the validation error of the duration edit in the snooze
   * dialog, shown in place of the dialog hint until the next edit or
   * escape.
   */
  snoozeError: string | null;
  cacheAction: CacheAction | null;
  openError: string | null;
  /**
   * Holds the success confirmation the footer shows with a checkmark,
   * like a copied link, a saved options report, or a snoozed PR. Every
   * report stores a fresh object even when the text repeats, which
   * restarts the App's expiry timer through the changed identity.
   */
  successNotice: { text: string } | null;
}

export const initialUiState: UiState = {
  modal: null,
  editing: false,
  selectedField: 0,
  selectedSetting: 0,
  selectedThemeColor: 0,
  fieldError: null,
  settingError: null,
  themeColorError: null,
  snoozeTarget: null,
  snoozeError: null,
  cacheAction: null,
  openError: null,
  successNotice: null,
};

export type UiAction =
  | { type: 'noticesDismissed' }
  | { type: 'openErrorReported'; message: string }
  | { type: 'successReported'; message: string }
  | { type: 'successNoticeExpired' }
  | { type: 'modalOpened'; modal: 'options' | 'settings' | 'theme' }
  | { type: 'optionsModalClosed' }
  | { type: 'settingsModalEscaped' }
  | { type: 'themeModalClosed' }
  | { type: 'snoozeModalOpened'; target: SnoozeTarget }
  | { type: 'snoozeCommitted'; message: string; saved: boolean }
  | { type: 'snoozeErrorReported'; message: string }
  | { type: 'fieldSelectionMoved'; delta: 1 | -1 }
  | { type: 'settingSelectionMoved'; delta: 1 | -1 }
  | { type: 'themeColorSelectionMoved'; delta: 1 | -1 }
  | { type: 'editStarted' }
  | { type: 'editCancelled' }
  | { type: 'fieldCommitted' }
  | { type: 'fieldErrorReported'; message: string }
  | { type: 'optionsSaveReported'; saved: boolean }
  | { type: 'settingCommitted'; action: CacheAction }
  | { type: 'settingErrorReported'; message: string }
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
    case 'noticesDismissed': {
      // returning the same state skips the re-render, and every keypress dispatches this
      if (state.openError === null && state.successNotice === null) {
        return state;
      }

      return { ...state, openError: null, successNotice: null };
    }
    case 'openErrorReported': {
      return { ...state, openError: action.message };
    }
    case 'successReported': {
      return { ...state, openError: null, successNotice: { text: action.message } };
    }
    case 'successNoticeExpired': {
      return { ...state, successNotice: null };
    }
    case 'modalOpened': {
      return {
        ...state,
        modal: action.modal,
        fieldError: null,
        settingError: null,
        themeColorError: null,
        cacheAction: null,
      };
    }
    case 'optionsModalClosed': {
      return { ...state, modal: null, fieldError: null };
    }
    case 'settingsModalEscaped': {
      // the first escape only backs out of a pending confirmation
      if (state.cacheAction === 'confirm' || state.cacheAction === 'resetConfirm') {
        return { ...state, cacheAction: null };
      }

      return { ...state, modal: null, settingError: null, cacheAction: null };
    }
    case 'themeModalClosed': {
      return { ...state, modal: 'settings', themeColorError: null, cacheAction: null };
    }
    case 'snoozeModalOpened': {
      /**
       * The dialog opens straight into the duration edit, because the
       * duration is all it asks for. The App seeds the draft with the
       * default duration alongside this dispatch.
       */
      return { ...state, modal: 'snooze', editing: true, snoozeTarget: action.target, snoozeError: null };
    }
    case 'snoozeCommitted': {
      /**
       * A committed snooze closes the dialog and confirms in the footer.
       * Debug runs keep the cache disabled, in which case the snooze only
       * lasts the session and the error slot says so instead.
       */
      const closed = { ...state, modal: null, editing: false, snoozeTarget: null, snoozeError: null };

      if (action.saved) {
        return { ...closed, openError: null, successNotice: { text: action.message } };
      }

      return {
        ...closed,
        openError: `${action.message} · the cache is disabled for this session, so the snooze is not saved`,
        successNotice: null,
      };
    }
    case 'snoozeErrorReported': {
      return { ...state, snoozeError: action.message };
    }
    case 'fieldSelectionMoved': {
      return { ...state, selectedField: cycled(state.selectedField, action.delta, FIELDS.length), fieldError: null };
    }
    case 'settingSelectionMoved': {
      return {
        ...state,
        selectedSetting: cycled(state.selectedSetting, action.delta, SETTINGS.length),
        settingError: null,
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
      return { ...state, editing: true, fieldError: null, settingError: null, themeColorError: null };
    }
    case 'editCancelled': {
      // the snooze dialog is nothing but its edit, so cancelling the edit closes it
      if (state.modal === 'snooze') {
        return { ...state, modal: null, editing: false, snoozeTarget: null, snoozeError: null };
      }

      return { ...state, editing: false, fieldError: null, settingError: null, themeColorError: null };
    }
    case 'fieldCommitted': {
      return { ...state, editing: false, fieldError: null };
    }
    case 'fieldErrorReported': {
      return { ...state, fieldError: action.message };
    }
    case 'optionsSaveReported': {
      // a landed save confirms in the footer notice, a failed one in the modal's error slot
      if (action.saved) {
        return { ...state, fieldError: null, successNotice: { text: 'options saved' } };
      }

      return { ...state, fieldError: 'the cache is disabled for this session · options not saved' };
    }
    case 'settingCommitted': {
      return { ...state, editing: false, settingError: null, cacheAction: action.action };
    }
    case 'settingErrorReported': {
      return { ...state, settingError: action.message };
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
