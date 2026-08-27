import type { ScrollBoxRenderable } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useReducer, useRef, useState } from 'react';
import { saveTheme } from '../settings';
import { CliError } from '../utils';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { MainPanel } from './components/MainPanel';
import { OptionsModal } from './components/OptionsModal';
import { SettingsModal } from './components/SettingsModal';
import { TabBar } from './components/TabBar';
import { ThemeModal } from './components/ThemeModal';
import { useDeferredLoading } from './hooks/useDeferredLoading';
import { useLoader } from './hooks/useLoader';
import { useViewModel } from './hooks/useViewModel';
import { handleAppKey } from './keymap';
import { browseReducer, initialBrowseState } from './state/browse';
import { FIELDS, validateField, type OptionsState } from './state/options';
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
import {
  buildCommentRepoOptions,
  buildOpenRepoOptions,
  buildPendingRepoOptions,
  buildReviewRepoOptions,
  buildSizeRepoOptions,
} from './views/repos';

/**
 * Composes the TUI. The data lifecycle lives in useLoader, the derived tab
 * content in useViewModel, the key bindings in the keymap module, and the
 * sections in their own components, with MainPanel rendering the active
 * tab. The browse reducer owns where the user is, the ui reducer owns the
 * dialogs and their feedback, and this component wires the pieces
 * together around the remaining independent state.
 */
export function App({
  initial,
  initialSaved = null,
  initialNoCache = false,
  initialTheme = defaultThemeState(),
  openUrl = openInBrowser,
  onQuit,
}: {
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
  onQuit: () => void;
}) {
  const { width } = useTerminalDimensions();

  const [ui, dispatchUi] = useReducer(uiReducer, initialUiState);
  const [browse, dispatchBrowse] = useReducer(browseReducer, initialBrowseState);
  const [options, setOptions] = useState(initial);
  const [saved, setSaved] = useState(initialSaved);
  const [noCache, setNoCache] = useState(initialNoCache);
  const [themeState, setThemeState] = useState(initialTheme);

  const reviewScrollRef = useRef<ScrollBoxRenderable>(null);
  const sizeScrollRef = useRef<ScrollBoxRenderable>(null);
  const commentScrollRef = useRef<ScrollBoxRenderable>(null);

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
      },
    });
  });

  const views = useViewModel(raw, options, width, browse.scopes, browse.grouped, themeState);

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
      themeState,
      options,
      views,
      dispatchUi,
      dispatchBrowse,
      setOptions,
      setSaved,
      setNoCache,
      setThemeState,
      quit: onQuit,
      reload,
      openUrl,
      beginEdit: (value) => {
        draftRef.current = value;
        dispatchUi({ type: 'editStarted' });
      },
      scrollBy: (forTab, delta) => {
        const ref = forTab === 2 ? reviewScrollRef : forTab === 3 ? sizeScrollRef : commentScrollRef;

        ref.current?.scrollBy(delta);
      },
    });
  });

  const capWarning = raw?.searchCapped
    ? 'Warning, a search hit the 1000 result cap, so data may be incomplete. Narrow since or repos.'
    : null;

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.bg}>
      <Header options={options} raw={raw} error={error} spinning={showLoad} />

      <TabBar tab={browse.tab} />

      <MainPanel
        views={views}
        browse={browse}
        warning={capWarning}
        focused={ui.modal === null}
        scrollRefs={{ review: reviewScrollRef, size: sizeScrollRef, comment: commentScrollRef }}
        error={error}
        loading={loading}
        load={load}
      />

      <Footer
        width={width}
        modal={ui.modal}
        editing={ui.editing}
        tab={browse.tab}
        views={views}
        openError={ui.openError}
        stale={stale}
      />

      {ui.modal === 'options' && (
        <OptionsModal
          options={options}
          saved={saved}
          selected={ui.selectedField}
          editing={ui.editing}
          fieldError={ui.fieldError}
          onDraft={(value) => {
            draftRef.current = value;
          }}
          onSubmit={commitField}
        />
      )}
      {ui.modal === 'settings' && (
        <SettingsModal
          selected={ui.selectedSetting}
          cacheAction={ui.cacheAction}
          noCache={noCache}
          preset={themeState.preset}
        />
      )}
      {ui.modal === 'theme' && (
        <ThemeModal
          selected={ui.selectedThemeColor}
          editing={ui.editing}
          error={ui.themeColorError}
          cacheAction={ui.cacheAction}
          overrides={themeState.preset === 'custom' ? themeState.overrides : {}}
          onDraft={(value) => {
            draftRef.current = value;
          }}
          onSubmit={commitThemeColor}
        />
      )}
    </box>
  );
}
