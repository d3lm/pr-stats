import type { ScrollUnit } from '@opentui/core';
import type { Dispatch, SetStateAction } from 'react';
import type { LinkTarget, NotifyChannel } from '../../settings';
import type { SnoozeTargetKey } from '../../snooze';
import type { RawData } from '../data/load';
import type { AppViews } from '../hooks/useViewModel';
import type { BrowseAction, BrowseState, StatsTabKey } from '../state/browse';
import type { OptionsState } from '../state/options';
import type { UiAction, UiState } from '../state/ui';
import type { ThemeState } from '../theme';
import type { Notifier } from '../utils/notify';
import type { PrRow } from '../views/rows';

/**
 * Everything the key handlers read and drive. The committed state comes
 * straight from the App component's hooks, which useKeyboard keeps current
 * through useEffectEvent. The handlers translate keys into dispatched actions
 * on the ui and browse reducers, plus the few setters and side-effect actions
 * that live outside them.
 */
export interface KeymapContext {
  ui: UiState;
  browse: BrowseState;
  noCache: boolean;
  autoReload: boolean;
  /**
   * Holds the reload interval the timer runs on while auto reload is on.
   * Enter on its row seeds the edit with it, and the App's commit handler
   * validates and stores the edited value.
   */
  reloadInterval: string;
  notifications: boolean;
  trackMentions: boolean;
  notifyMentions: boolean;
  teamReviews: boolean;
  notifyTeamReviews: boolean;
  /**
   * Holds the team review stats toggle. The JSON export in the settings
   * dialog passes it to the report builder, so the export counts the
   * team cycles the way the review tab does.
   */
  teamReviewStats: boolean;
  notifyChannel: NotifyChannel;
  /**
   * Holds the site a PR opens on. Enter on a queue row passes the row's
   * link through linkUrl with it before the open.
   */
  openIn: LinkTarget;
  copyLinks: boolean;
  /**
   * Holds the default snooze duration. Enter on its settings row seeds
   * the edit with it, and the snooze dialog opens with it as the draft.
   */
  snoozeDuration: string;
  themeState: ThemeState;
  options: OptionsState;
  views: AppViews | null;

  /**
   * Holds the loaded data, or null before the first load finishes. The
   * JSON export in the settings dialog reads it, so the export matches
   * what the tabs currently show.
   */
  raw: RawData | null;

  dispatchUi: Dispatch<UiAction>;
  dispatchBrowse: Dispatch<BrowseAction>;
  setOptions: Dispatch<SetStateAction<OptionsState>>;
  setSaved: Dispatch<SetStateAction<OptionsState | null>>;
  setNoCache: Dispatch<SetStateAction<boolean>>;
  setAutoReload: Dispatch<SetStateAction<boolean>>;
  setNotifications: Dispatch<SetStateAction<boolean>>;
  setTrackMentions: Dispatch<SetStateAction<boolean>>;
  setNotifyMentions: Dispatch<SetStateAction<boolean>>;
  setTeamReviews: Dispatch<SetStateAction<boolean>>;
  setNotifyTeamReviews: Dispatch<SetStateAction<boolean>>;
  setTeamReviewStats: Dispatch<SetStateAction<boolean>>;
  setNotifyChannel: Dispatch<SetStateAction<NotifyChannel>>;
  setOpenIn: Dispatch<SetStateAction<LinkTarget>>;
  setCopyLinks: Dispatch<SetStateAction<boolean>>;
  setThemeState: Dispatch<SetStateAction<ThemeState>>;
  quit: () => void;
  reload: (bypassCache: boolean) => void;
  openUrl: (url: string, onError: (message: string) => void) => void;

  /**
   * Sends a desktop notification, which the test row in the settings
   * dialog uses to let the user check that notifications show up.
   */
  notify: Notifier;

  /**
   * Copies the PR's link to the clipboard and reports the copy in the
   * footer, used in place of openUrl while the copy-links setting is on.
   */
  copyRow: (row: { ref: string; url: string }) => void;

  /**
   * Ends the snooze of the given kind on the given PR, which puts the
   * request back on the awaiting list or the mention back in the inbox,
   * and reports the change in the footer.
   */
  unsnooze: (target: SnoozeTargetKey) => void;

  /**
   * Marks the mention behind the given inbox row read, ending its snooze
   * when it had one, and reports the change in the footer.
   */
  markRead: (row: PrRow) => void;

  /**
   * Marks the mentions behind the given inbox rows read in one go and
   * reports the change in the footer.
   */
  markAllRead: (rows: readonly PrRow[]) => void;

  /**
   * Marks the mention behind the given inbox row unread again and
   * reports the change in the footer.
   */
  markUnread: (row: PrRow) => void;

  /**
   * Seeds the edit draft with the given value and switches the open
   * modal into editing mode.
   */
  beginEdit: (value: string) => void;

  /**
   * Scrolls the charts pane of the given stats tab by the given number
   * of rows, or by that share of the viewport or the content when the
   * unit says so.
   */
  scrollBy: (tab: StatsTabKey, delta: number, unit?: ScrollUnit) => void;
}
