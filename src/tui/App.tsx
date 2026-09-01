import type { ScrollBoxRenderable } from '@opentui/core';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  DEFAULT_RELOAD_INTERVAL,
  parseReloadInterval,
  reloadIntervalMs,
  saveReloadInterval,
  saveTheme,
} from '../settings';
import { CliError } from '../utils';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { MainPanel } from './components/MainPanel';
import { Modals } from './components/Modals';
import { TabBar } from './components/TabBar';
import { useAutoReload } from './hooks/useAutoReload';
import { useDeferredLoading } from './hooks/useDeferredLoading';
import { useLoader } from './hooks/useLoader';
import { useViewModel } from './hooks/useViewModel';
import { handleAppKey } from './keymap';
import { browseReducer, initialBrowseState } from './state/browse';
import { FIELDS, toggleReviewType, toggleWorkDay, validateField, type OptionsState } from './state/options';
import { THEME_COLORS } from './state/settings';
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
   * Seeds the copy-links state from the saved setting. While it is on,
   * enter and a click on a PR reference copy the PR's link to the
   * clipboard instead of opening it. The settings dialog toggles it at
   * runtime.
   */
  initialCopyLinks?: boolean;
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
  initialCopyLinks = false,
  initialTheme = defaultThemeState(),
  openUrl = openInBrowser,
  copyUrl,
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
  const [copyLinks, setCopyLinks] = useState(initialCopyLinks);
  const [themeState, setThemeState] = useState(initialTheme);

  /**
   * Copies the PR's link to the clipboard and reports the copy in the
   * footer notice slot right away. A failing copy command reports
   * asynchronously and takes the slot over from the notice.
   */
  const copyRow = (row: { ref: string; url: string }) => {
    copyLink(row.url, (message) => {
      dispatchUi({ type: 'openErrorReported', message });
    });

    dispatchUi({ type: 'copyReported', message: `copied ${row.ref} to the clipboard` });
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
   * Every fresh load clears an opened repo that the new data no longer
   * contains, reconciling all five scopes in one dataLoaded transition.
   * The render falls back to the picker either way, and clearing the
   * state too keeps the vanished repo from reopening on its own if a
   * later reload brings it back.
   */
  const { raw, isSnapshot, loading, load, error, stale, reload } = useLoader(options, noCache, (data) => {
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
  });

  /**
   * A background reload starts one interval after the last load finished
   * while the setting is on. The interval state always holds a value the
   * parser accepted, so the null branch only covers the off state.
   */
  useAutoReload(autoReload ? reloadIntervalMs(reloadInterval) : null, loading, reload);

  const views = useViewModel(raw, options, width, browse.scopes, browse.grouped, browse.expanded, themeState);

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
   * no manual ref syncing is needed.
   */
  useKeyboard((key) => {
    handleAppKey(key, {
      ui,
      browse,
      noCache,
      autoReload,
      reloadInterval,
      copyLinks,
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
      setCopyLinks,
      setThemeState,
      quit: onQuit,
      reload,
      openUrl,
      copyRow,
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
        copyLinks={copyLinks}
        themeState={themeState}
        onDraft={(value) => {
          draftRef.current = value;
        }}
        onSubmitField={commitField}
        onSubmitReloadInterval={commitReloadInterval}
        onSubmitThemeColor={commitThemeColor}
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
