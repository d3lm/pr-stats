import type { OptionsState } from '../state/options';
import type { UiState } from '../state/ui';
import type { ThemeState } from '../theme';
import { OptionsModal } from './OptionsModal';
import { SettingsModal } from './SettingsModal';
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
  copyLinks,
  themeState,
  onDraft,
  onSubmitField,
  onSubmitThemeColor,
}: {
  ui: UiState;
  options: OptionsState;
  saved: OptionsState | null;
  noCache: boolean;
  copyLinks: boolean;
  themeState: ThemeState;
  onDraft: (value: string) => void;
  onSubmitField: () => void;
  onSubmitThemeColor: () => void;
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
      />
    );
  }

  if (ui.modal === 'settings') {
    return (
      <SettingsModal
        selected={ui.selectedSetting}
        cacheAction={ui.cacheAction}
        noCache={noCache}
        copyLinks={copyLinks}
        preset={themeState.preset}
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
