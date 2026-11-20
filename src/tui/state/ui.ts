import type { SnoozeKind } from '../../snooze';
import { FIELDS } from './options';
import { firstSettingOn, SETTING_PAGES, settingPageOf, SETTINGS, THEME_COLORS, type CacheAction } from './settings';

export type Modal = 'options' | 'settings' | 'theme' | 'snooze' | null;

/**
 * Holds the time of the ask in at, so a later re-request or newer mention voids the snooze.
 */
export interface SnoozeTarget {
  kind: SnoozeKind;
  ref: string;
  title: string;
  at: number;
  ids?: readonly string[];
}

export interface UiState {
  modal: Modal;
  editing: boolean;
  selectedField: number;
  selectedSetting: number;
  selectedThemeColor: number;
  fieldError: string | null;
  settingError: string | null;
  themeColorError: string | null;
  snoozeTarget: SnoozeTarget | null;
  snoozeError: string | null;
  cacheAction: CacheAction | null;
  openError: string | null;
  /**
   * A fresh object per report restarts the expiry timer even when the text repeats.
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
  | { type: 'settingPageCycled'; delta: 1 | -1 }
  | { type: 'settingPageSelected'; page: number }
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

function cycled(previous: number, delta: 1 | -1, count: number): number {
  return (previous + count + delta) % count;
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'noticesDismissed': {
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
      if (state.cacheAction === 'confirm' || state.cacheAction === 'resetConfirm') {
        return { ...state, cacheAction: null };
      }

      return { ...state, modal: null, settingError: null, cacheAction: null };
    }
    case 'themeModalClosed': {
      return { ...state, modal: 'settings', themeColorError: null, cacheAction: null };
    }
    case 'snoozeModalOpened': {
      return { ...state, modal: 'snooze', editing: true, snoozeTarget: action.target, snoozeError: null };
    }
    case 'snoozeCommitted': {
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
    case 'settingPageCycled': {
      const page = cycled(settingPageOf(state.selectedSetting), action.delta, SETTING_PAGES.length);

      return { ...state, selectedSetting: firstSettingOn(page), settingError: null, cacheAction: null };
    }
    case 'settingPageSelected': {
      if (action.page === settingPageOf(state.selectedSetting)) {
        return state;
      }

      return { ...state, selectedSetting: firstSettingOn(action.page), settingError: null, cacheAction: null };
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
    default: {
      return state;
    }
  }
}
