import type { NotifyChannel } from '../../settings';
import type { OptionsState } from '../state/options';
import type { UiState } from '../state/ui';
import type { ThemeState } from '../theme';
import { OptionsModal } from './OptionsModal';
import { SettingsModal } from './SettingsModal';
import { SnoozeModal } from './SnoozeModal';
import { ThemeModal } from './ThemeModal';

/**
 * Renders whichever dialog the ui state names as open, or nothing while
 * none is. The selection, edit, and feedback slots each dialog needs come
 * from the ui state, and the draft and submit callbacks wire the editable
 * dialogs back to the App's commit handlers.
 */
export function Modals({
  ui,
  options,
  saved,
  noCache,
  autoReload,
  reloadInterval,
  notifications,
  notifyChannel,
  copyLinks,
  snoozeDuration,
  themeState,
  onDraft,
  onSubmitField,
  onSubmitSetting,
  onSubmitThemeColor,
  onSubmitSnooze,
  onToggleReviewType,
  onToggleWorkDay,
}: {
  ui: UiState;
  options: OptionsState;
  saved: OptionsState | null;
  noCache: boolean;
  autoReload: boolean;
  reloadInterval: string;
  notifications: boolean;
  notifyChannel: NotifyChannel;
  copyLinks: boolean;
  snoozeDuration: string;
  themeState: ThemeState;
  onDraft: (value: string) => void;
  onSubmitField: () => void;
  /**
   * Commits the edit of the selected settings row, which the App routes
   * to the row's own validation and save.
   */
  onSubmitSetting: () => void;
  onSubmitThemeColor: () => void;
  onSubmitSnooze: () => void;
  onToggleReviewType: (type: string) => void;
  onToggleWorkDay: (day: string) => void;
}) {
  if (ui.modal === 'options') {
    return (
      <OptionsModal
        options={options}
        saved={saved}
        selected={ui.selectedField}
        editing={ui.editing}
        fieldError={ui.fieldError}
        onDraft={onDraft}
        onSubmit={onSubmitField}
        onToggleReviewType={onToggleReviewType}
        onToggleWorkDay={onToggleWorkDay}
      />
    );
  }

  if (ui.modal === 'settings') {
    return (
      <SettingsModal
        selected={ui.selectedSetting}
        editing={ui.editing}
        error={ui.settingError}
        cacheAction={ui.cacheAction}
        noCache={noCache}
        autoReload={autoReload}
        reloadInterval={reloadInterval}
        notifications={notifications}
        notifyChannel={notifyChannel}
        copyLinks={copyLinks}
        snoozeDuration={snoozeDuration}
        preset={themeState.preset}
        onDraft={onDraft}
        onSubmit={onSubmitSetting}
      />
    );
  }

  if (ui.modal === 'snooze' && ui.snoozeTarget !== null) {
    return (
      <SnoozeModal
        target={ui.snoozeTarget}
        snoozeDuration={snoozeDuration}
        error={ui.snoozeError}
        onDraft={onDraft}
        onSubmit={onSubmitSnooze}
      />
    );
  }

  if (ui.modal === 'theme') {
    return (
      <ThemeModal
        selected={ui.selectedThemeColor}
        editing={ui.editing}
        error={ui.themeColorError}
        cacheAction={ui.cacheAction}
        overrides={themeState.preset === 'custom' ? themeState.overrides : {}}
        onDraft={onDraft}
        onSubmit={onSubmitThemeColor}
      />
    );
  }

  return null;
}
