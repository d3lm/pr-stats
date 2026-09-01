import { homedir } from 'node:os';
import { cacheDir } from '../../cache';
import { settingsFile } from '../../settings';
import { exportFile } from '../data/export';
import { CACHE_MESSAGES, SETTINGS, type CacheAction, type SettingSpec } from '../state/settings';
import { theme, type ThemeName } from '../theme';
import { ModalFrame, ModalInput, ModalRow } from './ModalFrame';

/**
 * Groups consecutive settings that share a section under one heading,
 * preserving the order of SETTINGS.
 */
const SECTIONS: { title: string; settings: SettingSpec[] }[] = [];

for (const setting of SETTINGS) {
  const last = SECTIONS.at(-1);

  if (last?.title === setting.section) {
    last.settings.push(setting);
  } else {
    SECTIONS.push({ title: setting.section, settings: [setting] });
  }
}

/**
 * Centered modal with the app-level settings, separate from the data and
 * analysis options. The settings are grouped into sections, and the bottom
 * line describes the selected row, shows the validation error of a
 * rejected interval edit, or reports a pending or finished action.
 */
export function SettingsModal({
  selected,
  editing,
  error,
  cacheAction,
  noCache,
  autoReload,
  reloadInterval,
  copyLinks,
  preset,
  onDraft,
  onSubmit,
}: {
  selected: number;
  editing: boolean;
  error: string | null;
  cacheAction: CacheAction | null;
  noCache: boolean;
  autoReload: boolean;
  reloadInterval: string;
  copyLinks: boolean;
  preset: ThemeName;
  onDraft: (value: string) => void;
  onSubmit: () => void;
}) {
  const message = cacheAction === null ? null : CACHE_MESSAGES[cacheAction];

  return (
    <ModalFrame title="Settings">
      {SECTIONS.map((section) => (
        <box key={section.title} flexDirection="column" marginBottom={1}>
          <text wrapMode="none" fg={theme.accent} marginLeft={2}>
            {section.title}
          </text>
          {section.settings.map((setting) => {
            const isSelected = SETTINGS.indexOf(setting) === selected;

            return (
              <ModalRow key={setting.key} label={setting.label} isSelected={isSelected}>
                <SettingValue
                  setting={setting}
                  isSelected={isSelected}
                  isEditing={isSelected && editing}
                  cacheAction={cacheAction}
                  noCache={noCache}
                  autoReload={autoReload}
                  reloadInterval={reloadInterval}
                  copyLinks={copyLinks}
                  preset={preset}
                  onDraft={onDraft}
                  onSubmit={onSubmit}
                />
              </ModalRow>
            );
          })}
        </box>
      ))}
      <text
        wrapMode="word"
        height={2}
        fg={error !== null ? theme.error : message?.warn ? theme.warn : theme.muted}
        marginLeft={2}
        marginRight={2}
      >
        {error ?? message?.text ?? SETTINGS[selected].hint}
      </text>
    </ModalFrame>
  );
}

/**
 * Renders the value slot of one setting row. The disable-cache, auto-reload,
 * copy-links, and theme rows show a toggle value with arrows on the selected
 * row, like the toggles in the options modal. The reload-interval row shows
 * the interval, dimmed while auto reload is off, and turns into an input
 * while editing. The edit-colors row previews the current accent family as
 * a swatch strip. The clear-cache and reset-settings rows show the path they
 * delete with the home directory abbreviated, and flip to a confirm prompt
 * after the first enter. The export row shows the path it writes the same
 * way, without a confirm because an export only overwrites its own file.
 */
function SettingValue({
  setting,
  isSelected,
  isEditing,
  cacheAction,
  noCache,
  autoReload,
  reloadInterval,
  copyLinks,
  preset,
  onDraft,
  onSubmit,
}: {
  setting: SettingSpec;
  isSelected: boolean;
  isEditing: boolean;
  cacheAction: CacheAction | null;
  noCache: boolean;
  autoReload: boolean;
  reloadInterval: string;
  copyLinks: boolean;
  preset: ThemeName;
  onDraft: (value: string) => void;
  onSubmit: () => void;
}) {
  switch (setting.key) {
    case 'noCache': {
      return <ToggleValue value={noCache ? 'yes' : 'no'} isSelected={isSelected} />;
    }
    case 'clearCache': {
      return <PathValue path={cacheDir()} confirming={cacheAction === 'confirm'} isSelected={isSelected} />;
    }
    case 'autoReload': {
      return <ToggleValue value={autoReload ? 'yes' : 'no'} isSelected={isSelected} />;
    }
    case 'reloadInterval': {
      if (isEditing) {
        return <ModalInput width={16} value={reloadInterval} onDraft={onDraft} onSubmit={onSubmit} />;
      }

      return <IntervalValue value={reloadInterval} active={autoReload} isSelected={isSelected} />;
    }
    case 'copyLinks': {
      return <ToggleValue value={copyLinks ? 'yes' : 'no'} isSelected={isSelected} />;
    }
    case 'themePreset': {
      return <ToggleValue value={preset} isSelected={isSelected} />;
    }
    case 'themeColors': {
      return (
        <text wrapMode="none">
          {(['chartDim', 'chartBar', 'chartLine', 'accent'] as const).map((key) => (
            <span key={key} fg={theme[key]}>
              ██
            </span>
          ))}
        </text>
      );
    }
    case 'resetSettings': {
      return <PathValue path={settingsFile()} confirming={cacheAction === 'resetConfirm'} isSelected={isSelected} />;
    }
    case 'exportJson': {
      return <PathValue path={exportFile()} confirming={false} isSelected={isSelected} />;
    }
    default: {
      return null;
    }
  }
}

/**
 * Value slot of a row that left and right cycle through. The selected
 * row gets arrows around the value to show that.
 */
function ToggleValue({ value, isSelected }: { value: string; isSelected: boolean }) {
  if (isSelected) {
    return (
      <text wrapMode="none">
        <span fg={theme.muted}>‹ </span>
        <b fg={theme.text}>{value}</b>
        <span fg={theme.muted}> ›</span>
      </text>
    );
  }

  return (
    <text wrapMode="none" fg={theme.muted}>
      {value}
    </text>
  );
}

/**
 * Value slot of the reload-interval row. The interval only drives a timer
 * while auto reload is on, so it dims to the placeholder colors while the
 * toggle above it is off, and shows like an editable value otherwise.
 */
function IntervalValue({ value, active, isSelected }: { value: string; active: boolean; isSelected: boolean }) {
  if (!active) {
    return (
      <text wrapMode="none" fg={isSelected ? theme.muted : theme.dim}>
        {value}
      </text>
    );
  }

  if (isSelected) {
    return (
      <text wrapMode="none">
        <b fg={theme.text}>{value}</b>
      </text>
    );
  }

  return (
    <text wrapMode="none" fg={theme.muted}>
      {value}
    </text>
  );
}

/**
 * Value slot of an action row that targets a file. It shows the path with
 * the home directory abbreviated, and the destructive rows flip it to a
 * confirm prompt after the first enter.
 */
function PathValue({ path, confirming, isSelected }: { path: string; confirming: boolean; isSelected: boolean }) {
  if (confirming) {
    return (
      <text wrapMode="none">
        <b fg={theme.warn}>enter to confirm</b>
      </text>
    );
  }

  return (
    <text wrapMode="none" fg={isSelected ? theme.text : theme.muted}>
      {path.replace(homedir(), '~')}
    </text>
  );
}
