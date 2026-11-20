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

export function reportSaved(context: KeymapContext, saved: boolean): void {
  context.dispatchUi({ type: 'cacheActionReported', action: saved ? 'saved' : 'notSaved' });
}

interface ToggleRow {
  read: (context: KeymapContext) => boolean;
  setter: (context: KeymapContext) => Dispatch<SetStateAction<boolean>>;
  save: (next: boolean) => boolean;
}

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

interface ChoiceRow<T> {
  choices: readonly T[];
  read: (context: KeymapContext) => T;
  setter: (context: KeymapContext) => Dispatch<SetStateAction<T>>;
  save: (next: T) => boolean;
}

const NOTIFY_CHANNEL_ROW: ChoiceRow<NotifyChannel> = {
  choices: NOTIFY_CHANNELS,
  read: (c) => c.notifyChannel,
  setter: (c) => c.setNotifyChannel,
  save: saveNotifyChannel,
};

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
