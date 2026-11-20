import type { KeyEvent } from '@opentui/core';
import { clearCache } from '../../cache';
import { resetSettings, saveTheme } from '../../settings';
import { exportStatsFile } from '../data/export';
import { TEST_NOTIFICATION } from '../data/notifications';
import { applyThemeState, cycleTheme, themeSettingsOf } from '../theme';
import type { KeymapContext } from './context';
import { stepOf } from './helpers';
import { reportSaved } from './settingsRows';

function clearCacheRow(context: KeymapContext): void {
  if (context.ui.cacheAction === 'confirm') {
    context.dispatchUi({ type: 'cacheActionReported', action: clearCache() ? 'cleared' : 'disabled' });
  } else {
    context.dispatchUi({ type: 'cacheActionReported', action: 'confirm' });
  }
}

function testNotificationRow(context: KeymapContext): void {
  context.notify(TEST_NOTIFICATION.title, TEST_NOTIFICATION.body, (message) => {
    context.dispatchUi({ type: 'openErrorReported', message });
  });

  context.dispatchUi({ type: 'cacheActionReported', action: 'notified' });
}

function themePresetRow(key: KeyEvent, context: KeymapContext): void {
  const next = cycleTheme(context.themeState, stepOf(key));

  applyThemeState(next);
  context.setThemeState(next);
  reportSaved(context, saveTheme(themeSettingsOf(next)));
}

function resetSettingsRow(context: KeymapContext): void {
  if (context.ui.cacheAction === 'resetConfirm') {
    context.dispatchUi({
      type: 'cacheActionReported',
      action: resetSettings() ? 'resetDone' : 'resetDisabled',
    });
  } else {
    context.dispatchUi({ type: 'cacheActionReported', action: 'resetConfirm' });
  }
}

function exportJsonRow(context: KeymapContext): void {
  if (context.raw === null) {
    context.dispatchUi({ type: 'cacheActionReported', action: 'exportNoData' });
    return;
  }

  try {
    exportStatsFile(context.raw, context.options, context.teamReviewStats);
    context.dispatchUi({ type: 'cacheActionReported', action: 'exported' });
  } catch {
    context.dispatchUi({ type: 'cacheActionReported', action: 'exportFailed' });
  }
}

export function handleSettingActionKey(key: KeyEvent, setting: string, context: KeymapContext): boolean {
  if (setting === 'themePreset') {
    themePresetRow(key, context);

    return true;
  }

  if (key.name !== 'return') {
    return false;
  }

  switch (setting) {
    case 'clearCache': {
      clearCacheRow(context);

      return true;
    }
    case 'reloadInterval': {
      context.beginEdit(context.reloadInterval);

      return true;
    }
    case 'snoozeDuration': {
      context.beginEdit(context.snoozeDuration);

      return true;
    }
    case 'testNotification': {
      testNotificationRow(context);

      return true;
    }
    case 'themeColors': {
      context.dispatchUi({ type: 'modalOpened', modal: 'theme' });

      return true;
    }
    case 'resetSettings': {
      resetSettingsRow(context);

      return true;
    }
    case 'exportJson': {
      exportJsonRow(context);

      return true;
    }
    default: {
      return false;
    }
  }
}
