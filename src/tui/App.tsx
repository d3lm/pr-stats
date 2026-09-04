import type { ScrollBoxRenderable } from '@opentui/core';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  DEFAULT_RELOAD_INTERVAL,
  parseReloadInterval,
  reloadIntervalMs,
  saveReloadInterval,
  saveSnoozeDuration,
  saveTheme,
  type NotifyChannel,
} from '../settings';
import {
  DEFAULT_SNOOZE_DURATION,
  dueSnoozes,
  formatWakeTime,
  parseSnoozeDuration,
  wokenPrs,
  type Snooze,
} from '../snooze';
import { CliError } from '../utils';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { MainPanel } from './components/MainPanel';
import { Modals } from './components/Modals';
import { TabBar } from './components/TabBar';
import { describeSnoozeWakeUps } from './data/notifications';
import { useAutoReload } from './hooks/useAutoReload';
import { useDeferredLoading } from './hooks/useDeferredLoading';
import { useLoader } from './hooks/useLoader';
import { useReviewNotifications } from './hooks/useReviewNotifications';
import { useSnoozes } from './hooks/useSnoozes';
import { useSnoozeWakeups } from './hooks/useSnoozeWakeups';
import { useViewModel } from './hooks/useViewModel';
import { handleAppKey } from './keymap';
import { browseReducer, initialBrowseState } from './state/browse';
import {
  fetchParamsKey,
  FIELDS,
  toggleReviewType,
  toggleWorkDay,
  validateField,
  type OptionsState,
} from './state/options';
import { SETTINGS, THEME_COLORS } from './state/settings';
import { initialUiState, uiReducer } from './state/ui';
import {
  applyThemeState,
  defaultThemeState,
  theme,
  themeSettingsOf,
  withColorOverride,
  type ThemeState,
} from './theme';
import { openInBrowser } from './utils/browser';
import { createClipboardCopier } from './utils/clipboard';
import { createNotifier, notificationBoundary, type Notifier } from './utils/notify';
import {
  buildCommentRepoOptions,
  buildMergedRepoOptions,
  buildOpenRepoOptions,
  buildPendingRepoOptions,
  buildReviewRepoOptions,
  buildSizeRepoOptions,
} from './views/repos';

interface AppProps {
  initial: OptionsState;
  /**
   * Holds the options saved in the cache directory at startup, or null
   * when nothing valid is saved. The options modal compares the live
   * options against them and updates the copy when the user saves.
   */
  initialSaved?: OptionsState | null;
  /**
   * Seeds the disable-cache state, from the --no-cache flag or the saved
   * setting. The settings dialog toggles it at runtime.
   */
  initialNoCache?: boolean;
  /**
   * Seeds the auto-reload state from the saved setting. While it is on,
   * the data reloads in the background every reload interval. The
   * settings dialog toggles it at runtime.
   */
  initialAutoReload?: boolean;
  /**
   * Seeds the reload interval from the saved setting, a value like 30s,
   * 10m, or 2h that bootstrap already validated. The settings dialog
   * edits it at runtime.
   */
  initialReloadInterval?: string;
  /**
   * Seeds the notifications state from the saved setting. While it is
   * on, every fresh load sends a desktop notification for the PRs newly
   * awaiting your review and the reviews re-requested from you since the
   * data shown before it, which is the startup snapshot for the first
   * load. The settings dialog toggles it at runtime.
   */
  initialNotifications?: boolean;
  /**
   * Seeds the notification channel from the saved setting. The settings
   * dialog cycles it at runtime, and the default notifier follows it.
   */
  initialNotifyChannel?: NotifyChannel;
  /**
   * Seeds the copy-links state from the saved setting. While it is on,
   * enter and a click on a PR reference copy the PR's link to the
   * clipboard instead of opening it. The settings dialog toggles it at
   * runtime.
   */
  initialCopyLinks?: boolean;
  /**
   * Seeds the default snooze duration from the saved setting, a value
   * like 30m, 2h, or 1d that bootstrap already validated. The snooze
   * dialog starts with it, and the settings dialog edits it at runtime.
   */
  initialSnoozeDuration?: string;
  /**
   * Seeds the snoozes with what bootstrap read from the snooze file in
   * the cache directory, expired ones included so the wake-up timer can
   * end them and report the PRs that came back while the TUI was closed.
   */
  initialSnoozes?: Snooze[];
  /**
   * Seeds the theme state with what bootstrap parsed from settings.json
   * and already applied. The settings dialog changes it at runtime.
   */
  initialTheme?: ThemeState;
  /**
   * Opens a PR in the browser and reports a failure through the second
   * argument. Tests inject a recorder here so pressing enter never
   * spawns a real browser.
   */
  openUrl?: (url: string, onError: (message: string) => void) => void;
  /**
   * Copies a PR's link to the clipboard and reports a failure through
   * the second argument. When absent, the app copies through OpenTUI's
   * clipboard service on the renderer. Tests inject a recorder here so
   * activating a PR never touches the real clipboard.
   */
  copyUrl?: (url: string, onError: (message: string) => void) => void;
  /**
   * Sends a desktop notification and reports a failure through the
   * third argument. When absent, the app asks the terminal to post the
   * notification through OpenTUI's renderer and falls back to the
   * platform command. Tests inject a recorder here so a load or the
   * test row never reaches the real desktop.
   */
  notify?: Notifier;
  onQuit: () => void;
}

/**
 * Composes the TUI. The data lifecycle lives in useLoader, the derived tab
 * content in useViewModel, the key bindings in the keymap module, and the
 * sections in their own components, with MainPanel rendering the active
 * tab and Modals the open dialog. The browse reducer owns where the user
 * is, the ui reducer owns the dialogs and their feedback, and this
 * component wires the pieces together around the remaining independent
 * state.
 */
export function App({
  initial,
  initialSaved = null,
  initialNoCache = false,
  initialAutoReload = false,
  initialReloadInterval = DEFAULT_RELOAD_INTERVAL,
  initialNotifications = false,
  initialNotifyChannel = 'auto',
  initialCopyLinks = false,
  initialSnoozeDuration = DEFAULT_SNOOZE_DURATION,
  initialSnoozes = [],
  initialTheme = defaultThemeState(),
  openUrl = openInBrowser,
  copyUrl,
  notify,
  onQuit,
}: AppProps) {
  const { width } = useTerminalDimensions();

  /**
   * Falls back to OpenTUI's clipboard service when no copyUrl override
   * came in. The copier lazily creates the service on the first copy,
   * so building it here costs nothing until the user actually copies.
   */
  const renderer = useRenderer();
  const defaultCopyUrl = useMemo(() => createClipboardCopier(renderer), [renderer]);
  const copyLink = copyUrl ?? defaultCopyUrl;

  const [ui, dispatchUi] = useReducer(uiReducer, initialUiState);
  const [browse, dispatchBrowse] = useReducer(browseReducer, initialBrowseState);
  const [options, setOptions] = useState(initial);
  const [saved, setSaved] = useState(initialSaved);
  const [noCache, setNoCache] = useState(initialNoCache);
  const [autoReload, setAutoReload] = useState(initialAutoReload);
  const [reloadInterval, setReloadInterval] = useState(initialReloadInterval);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [notifyChannel, setNotifyChannel] = useState(initialNotifyChannel);
  const [copyLinks, setCopyLinks] = useState(initialCopyLinks);
  const [snoozeDuration, setSnoozeDuration] = useState(initialSnoozeDuration);
  const [themeState, setThemeState] = useState(initialTheme);
  const snoozeStore = useSnoozes(initialSnoozes);

  /**
   * Falls back to the channel-following notifier when no notify override
   * came in. On auto it asks the terminal to post the notification and
   * only shells out to the platform command where the terminal cannot,
   * the forced channels take one path directly, and bell rings the
   * terminal bell instead.
   */
  const defaultNotify = useMemo(
    () => createNotifier(notificationBoundary(renderer), notifyChannel),
    [renderer, notifyChannel],
  );

  const notifier = notify ?? defaultNotify;

  /**
   * Copies the PR's link to the clipboard and reports the copy in the
   * footer notice slot right away. A failing copy command reports
   * asynchronously and takes the slot over from the notice.
   */
  const copyRow = (row: { ref: string; url: string }) => {
    copyLink(row.url, (message) => {
      dispatchUi({ type: 'openErrorReported', message });
    });

    dispatchUi({ type: 'successReported', message: `copied ${row.ref} to the clipboard` });
  };

  /**
   * Ends the snooze of a PR from the snoozed queue, which puts it back
   * on the awaiting list right away, and confirms in the footer notice
   * slot.
   */
  const unsnooze = (ref: string) => {
    snoozeStore.remove([ref]);
    dispatchUi({ type: 'successReported', message: `unsnoozed ${ref}` });
  };

  /**
   * Expires the success notice after a short dwell, so it clears on its
   * own without a keypress. Every report stores a fresh notice object,
   * which restarts the timer even when the same text repeats.
   */
  useEffect(() => {
    if (ui.successNotice === null) {
      return undefined;
    }

    const timer = setTimeout(() => {
      dispatchUi({ type: 'successNoticeExpired' });
    }, 2500);

    return () => {
      clearTimeout(timer);
    };
  }, [ui.successNotice]);

  const reviewScrollRef = useRef<ScrollBoxRenderable>(null);
  const sizeScrollRef = useRef<ScrollBoxRenderable>(null);
  const commentScrollRef = useRef<ScrollBoxRenderable>(null);
  const mergedScrollRef = useRef<ScrollBoxRenderable>(null);

  /**
   * A failed notification reports in the footer notice slot, the same
   * slot a failed browser open or copy uses, so a missing notify-send
   * shows up once instead of the notifications silently doing nothing.
   */
  const notifyReviewChanges = useReviewNotifications(notifications, notifier, (message) => {
    dispatchUi({ type: 'openErrorReported', message });
  });

  /**
   * Every fresh load clears an opened repo that the new data no longer
   * contains, reconciling all five scopes in one dataLoaded transition.
   * The render falls back to the picker either way, and clearing the
   * state too keeps the vanished repo from reopening on its own if a
   * later reload brings it back. The same load feeds the notification
   * diff, keyed by the options it fetched for, which this closure holds
   * because the loader calls back the render that started the load. The
   * startup snapshot feeds the diff first, so the first fresh load
   * reports what changed since the previous session instead of only
   * recording the baseline.
   */
  const { raw, isSnapshot, loading, load, error, stale, reload } = useLoader(options, noCache, {
    onSnapshot: (data) => {
      notifyReviewChanges(fetchParamsKey(options), data.reviewResults);
    },
    onLoaded: (data) => {
      dispatchBrowse({
        type: 'dataLoaded',
        repos: {
          pending: buildPendingRepoOptions(data),
          open: buildOpenRepoOptions(data),
          review: buildReviewRepoOptions(data),
          size: buildSizeRepoOptions(data),
          comment: buildCommentRepoOptions(data),
          merged: buildMergedRepoOptions(data),
        },
      });

      notifyReviewChanges(fetchParamsKey(options), data.reviewResults);
    },
  });

  /**
   * A background reload starts one interval after the last load finished
   * while the setting is on. The interval state always holds a value the
   * parser accepted, so the null branch only covers the off state.
   */
  useAutoReload(autoReload ? reloadIntervalMs(reloadInterval) : null, loading, reload);

  /**
   * A snooze that reaches its wake-up time ends, which rebuilds the
   * queue with the PR back on the awaiting list. When the PR still awaits
   * the review the snooze parked, a desktop notification says so while
   * the setting is on. A PR that got reviewed, closed, or re-requested in
   * the meantime ends its snooze quietly, because the queue already shows
   * the right thing for it. Snoozes that ended while the TUI was closed
   * wake up as soon as data is on screen, the startup snapshot included,
   * so a restart reports them like the new requests it finds.
   */
  useSnoozeWakeups(snoozeStore.snoozes, raw !== null, () => {
    if (raw === null) {
      return;
    }

    const due = dueSnoozes(snoozeStore.snoozes, Date.now());

    if (due.length === 0) {
      return;
    }

    const woken = wokenPrs(due, raw.reviewResults);

    snoozeStore.remove(due.map((snooze) => snooze.ref));

    if (!notifications) {
      return;
    }

    for (const notification of describeSnoozeWakeUps(woken)) {
      notifier(notification.title, notification.body, (message) => {
        dispatchUi({ type: 'openErrorReported', message });
      });
    }
  });

  const views = useViewModel(
    raw,
    options,
    width,
    browse.scopes,
    browse.grouped,
    browse.expanded,
    snoozeStore.snoozes,
    themeState,
  );

  /**
   * A refresh is always running behind the startup snapshot, so the
   * spinner shows immediately instead of flashing the cached-at status
   * for the deferral window first. Regular reloads keep the deferral,
   * which lets fast cache-served reloads finish without a spinner flash.
   */
  const showLoad = useDeferredLoading(loading, isSnapshot ? { showDelay: 0 } : undefined);

  /**
   * Holds the text the input currently shows. The input reports every
   * keystroke here, and commitField reads the final value on Enter.
   */
  const draftRef = useRef('');

  const commitField = () => {
    const field = FIELDS[ui.selectedField];
    const value = draftRef.current.trim();

    try {
      validateField(field.key, value);

      setOptions((previous) => {
        return { ...previous, [field.key]: value };
      });

      dispatchUi({ type: 'fieldCommitted' });
    } catch (error) {
      if (error instanceof CliError) {
        dispatchUi({ type: 'fieldErrorReported', message: error.message });
        return;
      }

      throw error;
    }
  };

  /**
   * Commits an edited reload interval from the settings dialog. A valid
   * value takes effect on the running timer right away and persists to
   * settings.json, with the message slot reporting whether the save
   * landed. A bad value keeps the edit open and shows the error instead
   * of the row hint.
   */
  const commitReloadInterval = () => {
    const value = draftRef.current.trim();

    try {
      parseReloadInterval(value);

      setReloadInterval(value);
      dispatchUi({ type: 'settingCommitted', action: saveReloadInterval(value) ? 'saved' : 'notSaved' });
    } catch (error) {
      if (error instanceof CliError) {
        dispatchUi({ type: 'settingErrorReported', message: error.message });
        return;
      }

      throw error;
    }
  };

  /**
   * Commits an edited default snooze duration from the settings dialog.
   * A valid value seeds the next snooze dialog and persists to
   * settings.json, with the message slot reporting whether the save
   * landed. A bad value keeps the edit open and shows the error instead
   * of the row hint.
   */
  const commitSnoozeDuration = () => {
    const value = draftRef.current.trim();

    try {
      parseSnoozeDuration(value);

      setSnoozeDuration(value);
      dispatchUi({ type: 'settingCommitted', action: saveSnoozeDuration(value) ? 'saved' : 'notSaved' });
    } catch (error) {
      if (error instanceof CliError) {
        dispatchUi({ type: 'settingErrorReported', message: error.message });
        return;
      }

      throw error;
    }
  };

  /**
   * Routes the enter press of the settings dialog's edit mode to the
   * commit handler of the selected row, because the dialog holds two
   * editable durations.
   */
  const commitSetting = () => {
    if (SETTINGS[ui.selectedSetting].key === 'snoozeDuration') {
      commitSnoozeDuration();
    } else {
      commitReloadInterval();
    }
  };

  /**
   * Commits the snooze dialog. A valid duration parks the highlighted PR
   * until now plus the duration, closes the dialog, and confirms in the
   * footer with the wake-up time, or reports in the error slot that the
   * snooze only lasts the session when the disabled cache stored
   * nothing. A bad duration keeps the dialog open and shows the error in
   * place of its hint.
   */
  const commitSnooze = () => {
    const target = ui.snoozeTarget;

    if (target === null) {
      return;
    }

    const value = draftRef.current.trim();

    try {
      const until = Date.now() + parseSnoozeDuration(value);
      const saved = snoozeStore.add({ ref: target.ref, until, requestedAt: target.requestedAt });

      dispatchUi({
        type: 'snoozeCommitted',
        message: `snoozed ${target.ref} until ${formatWakeTime(until)}`,
        saved,
      });
    } catch (error) {
      if (error instanceof CliError) {
        dispatchUi({ type: 'snoozeErrorReported', message: error.message });
        return;
      }

      throw error;
    }
  };

  /**
   * Commits an edited theme color from the theme dialog. A valid value
   * becomes part of the custom theme, which the edit creates from the
   * theme on screen or updates and switches to. It applies to the live
   * theme right away and persists to settings.json, with the message slot
   * reporting whether the save landed. A bad value keeps the edit open
   * and shows the error instead of the color hint.
   */
  const commitThemeColor = () => {
    try {
      const next = withColorOverride(themeState, THEME_COLORS[ui.selectedThemeColor].key, draftRef.current.trim());

      applyThemeState(next);
      setThemeState(next);
      dispatchUi({ type: 'themeColorCommitted', action: saveTheme(themeSettingsOf(next)) ? 'saved' : 'notSaved' });
    } catch (error) {
      if (error instanceof CliError) {
        dispatchUi({ type: 'themeColorErrorReported', message: error.message });
        return;
      }

      throw error;
    }
  };

  /**
   * OpenTUI's useKeyboard delivers keypresses to the latest committed
   * render's handler through useEffectEvent, whose ref syncs in a layout
   * effect before paint, so this closure always reads current state and
   * no manual ref syncing is needed. Escape blurs the focused editor
   * synchronously because React can remove its frame before destroying
   * it, and a following key must not reach that stale renderable.
   */
  useKeyboard((key) => {
    if (ui.editing && key.name === 'escape') {
      renderer.currentFocusedRenderable?.blur();
    }

    handleAppKey(key, {
      ui,
      browse,
      noCache,
      autoReload,
      reloadInterval,
      notifications,
      notifyChannel,
      copyLinks,
      snoozeDuration,
      themeState,
      options,
      views,
      raw,
      dispatchUi,
      dispatchBrowse,
      setOptions,
      setSaved,
      setNoCache,
      setAutoReload,
      setNotifications,
      setNotifyChannel,
      setCopyLinks,
      setThemeState,
      quit: onQuit,
      reload,
      openUrl,
      notify: notifier,
      copyRow,
      unsnooze,
      beginEdit: (value) => {
        draftRef.current = value;
        dispatchUi({ type: 'editStarted' });
      },
      scrollBy: (forTab, delta) => {
        // tab 1 scrolls the merged sub-tab, the only stats view it hosts
        const ref =
          forTab === 1
            ? mergedScrollRef
            : forTab === 2
              ? reviewScrollRef
              : forTab === 3
                ? sizeScrollRef
                : commentScrollRef;

        ref.current?.scrollBy(delta);
      },
    });
  });

  const capWarning = raw?.searchCapped
    ? 'Warning, a search hit the 1000 result cap, so data may be incomplete. Narrow since or repos.'
    : null;

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.bg}>
      <Header
        options={options}
        raw={raw}
        error={error}
        spinning={showLoad}
        reloadEvery={autoReload ? reloadInterval : null}
      />

      <TabBar tab={browse.tab} />

      <MainPanel
        views={views}
        browse={browse}
        warning={capWarning}
        focused={ui.modal === null}
        scrollRefs={{
          review: reviewScrollRef,
          size: sizeScrollRef,
          comment: commentScrollRef,
          merged: mergedScrollRef,
        }}
        error={error}
        loading={loading}
        load={load}
        onRefClick={copyLinks ? copyRow : null}
      />

      <Footer
        width={width}
        modal={ui.modal}
        editing={ui.editing}
        tab={browse.tab}
        authoredTab={browse.authoredTab}
        views={views}
        pendingCursor={browse.rowCursors.pending}
        copyLinks={copyLinks}
        openError={ui.openError}
        successNotice={ui.successNotice === null ? null : ui.successNotice.text}
        stale={stale}
      />

      <Modals
        ui={ui}
        options={options}
        saved={saved}
        noCache={noCache}
        autoReload={autoReload}
        reloadInterval={reloadInterval}
        notifications={notifications}
        notifyChannel={notifyChannel}
        copyLinks={copyLinks}
        snoozeDuration={snoozeDuration}
        themeState={themeState}
        onDraft={(value) => {
          draftRef.current = value;
        }}
        onSubmitField={commitField}
        onSubmitSetting={commitSetting}
        onSubmitThemeColor={commitThemeColor}
        onSubmitSnooze={commitSnooze}
        onToggleReviewType={(type) => {
          setOptions((previous) => {
            return { ...previous, reviewTypes: toggleReviewType(previous.reviewTypes, type) };
          });
        }}
        onToggleWorkDay={(day) => {
          setOptions((previous) => {
            return { ...previous, workDays: toggleWorkDay(previous.workDays, day) };
          });
        }}
      />
    </box>
  );
}
