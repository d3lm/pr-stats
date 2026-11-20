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

const PAGE_SETTINGS: SettingSpec[][] = SETTING_PAGES.map((page) =>
  SETTINGS.filter((setting) => setting.page === page.key),
);

const ROW_AREA_HEIGHT = Math.max(...PAGE_SETTINGS.map((settings) => settings.length));

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

  // terminal detection finishes asynchronously, and the per-keypress re-render picks up its result
  const renderer = notificationBoundary(useRenderer());
  const channelValue = notifyChannel === 'command' ? (notificationTool() ?? 'unsupported') : notifyChannel;
  const deliveryValue = notificationChannel(renderer, notifyChannel) ?? 'unsupported';
  const caveat = SETTINGS[selected].key === 'testNotification' ? notificationCaveat(renderer, notifyChannel) : null;

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
