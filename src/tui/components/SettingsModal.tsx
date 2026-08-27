import { homedir } from 'node:os';
import { cacheDir } from '../../cache';
import { settingsFile } from '../../settings';
import { CACHE_MESSAGES, SETTINGS, type CacheAction, type SettingSpec } from '../state/settings';
import { theme, type ThemeName } from '../theme';
import { ModalFrame, ModalRow } from './ModalFrame';

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
 * line describes the selected row or reports a pending or finished action.
 */
export function SettingsModal({
  selected,
  cacheAction,
  noCache,
  copyLinks,
  preset,
}: {
  selected: number;
  cacheAction: CacheAction | null;
  noCache: boolean;
  copyLinks: boolean;
  preset: ThemeName;
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
                  cacheAction={cacheAction}
                  noCache={noCache}
                  copyLinks={copyLinks}
                  preset={preset}
                />
              </ModalRow>
            );
          })}
        </box>
      ))}
      <text wrapMode="word" height={2} fg={message?.warn ? theme.warn : theme.muted} marginLeft={2} marginRight={2}>
        {message?.text ?? SETTINGS[selected].hint}
      </text>
    </ModalFrame>
  );
}

/**
 * Renders the value slot of one setting row. The disable-cache,
 * copy-links, and theme rows show a toggle value with arrows on the
 * selected row, like the toggles in the options modal. The edit-colors
 * row previews the current accent family as a swatch strip. The
 * clear-cache and reset-settings rows show the path they delete with the
 * home directory abbreviated, and flip to a confirm prompt after the
 * first enter.
 */
function SettingValue({
  setting,
  isSelected,
  cacheAction,
  noCache,
  copyLinks,
  preset,
}: {
  setting: SettingSpec;
  isSelected: boolean;
  cacheAction: CacheAction | null;
  noCache: boolean;
  copyLinks: boolean;
  preset: ThemeName;
}) {
  switch (setting.key) {
    case 'noCache': {
      return <ToggleValue value={noCache ? 'yes' : 'no'} isSelected={isSelected} />;
    }
    case 'clearCache': {
      return <PathValue path={cacheDir()} confirming={cacheAction === 'confirm'} isSelected={isSelected} />;
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
 * Value slot of a destructive action row. It shows the path the action
 * deletes with the home directory abbreviated, and flips to a confirm
 * prompt after the first enter.
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
