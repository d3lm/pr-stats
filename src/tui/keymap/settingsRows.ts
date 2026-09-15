import type { KeyEvent } from '@opentui/core';
import type { Dispatch, SetStateAction } from 'react';
import {
  LINK_TARGETS,
  NOTIFY_CHANNELS,
  saveAutoReload,
  saveCopyLinks,
  saveNoCache,
  saveNotifications,
  saveNotifyChannel,
  saveNotifyMentions,
  saveNotifyTeamReviews,
  saveOpenIn,
  saveTeamReviews,
  saveTeamReviewStats,
  saveTrackMentions,
  type LinkTarget,
  type NotifyChannel,
} from '../../settings';
import type { KeymapContext } from './context';
import { cycled, stepOf } from './helpers';

/**
 * Reports in the dialog's message slot whether a changed setting landed
 * in the settings file. Debug runs keep the cache disabled, in which
 * case nothing gets stored and the slot says so.
 */
export function reportSaved(context: KeymapContext, saved: boolean): void {
  context.dispatchUi({ type: 'cacheActionReported', action: saved ? 'saved' : 'notSaved' });
}

/**
 * Describes a settings row that flips a boolean. The row flips the
 * session state and persists the value right away, and the part of the
 * App that reads the flag follows the state on its own, so none of the
 * toggles needs a reload.
 */
interface ToggleRow {
  read: (context: KeymapContext) => boolean;
  setter: (context: KeymapContext) => Dispatch<SetStateAction<boolean>>;
  save: (next: boolean) => boolean;
}

/**
 * The toggle rows by their setting key. The reload timer follows the
 * auto reload flag, the next fresh load reports its changes once
 * notifications are on, the next load starts or stops searching for
 * mentions, and the queue and the review stats read the team flags at
 * render time. The notification toggles only notify about what arrives
 * after the toggle, because the loads keep the baselines current while
 * a toggle is off.
 */
const TOGGLE_ROWS: Partial<Record<string, ToggleRow>> = {
  noCache: { read: (c) => c.noCache, setter: (c) => c.setNoCache, save: saveNoCache },
  autoReload: { read: (c) => c.autoReload, setter: (c) => c.setAutoReload, save: saveAutoReload },
  notifications: {
    read: (c) => c.notifications,
    setter: (c) => c.setNotifications,
    save: saveNotifications,
  },
  trackMentions: {
    read: (c) => c.trackMentions,
    setter: (c) => c.setTrackMentions,
    save: saveTrackMentions,
  },
  notifyMentions: {
    read: (c) => c.notifyMentions,
    setter: (c) => c.setNotifyMentions,
    save: saveNotifyMentions,
  },
  notifyTeamReviews: {
    read: (c) => c.notifyTeamReviews,
    setter: (c) => c.setNotifyTeamReviews,
    save: saveNotifyTeamReviews,
  },
  teamReviews: { read: (c) => c.teamReviews, setter: (c) => c.setTeamReviews, save: saveTeamReviews },
  teamReviewStats: {
    read: (c) => c.teamReviewStats,
    setter: (c) => c.setTeamReviewStats,
    save: saveTeamReviewStats,
  },
  copyLinks: { read: (c) => c.copyLinks, setter: (c) => c.setCopyLinks, save: saveCopyLinks },
};

/**
 * Describes a settings row that cycles through a fixed list of choices.
 * Left steps back and every other key steps forward, and the choice
 * persists like a toggle.
 */
interface ChoiceRow<T> {
  choices: readonly T[];
  read: (context: KeymapContext) => T;
  setter: (context: KeymapContext) => Dispatch<SetStateAction<T>>;
  save: (next: T) => boolean;
}

/**
 * Cycles auto, terminal, the platform command, and bell. The notifier
 * the App builds follows the state right away, so the next send and the
 * test row already use the new channel.
 */
const NOTIFY_CHANNEL_ROW: ChoiceRow<NotifyChannel> = {
  choices: NOTIFY_CHANNELS,
  read: (c) => c.notifyChannel,
  setter: (c) => c.setNotifyChannel,
  save: saveNotifyChannel,
};

/**
 * Cycles github and linear. The next enter on a queue row already opens
 * on the new site.
 */
const OPEN_IN_ROW: ChoiceRow<LinkTarget> = {
  choices: LINK_TARGETS,
  read: (c) => c.openIn,
  setter: (c) => c.setOpenIn,
  save: saveOpenIn,
};

function cycleChoice<T>(key: KeyEvent, row: ChoiceRow<T>, context: KeymapContext): void {
  const next = cycled(row.choices, row.read(context), stepOf(key));

  row.setter(context)(next);
  reportSaved(context, row.save(next));
}

/**
 * Acts on a toggle or choice row of the settings dialog and reports
 * whether the setting was one of them. The rows that edit, confirm, or
 * run an action belong to the settings actions module instead.
 */
export function handleSettingRowKey(key: KeyEvent, setting: string, context: KeymapContext): boolean {
  const toggle = TOGGLE_ROWS[setting];

  if (toggle !== undefined) {
    const next = !toggle.read(context);

    toggle.setter(context)(next);
    reportSaved(context, toggle.save(next));

    return true;
  }

  switch (setting) {
    case 'notifyChannel': {
      cycleChoice(key, NOTIFY_CHANNEL_ROW, context);

      return true;
    }
    case 'openIn': {
      cycleChoice(key, OPEN_IN_ROW, context);

      return true;
    }
    default: {
      return false;
    }
  }
}
