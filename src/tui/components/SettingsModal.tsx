import { useRenderer } from '@opentui/react';
import { homedir } from 'node:os';
import { cacheDir, cacheSize } from '../../cache';
import { settingsFile, type LinkTarget, type NotifyChannel } from '../../settings';
import { formatBytes } from '../../utils';
import { exportFile } from '../data/export';
import {
  CACHE_MESSAGES,
  SETTING_PAGES,
  settingPageOf,
  SETTINGS,
  type CacheAction,
  type SettingSpec,
} from '../state/settings';
import { theme, type ThemeName } from '../theme';
import { notificationBoundary, notificationCaveat, notificationChannel, notificationTool } from '../utils/notify';
import { ModalFrame, ModalInput, ModalRow } from './ModalFrame';
import { SubTabBar } from './TabBar';

/**
 * Holds the settings of each page, in the order of SETTING_PAGES.
 */
const PAGE_SETTINGS: SettingSpec[][] = SETTING_PAGES.map((page) =>
  SETTINGS.filter((setting) => setting.page === page.key),
);

/**
 * Sizes the row area to the longest page, so the dialog keeps one height
 * while the pages switch instead of growing and shrinking under the
 * cursor.
 */
const ROW_AREA_HEIGHT = Math.max(...PAGE_SETTINGS.map((settings) => settings.length));

/**
 * Centered modal with the app-level settings, separate from the data and
 * analysis options. The settings spread over the pages of a tab strip,
 * of which the dialog shows the one holding the selected row, so the
 * dialog stays a dozen rows tall however many settings there are. The
 * bottom line describes the selected row, shows the validation error of
 * a rejected interval edit or the failure of a notification sent while
 * the dialog is open, or reports a pending or finished action.
 */
export function SettingsModal({
  selected,
  editing,
  error,
  cacheAction,
  noCache,
  autoReload,
  reloadInterval,
  notifications,
  trackMentions,
  notifyMentions,
  teamReviews,
  notifyTeamReviews,
  teamReviewStats,
  notifyChannel,
  openIn,
  copyLinks,
  snoozeDuration,
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
  notifications: boolean;
  trackMentions: boolean;
  notifyMentions: boolean;
  teamReviews: boolean;
  notifyTeamReviews: boolean;
  teamReviewStats: boolean;
  notifyChannel: NotifyChannel;
  openIn: LinkTarget;
  copyLinks: boolean;
  snoozeDuration: string;
  preset: ThemeName;
  onDraft: (value: string) => void;
  onSubmit: () => void;
}) {
  const message = cacheAction === null ? null : CACHE_MESSAGES[cacheAction];

  /**
   * Resolves the display values of the notification rows. The channel
   * row shows the setting, with the command value named by its platform
   * command, and the test row names the channel a send would take right
   * now. The dialog re-renders on every keypress, so the auto value
   * catches up once the terminal detection finishes after startup. On a
   * terminal known to swallow the notification sequence, the test row
   * trades its hint for the caveat naming what the terminal needs,
   * because the send itself reports no failure there.
   */
  const renderer = notificationBoundary(useRenderer());
  const channelValue = notifyChannel === 'command' ? (notificationTool() ?? 'unsupported') : notifyChannel;
  const deliveryValue = notificationChannel(renderer, notifyChannel) ?? 'unsupported';
  const caveat = SETTINGS[selected].key === 'testNotification' ? notificationCaveat(renderer, notifyChannel) : null;

  /**
   * Picks the bottom line, where an error beats a pending or finished
   * action, which beats the caveat, which beats the plain hint.
   */
  const bottomLine =
    error !== null
      ? { text: error, fg: theme.error }
      : message !== null
        ? { text: message.text, fg: message.warn ? theme.warn : theme.muted }
        : caveat !== null
          ? { text: caveat, fg: theme.warn }
          : { text: SETTINGS[selected].hint, fg: theme.muted };

  const page = settingPageOf(selected);

  return (
    <ModalFrame title="Settings">
      <SubTabBar tabs={SETTING_PAGES} active={SETTING_PAGES[page].key} hint={null} />
      <box flexDirection="column" height={ROW_AREA_HEIGHT} marginBottom={1}>
        {PAGE_SETTINGS[page].map((setting) => {
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
                notifications={notifications}
                trackMentions={trackMentions}
                notifyMentions={notifyMentions}
                teamReviews={teamReviews}
                notifyTeamReviews={notifyTeamReviews}
                teamReviewStats={teamReviewStats}
                channelValue={channelValue}
                deliveryValue={deliveryValue}
                openIn={openIn}
                copyLinks={copyLinks}
                snoozeDuration={snoozeDuration}
                preset={preset}
                onDraft={onDraft}
                onSubmit={onSubmit}
              />
            </ModalRow>
          );
        })}
      </box>
      <text wrapMode="word" height={3} fg={bottomLine.fg} marginLeft={2} marginRight={2}>
        {bottomLine.text}
      </text>
    </ModalFrame>
  );
}

/**
 * Renders the value slot of one setting row. The disable-cache, auto-reload,
 * notifications, copy-links, and theme rows show a toggle value with arrows
 * on the selected row, like the toggles in the options modal. The open-in
 * row cycles github and linear the same way. The mention-
 * notifications row is such a toggle too, dimmed while the notifications
 * above it or the mention tracking on the Awaiting you page are off,
 * because it only applies with both, and the team-request-notifications row dims the same way
 * while the notifications or the team requests are off. The
 * track-mentions, team-requests, and count-team-reviews rows are plain
 * toggles. The reload-interval
 * row shows the interval, dimmed while auto reload is off, and turns into
 * an input while editing. The notification-channel row cycles auto, terminal,
 * the platform command, and bell, and the test-notification row names the
 * channel the next send takes, or unsupported where none exists.
 * The default-snooze row shows the duration and turns into an input while
 * editing, like the interval. The edit-colors row previews the current accent
 * family as a swatch strip. The clear-cache and reset-settings rows show
 * the path they delete with the home directory abbreviated, and flip to
 * a confirm prompt after the first enter. The clear-cache row also shows
 * the size of the cache directory after the path, sized on every render
 * so a clear or a background reload shows up right away. The directory
 * holds a handful of files, so the listing costs nothing noticeable. The
 * export row shows the path it writes the same way, without a confirm
 * because an export only overwrites its own file.
 */
function SettingValue({
  setting,
  isSelected,
  isEditing,
  cacheAction,
  noCache,
  autoReload,
  reloadInterval,
  notifications,
  trackMentions,
  notifyMentions,
  teamReviews,
  notifyTeamReviews,
  teamReviewStats,
  channelValue,
  deliveryValue,
  openIn,
  copyLinks,
  snoozeDuration,
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
  notifications: boolean;
  trackMentions: boolean;
  notifyMentions: boolean;
  teamReviews: boolean;
  notifyTeamReviews: boolean;
  teamReviewStats: boolean;
  channelValue: string;
  deliveryValue: string;
  openIn: LinkTarget;
  copyLinks: boolean;
  snoozeDuration: string;
  preset: ThemeName;
  onDraft: (value: string) => void;
  onSubmit: () => void;
}) {
  switch (setting.key) {
    case 'noCache': {
      return <ToggleValue value={noCache ? 'yes' : 'no'} isSelected={isSelected} />;
    }
    case 'clearCache': {
      return (
        <PathValue
          path={cacheDir()}
          detail={formatBytes(cacheSize())}
          confirming={cacheAction === 'confirm'}
          isSelected={isSelected}
        />
      );
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
    case 'notifications': {
      return <ToggleValue value={notifications ? 'yes' : 'no'} isSelected={isSelected} />;
    }
    case 'notifyMentions': {
      return (
        <ToggleValue
          value={notifyMentions ? 'yes' : 'no'}
          isSelected={isSelected}
          active={notifications && trackMentions}
        />
      );
    }
    case 'notifyTeamReviews': {
      return (
        <ToggleValue
          value={notifyTeamReviews ? 'yes' : 'no'}
          isSelected={isSelected}
          active={notifications && teamReviews}
        />
      );
    }
    case 'notifyChannel': {
      return <ToggleValue value={channelValue} isSelected={isSelected} />;
    }
    case 'testNotification': {
      return (
        <text wrapMode="none" fg={isSelected ? theme.text : theme.muted}>
          {deliveryValue}
        </text>
      );
    }
    case 'openIn': {
      return <ToggleValue value={openIn} isSelected={isSelected} />;
    }
    case 'copyLinks': {
      return <ToggleValue value={copyLinks ? 'yes' : 'no'} isSelected={isSelected} />;
    }
    case 'trackMentions': {
      return <ToggleValue value={trackMentions ? 'yes' : 'no'} isSelected={isSelected} />;
    }
    case 'teamReviews': {
      return <ToggleValue value={teamReviews ? 'yes' : 'no'} isSelected={isSelected} />;
    }
    case 'teamReviewStats': {
      return <ToggleValue value={teamReviewStats ? 'yes' : 'no'} isSelected={isSelected} />;
    }
    case 'snoozeDuration': {
      if (isEditing) {
        return <ModalInput width={16} value={snoozeDuration} onDraft={onDraft} onSubmit={onSubmit} />;
      }

      return <IntervalValue value={snoozeDuration} active isSelected={isSelected} />;
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
 * row gets arrows around the value to show that. A row whose setting
 * only applies while another one is on passes active false while that
 * one is off, which dims the value to the placeholder colors the way
 * the reload interval dims without auto reload.
 */
function ToggleValue({ value, isSelected, active = true }: { value: string; isSelected: boolean; active?: boolean }) {
  if (isSelected) {
    return (
      <text wrapMode="none">
        <span fg={theme.muted}>‹ </span>
        <b fg={active ? theme.text : theme.muted}>{value}</b>
        <span fg={theme.muted}> ›</span>
      </text>
    );
  }

  return (
    <text wrapMode="none" fg={active ? theme.muted : theme.dim}>
      {value}
    </text>
  );
}

/**
 * Value slot of an editable duration row, the reload interval and the
 * default snooze. The interval only drives a timer while auto reload is
 * on, so it dims to the placeholder colors while the toggle above it is
 * off, and shows like an editable value otherwise. The default snooze
 * always applies, so it always shows the active way.
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
 * the home directory abbreviated, followed by a dimmed detail like the
 * size of the target when the row passes one, and the destructive rows
 * flip it to a confirm prompt after the first enter.
 */
function PathValue({
  path,
  detail,
  confirming,
  isSelected,
}: {
  path: string;
  detail?: string;
  confirming: boolean;
  isSelected: boolean;
}) {
  if (confirming) {
    return (
      <text wrapMode="none">
        <b fg={theme.warn}>enter to confirm</b>
      </text>
    );
  }

  return (
    <text wrapMode="none">
      <span fg={isSelected ? theme.text : theme.muted}>{path.replace(homedir(), '~')}</span>
      {detail === undefined ? null : <span fg={isSelected ? theme.muted : theme.dim}> · {detail}</span>}
    </text>
  );
}
