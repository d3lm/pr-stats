import type { ColorKey } from '../theme';

/**
 * Describes one row of the settings dialog. New settings get an entry in
 * SETTINGS, a value renderer in the SettingsModal, and their activation
 * behavior in the App keyboard handler, all dispatching on the key.
 */
export interface SettingSpec {
  key: string;
  /**
   * Names the section heading the setting renders under. Consecutive
   * settings with the same section share one heading.
   */
  section: string;
  label: string;
  hint: string;
}

export const SETTINGS: SettingSpec[] = [
  {
    key: 'noCache',
    section: 'Cache',
    label: 'Disable cache',
    hint: 'refetch everything on every load instead of reading cached PRs · fresh results still update the cache',
  },
  {
    key: 'clearCache',
    section: 'Cache',
    label: 'Clear cache',
    hint: 'deletes the cached PR data at this path, so the next reload refetches everything',
  },
  {
    key: 'copyLinks',
    section: 'Links',
    label: 'Copy instead of open',
    hint: 'enter and a click on a PR reference copy its link to the clipboard instead of opening the browser',
  },
  {
    key: 'themePreset',
    section: 'Theme',
    label: 'Theme',
    hint: 'built-in color theme · editing colors adds a custom theme to the cycle',
  },
  {
    key: 'themeColors',
    section: 'Theme',
    label: 'Edit colors',
    hint: 'opens the color list, where every theme color takes a hex value · edits become the custom theme',
  },
  {
    key: 'resetSettings',
    section: 'Settings',
    label: 'Reset settings',
    hint: 'deletes the settings file with the saved cache setting and theme, so future runs start from the defaults',
  },
];

/**
 * Describes one row of the theme colors dialog, in the order the dialog
 * lists them. The hint names where the color shows up in the UI.
 */
export interface ThemeColorSpec {
  key: ColorKey;
  hint: string;
}

export const THEME_COLORS: ThemeColorSpec[] = [
  { key: 'bg', hint: 'background of the screen and the dialogs' },
  { key: 'border', hint: 'borders, rules, and the dialog frames' },
  { key: 'text', hint: 'primary text' },
  { key: 'muted', hint: 'secondary text like values and chart labels' },
  { key: 'dim', hint: 'faint text like axis scales and the footer hints' },
  { key: 'accent', hint: 'highlights like medians, headings, and the selection marker' },
  { key: 'selectedBg', hint: 'background of the selected row' },
  { key: 'inputBg', hint: 'background of text inputs' },
  { key: 'inputFocusedBg', hint: 'background of the focused text input' },
  { key: 'warn', hint: 'notices like the reload reminder and confirm prompts' },
  { key: 'error', hint: 'error messages and failed loads' },
  { key: 'success', hint: 'the checkmark on the copied-link notice' },
  { key: 'chartBar', hint: 'histogram and volume bars' },
  { key: 'chartLine', hint: 'trend lines and the scatter dots' },
  { key: 'chartDim', hint: 'de-emphasized chart parts like the over-target share' },
  { key: 'heat', hint: 'the four heatmap colors from cool to hot, separated by spaces' },
];

/**
 * Feedback state of the settings dialog actions. Confirm means the first
 * enter on clear cache landed and the next one clears, with cleared and
 * disabled reporting how the clear went. Saved and notSaved report
 * whether a toggled setting reached settings.json. The reset states
 * mirror the clear-cache flow for the reset-settings action.
 */
export type CacheAction =
  'confirm' | 'cleared' | 'disabled' | 'saved' | 'notSaved' | 'resetConfirm' | 'resetDone' | 'resetDisabled';

/**
 * Bottom-line message for each action state, shown in place of the
 * setting hint while the action is in flight or just finished. The
 * settings dialog and the theme dialog both render them.
 */
export const CACHE_MESSAGES: Record<CacheAction, { text: string; warn?: boolean }> = {
  confirm: { text: 'press enter again to clear the cache · esc cancels', warn: true },
  cleared: { text: 'cache cleared · the next reload refetches everything' },
  disabled: { text: 'the cache is disabled for this session · nothing to clear' },
  saved: { text: 'saved to settings.json · future runs start with this setting' },
  notSaved: { text: 'the cache is disabled for this session · setting not saved' },
  resetConfirm: { text: 'press enter again to delete settings.json · esc cancels', warn: true },
  resetDone: { text: 'settings.json deleted · future runs start from the defaults' },
  resetDisabled: { text: 'the cache is disabled for this session · nothing to reset' },
};
