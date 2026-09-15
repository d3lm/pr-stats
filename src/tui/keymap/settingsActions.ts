import type { KeyEvent } from '@opentui/core';
import { clearCache } from '../../cache';
import { resetSettings, saveTheme } from '../../settings';
import { exportStatsFile } from '../data/export';
import { TEST_NOTIFICATION } from '../data/notifications';
import { applyThemeState, cycleTheme, themeSettingsOf } from '../theme';
import type { KeymapContext } from './context';
import { stepOf } from './helpers';
import { reportSaved } from './settingsRows';

/**
 * Clears the cache directory behind a confirmation. The first enter asks
 * for a second one, and the second deletes the cache files.
 */
function clearCacheRow(context: KeymapContext): void {
  if (context.ui.cacheAction === 'confirm') {
    context.dispatchUi({ type: 'cacheActionReported', action: clearCache() ? 'cleared' : 'disabled' });
  } else {
    context.dispatchUi({ type: 'cacheActionReported', action: 'confirm' });
  }
}

/**
 * Sends the test notification. The send is fire and forget, so the
 * message slot reports the attempt right away and a failure arrives
 * later in the footer notice slot, the same way a failed copy does. The
 * dialog's bottom line mirrors the failure, because the dialog covers
 * the footer on a short terminal.
 */
function testNotificationRow(context: KeymapContext): void {
  context.notify(TEST_NOTIFICATION.title, TEST_NOTIFICATION.body, (message) => {
    context.dispatchUi({ type: 'openErrorReported', message });
  });

  context.dispatchUi({ type: 'cacheActionReported', action: 'notified' });
}

/**
 * Cycles through the built-in themes plus the custom theme once one
 * exists, applies the choice right away, and persists it like a toggle.
 * The custom colors stay saved across the switches, so cycling away
 * from custom and back restores them.
 */
function themePresetRow(key: KeyEvent, context: KeymapContext): void {
  const next = cycleTheme(context.themeState, stepOf(key));

  applyThemeState(next);
  context.setThemeState(next);
  reportSaved(context, saveTheme(themeSettingsOf(next)));
}

/**
 * Resets every setting behind a confirmation. The first enter asks for
 * a second one, and the second wipes the settings file.
 */
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

/**
 * Writes the stats of the data on screen to a JSON file, so it needs a
 * finished load. An unwritable target directory is the one expected
 * failure, which the message slot reports.
 */
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

/**
 * Acts on the settings rows that edit a value, ask for a confirmation,
 * or run an action, and reports whether the setting was one of them.
 * Apart from the theme preset, which cycles like a choice row, these
 * rows only react to enter.
 */
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
      // the interval edits in the shared edit mode, whose commit validates and persists it
      context.beginEdit(context.reloadInterval);

      return true;
    }
    case 'snoozeDuration': {
      // the duration edits in the shared edit mode, whose commit validates and persists it
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
