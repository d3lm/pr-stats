import type { KeyEvent } from '@opentui/core';
import type { Dispatch, SetStateAction } from 'react';
import { clearCache } from '../cache';
import { resetSettings, saveCopyLinks, saveNoCache, saveTheme } from '../settings';
import { exportStatsFile } from './data/export';
import type { RawData } from './data/load';
import type { AppViews } from './hooks/useViewModel';
import type { BrowseAction, BrowseState, QueueTabKey, StatsTabKey } from './state/browse';
import { FIELDS, writeSavedOptions, type OptionsState } from './state/options';
import { SETTINGS, THEME_COLORS } from './state/settings';
import type { UiAction, UiState } from './state/ui';
import { applyThemeState, cycleTheme, themeColorText, themeSettingsOf, type ThemeState } from './theme';
import { queueRows } from './views/queue';

/**
 * Everything the key handlers read and drive. The committed state comes
 * straight from the App component's hooks, which useKeyboard keeps
 * current through useEffectEvent. The handlers translate keys into
 * dispatched actions on the ui and browse reducers, plus the few setters
 * and side-effect actions that live outside them.
 */
export interface KeymapContext {
  ui: UiState;
  browse: BrowseState;
  noCache: boolean;
  copyLinks: boolean;
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
  setCopyLinks: Dispatch<SetStateAction<boolean>>;
  setThemeState: Dispatch<SetStateAction<ThemeState>>;
  quit: () => void;
  reload: (bypassCache: boolean) => void;
  openUrl: (url: string, onError: (message: string) => void) => void;

  /**
   * Copies the PR's link to the clipboard and reports the copy in the
   * footer, used in place of openUrl while the copy-links setting is on.
   */
  copyRow: (row: { ref: string; url: string }) => void;

  /**
   * Seeds the edit draft with the given value and switches the open
   * modal into editing mode.
   */
  beginEdit: (value: string) => void;

  /**
   * Scrolls the charts pane of the given stats tab by the given number
   * of rows.
   */
  scrollBy: (tab: number, delta: number) => void;
}

function handleOptionsModalKey(key: KeyEvent, context: KeymapContext): void {
  switch (key.name) {
    case 'escape': {
      context.dispatchUi({ type: 'optionsModalClosed' });

      break;
    }
    case 'up':
    case 'k': {
      context.dispatchUi({ type: 'fieldSelectionMoved', delta: -1 });

      break;
    }
    case 'down':
    case 'j': {
      context.dispatchUi({ type: 'fieldSelectionMoved', delta: 1 });

      break;
    }
    case 'return':
    case 'space':
    case 'left':
    case 'right': {
      const field = FIELDS[context.ui.selectedField];

      if (field.kind === 'toggle') {
        context.setOptions((previous) => {
          return { ...previous, [field.key]: !previous[field.key] };
        });
      } else if (field.kind === 'multi') {
        /**
         * Opens the checklist dropdown in the shared edit mode. The
         * focused select handles the keys from here, and escape falls
         * back to the edit-cancel path like a text input.
         */
        if (key.name === 'return' || key.name === 'space') {
          context.dispatchUi({ type: 'editStarted' });
        }
      } else if (key.name === 'return') {
        context.beginEdit(String(context.options[field.key]));
      }

      break;
    }
    case 's': {
      /**
       * Persists the current options, so later runs start from them
       * where no flag overrides them. Debug runs keep the cache disabled,
       * in which case nothing gets stored and the error slot says so.
       */
      const saved = writeSavedOptions(context.options);

      if (saved) {
        context.setSaved(context.options);
      }

      context.dispatchUi({ type: 'optionsSaveReported', saved });

      break;
    }

    // no default
  }
}

function handleSettingsModalKey(key: KeyEvent, context: KeymapContext): void {
  switch (key.name) {
    case 'escape': {
      context.dispatchUi({ type: 'settingsModalEscaped' });

      break;
    }
    case 'up':
    case 'k': {
      context.dispatchUi({ type: 'settingSelectionMoved', delta: -1 });

      break;
    }
    case 'down':
    case 'j': {
      context.dispatchUi({ type: 'settingSelectionMoved', delta: 1 });

      break;
    }
    case 'return':
    case 'space':
    case 'left':
    case 'right': {
      switch (SETTINGS[context.ui.selectedSetting].key) {
        case 'noCache': {
          /**
           * The toggle flips the session state and persists it right
           * away. Debug runs keep the cache disabled, in which case
           * nothing gets stored and the message slot says so.
           */
          const next = !context.noCache;

          context.setNoCache(next);
          context.dispatchUi({ type: 'cacheActionReported', action: saveNoCache(next) ? 'saved' : 'notSaved' });

          break;
        }
        case 'clearCache': {
          if (key.name !== 'return') {
            break;
          }

          if (context.ui.cacheAction === 'confirm') {
            context.dispatchUi({ type: 'cacheActionReported', action: clearCache() ? 'cleared' : 'disabled' });
          } else {
            context.dispatchUi({ type: 'cacheActionReported', action: 'confirm' });
          }

          break;
        }
        case 'copyLinks': {
          /**
           * The toggle flips the session state and persists it right
           * away, like the cache toggle above.
           */
          const next = !context.copyLinks;

          context.setCopyLinks(next);
          context.dispatchUi({ type: 'cacheActionReported', action: saveCopyLinks(next) ? 'saved' : 'notSaved' });

          break;
        }
        case 'themePreset': {
          /**
           * Cycles through the built-in themes plus the custom theme once
           * one exists, applies the choice right away, and persists it
           * like the cache toggle. The custom colors stay saved across
           * the switches, so cycling away from custom and back restores
           * them.
           */
          const next = cycleTheme(context.themeState, key.name === 'left' ? -1 : 1);

          applyThemeState(next);
          context.setThemeState(next);

          context.dispatchUi({
            type: 'cacheActionReported',
            action: saveTheme(themeSettingsOf(next)) ? 'saved' : 'notSaved',
          });

          break;
        }
        case 'themeColors': {
          if (key.name !== 'return') {
            break;
          }

          context.dispatchUi({ type: 'modalOpened', modal: 'theme' });

          break;
        }
        case 'resetSettings': {
          if (key.name !== 'return') {
            break;
          }

          if (context.ui.cacheAction === 'resetConfirm') {
            context.dispatchUi({
              type: 'cacheActionReported',
              action: resetSettings() ? 'resetDone' : 'resetDisabled',
            });
          } else {
            context.dispatchUi({ type: 'cacheActionReported', action: 'resetConfirm' });
          }

          break;
        }
        case 'exportJson': {
          if (key.name !== 'return') {
            break;
          }

          /**
           * The export writes the stats of the data on screen, so it
           * needs a finished load. An unwritable target directory is the
           * one expected failure, which the message slot reports.
           */
          if (context.raw === null) {
            context.dispatchUi({ type: 'cacheActionReported', action: 'exportNoData' });
            break;
          }

          try {
            exportStatsFile(context.raw, context.options);
            context.dispatchUi({ type: 'cacheActionReported', action: 'exported' });
          } catch {
            context.dispatchUi({ type: 'cacheActionReported', action: 'exportFailed' });
          }

          break;
        }
      }

      break;
    }

    // no default
  }
}

/**
 * Drives the theme colors dialog, which lists every theme color as one
 * selectable row. Enter starts editing the selected color in the App's
 * shared edit mode, whose commit handler applies and persists the value.
 * Escape returns to the settings dialog the list opened from.
 */
function handleThemeModalKey(key: KeyEvent, context: KeymapContext): void {
  switch (key.name) {
    case 'escape': {
      context.dispatchUi({ type: 'themeModalClosed' });

      break;
    }
    case 'up':
    case 'k': {
      context.dispatchUi({ type: 'themeColorSelectionMoved', delta: -1 });

      break;
    }
    case 'down':
    case 'j': {
      context.dispatchUi({ type: 'themeColorSelectionMoved', delta: 1 });

      break;
    }
    case 'return': {
      context.beginEdit(themeColorText(THEME_COLORS[context.ui.selectedThemeColor].key));

      break;
    }

    // no default
  }
}

/**
 * Resolves the derived views and the state key of the active queue tab,
 * so the key handler below works the same on the awaiting-review tab and
 * the open-PRs tab.
 */
function queueTabOf(context: KeymapContext) {
  const { views } = context;

  if (context.browse.tab === 0) {
    return {
      key: 'pending' as QueueTabKey,
      view: views?.pending ?? null,
      repos: views?.pendingRepos ?? [],
      scope: views?.pendingScope ?? null,
    };
  }

  return {
    key: 'open' as QueueTabKey,
    view: views?.open ?? null,
    repos: views?.openRepos ?? [],
    scope: views?.openScope ?? null,
  };
}

/**
 * The queue tabs open on a repo picker when the data spans multiple
 * repos, like the stats tabs, and otherwise render one selectable PR
 * list, whose cursor the movement keys drive and whose highlighted PR
 * enter opens in the browser. On the aggregate list, g toggles grouping
 * the rows by repo. The panel scrolls the cursor row into view on its
 * own.
 */
function handleQueueKey(key: KeyEvent, context: KeymapContext): void {
  const { key: tab, view, repos, scope } = queueTabOf(context);

  if (scope !== null && scope.view === 'list') {
    switch (key.name) {
      case 'up':
      case 'k': {
        context.dispatchBrowse({ type: 'repoCursorMoved', tab, delta: -1, count: repos.length });

        break;
      }
      case 'down':
      case 'j': {
        context.dispatchBrowse({ type: 'repoCursorMoved', tab, delta: 1, count: repos.length });

        break;
      }
      case 'return': {
        const cursor = context.browse.repoCursors[tab];

        context.dispatchBrowse({ type: 'repoOpened', tab, repo: repos[Math.min(cursor, repos.length - 1)].repo });

        break;
      }

      // no default
    }

    return;
  }

  if ((key.name === 'escape' || key.name === 'backspace') && repos.length > 0) {
    context.dispatchBrowse({ type: 'pickerReturned', tab });
    return;
  }

  if (key.name === 'g' && repos.length > 0 && scope?.view === 'detail' && scope.repo === null) {
    context.dispatchBrowse({ type: 'groupingToggled', tab });
    return;
  }

  const rows = view === null ? [] : queueRows(view);

  if (rows.length === 0) {
    return;
  }

  switch (key.name) {
    case 'up':
    case 'k': {
      context.dispatchBrowse({ type: 'rowCursorMoved', tab, delta: -1, count: rows.length });

      break;
    }
    case 'down':
    case 'j': {
      context.dispatchBrowse({ type: 'rowCursorMoved', tab, delta: 1, count: rows.length });

      break;
    }
    case 'return': {
      const cursor = context.browse.rowCursors[tab];
      const row = rows[Math.min(cursor, rows.length - 1)];

      if (context.copyLinks) {
        context.copyRow(row);
      } else {
        context.openUrl(row.url, (message) => {
          context.dispatchUi({ type: 'openErrorReported', message });
        });
      }

      break;
    }

    // no default
  }
}

/**
 * Resolves the derived views and the state key of the active stats view,
 * so the key handler below works the same on the review, size, and
 * comments tabs and on the merged sub-tab of the Your PRs tab.
 */
function statsTabOf(context: KeymapContext) {
  const { views } = context;

  if (context.browse.tab === 1) {
    return {
      key: 'merged' as StatsTabKey,
      repos: views?.mergedRepos ?? [],
      scope: views?.mergedScope ?? null,
      view: views?.merged ?? null,
    };
  }

  if (context.browse.tab === 2) {
    return {
      key: 'review' as StatsTabKey,
      repos: views?.reviewRepos ?? [],
      scope: views?.reviewScope ?? null,
      view: views?.review ?? null,
    };
  }

  if (context.browse.tab === 3) {
    return {
      key: 'size' as StatsTabKey,
      repos: views?.sizeRepos ?? [],
      scope: views?.sizeScope ?? null,
      view: views?.size ?? null,
    };
  }

  return {
    key: 'comment' as StatsTabKey,
    repos: views?.commentRepos ?? [],
    scope: views?.commentScope ?? null,
    view: views?.comments ?? null,
  };
}

function handleStatsKey(key: KeyEvent, context: KeymapContext): void {
  const { key: tab, repos, scope, view } = statsTabOf(context);

  if (scope !== null && scope.view === 'list') {
    switch (key.name) {
      case 'up':
      case 'k': {
        context.dispatchBrowse({ type: 'repoCursorMoved', tab, delta: -1, count: repos.length });

        break;
      }
      case 'down':
      case 'j': {
        context.dispatchBrowse({ type: 'repoCursorMoved', tab, delta: 1, count: repos.length });

        break;
      }
      case 'return': {
        const cursor = context.browse.repoCursors[tab];

        context.dispatchBrowse({ type: 'repoOpened', tab, repo: repos[Math.min(cursor, repos.length - 1)].repo });

        break;
      }
    }
  } else if ((key.name === 'escape' || key.name === 'backspace') && repos.length > 0) {
    context.dispatchBrowse({ type: 'pickerReturned', tab });
  } else if (key.name === 'x' && view?.expandable === true) {
    // x lifts the row cap of the capped comparison cards and restores it
    context.dispatchBrowse({ type: 'expandToggled', tab });
  } else if (key.name === 'j') {
    context.scrollBy(context.browse.tab, 2);
  } else if (key.name === 'k') {
    context.scrollBy(context.browse.tab, -2);
  }
}

/**
 * Routes one keypress by input mode, an editing input first, then the
 * global keys, then the open modal, and finally the active tab.
 */
export function handleAppKey(key: KeyEvent, context: KeymapContext): void {
  /**
   * Any keypress dismisses a pending browser-open failure and a
   * copied-link notice. The enter press that opens or copies a PR also
   * lands here, which is fine because a failure reports asynchronously
   * and a fresh copy notice dispatches after the dismissal.
   */
  context.dispatchUi({ type: 'noticesDismissed' });

  if (context.ui.editing) {
    if (key.name === 'escape') {
      context.dispatchUi({ type: 'editCancelled' });
    }

    return;
  }

  if (key.name === 'q') {
    context.quit();
    return;
  }

  if (key.name === 'r') {
    // shift makes it a hard reload that bypasses the cache
    context.reload(key.shift);
    return;
  }

  if (context.ui.modal === 'options') {
    handleOptionsModalKey(key, context);
    return;
  }

  if (context.ui.modal === 'settings') {
    handleSettingsModalKey(key, context);
    return;
  }

  if (context.ui.modal === 'theme') {
    handleThemeModalKey(key, context);
    return;
  }

  if (key.name === 'o') {
    context.dispatchUi({ type: 'modalOpened', modal: 'options' });
  } else if (key.name === 's') {
    context.dispatchUi({ type: 'modalOpened', modal: 'settings' });
  } else if (['1', '2', '3', '4', '5'].includes(key.name)) {
    context.dispatchBrowse({ type: 'tabSelected', tab: Number(key.name) - 1 });
  } else if (key.name === 'left' || (key.name === 'tab' && key.shift)) {
    context.dispatchBrowse({ type: 'tabCycled', delta: -1 });
  } else if (key.name === 'right' || key.name === 'tab') {
    context.dispatchBrowse({ type: 'tabCycled', delta: 1 });
  } else if (context.browse.tab === 1 && key.name === 't') {
    // t flips the Your PRs tab between the open queue and the merged stats
    context.dispatchBrowse({ type: 'subTabToggled' });
  } else if (context.browse.tab === 0 || (context.browse.tab === 1 && context.browse.authoredTab === 'open')) {
    handleQueueKey(key, context);
  } else {
    handleStatsKey(key, context);
  }
}
