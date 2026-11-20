import type { ScrollBoxRenderable } from '@opentui/core';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import { useEffect, useMemo, useReducer, useRef, useState, type RefObject } from 'react';
import { wokenMentions, type MentionReadsByUser } from '../mentions';
import {
  DEFAULT_RELOAD_INTERVAL,
  parseReloadInterval,
  reloadIntervalMs,
  saveReloadInterval,
  saveSnoozeDuration,
  saveTheme,
  type LinkTarget,
  type NotifyChannel,
} from '../settings';
import {
  DEFAULT_SNOOZE_DURATION,
  dueSnoozes,
  formatWakeTime,
  parseSnoozeDuration,
  wokenPrs,
  type Snooze,
  type SnoozeTargetKey,
} from '../snooze';
import { CliError } from '../utils';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { MainPanel } from './components/MainPanel';
import { Modals } from './components/Modals';
import { TabBar } from './components/TabBar';
import type { RawData } from './data/load';
import { describeSnoozeWakeUps } from './data/notifications';
import { useAutoReload } from './hooks/useAutoReload';
import { useDeferredLoading } from './hooks/useDeferredLoading';
import { useLoader } from './hooks/useLoader';
import { useMentionNotifications } from './hooks/useMentionNotifications';
import { useMentionReads } from './hooks/useMentionReads';
import { useReviewNotifications } from './hooks/useReviewNotifications';
import { useSnoozes } from './hooks/useSnoozes';
import { useSnoozeWakeups } from './hooks/useSnoozeWakeups';
import { useViewModel } from './hooks/useViewModel';
import { handleAppKey } from './keymap';
import { browseReducer, initialBrowseState, type StatsTabKey } from './state/browse';
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
  buildMentionRepoOptions,
  buildMergedRepoOptions,
  buildOpenRepoOptions,
  buildPendingRepoOptions,
  buildReviewedRepoOptions,
  buildReviewRepoOptions,
  buildSizeRepoOptions,
} from './views/repos';
import type { PrRow } from './views/rows';

interface AppProps {
  initial: OptionsState;
  initialSaved?: OptionsState | null;
  initialNoCache?: boolean;
  initialAutoReload?: boolean;
  initialReloadInterval?: string;
  initialNotifications?: boolean;
  initialTrackMentions?: boolean;
  initialNotifyMentions?: boolean;
  initialTeamReviews?: boolean;
  initialNotifyTeamReviews?: boolean;
  initialTeamReviewStats?: boolean;
  initialNotifyChannel?: NotifyChannel;
  initialOpenIn?: LinkTarget;
  initialCopyLinks?: boolean;
  initialSnoozeDuration?: string;
  /**
   * Includes expired snoozes so the wake-up timer can report the ones that lapsed while
   * the TUI was closed.
   */
  initialSnoozes?: Snooze[];
  initialMentionReads?: MentionReadsByUser;
  initialTheme?: ThemeState;
  openUrl?: (url: string, onError: (message: string) => void) => void;
  copyUrl?: (url: string, onError: (message: string) => void) => void;
  notify?: Notifier;
  onQuit: () => void;
}

export function App({
  initial,
  initialSaved = null,
  initialNoCache = false,
  initialAutoReload = false,
  initialReloadInterval = DEFAULT_RELOAD_INTERVAL,
  initialNotifications = false,
  initialTrackMentions = true,
  initialNotifyMentions = false,
  initialTeamReviews = true,
  initialNotifyTeamReviews = false,
  initialTeamReviewStats = false,
  initialNotifyChannel = 'auto',
  initialOpenIn = 'github',
  initialCopyLinks = false,
  initialSnoozeDuration = DEFAULT_SNOOZE_DURATION,
  initialSnoozes = [],
  initialMentionReads = new Map(),
  initialTheme = defaultThemeState(),
  openUrl = openInBrowser,
  copyUrl,
  notify,
  onQuit,
}: AppProps) {
  const { width } = useTerminalDimensions();
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
  const [trackMentions, setTrackMentions] = useState(initialTrackMentions);
  const [notifyMentions, setNotifyMentions] = useState(initialNotifyMentions);
  const [teamReviews, setTeamReviews] = useState(initialTeamReviews);
  const [notifyTeamReviews, setNotifyTeamReviews] = useState(initialNotifyTeamReviews);
  const [teamReviewStats, setTeamReviewStats] = useState(initialTeamReviewStats);
  const [notifyChannel, setNotifyChannel] = useState(initialNotifyChannel);
  const [openIn, setOpenIn] = useState(initialOpenIn);
  const [copyLinks, setCopyLinks] = useState(initialCopyLinks);
  const [snoozeDuration, setSnoozeDuration] = useState(initialSnoozeDuration);
  const [themeState, setThemeState] = useState(initialTheme);
  const snoozeStore = useSnoozes(initialSnoozes);
  const readStore = useMentionReads(initialMentionReads);

  const defaultNotify = useMemo(
    () => createNotifier(notificationBoundary(renderer), notifyChannel),
    [renderer, notifyChannel],
  );

  const notifier = notify ?? defaultNotify;

  const copyRow = (row: { ref: string; url: string }) => {
    copyLink(row.url, (message) => {
      dispatchUi({ type: 'openErrorReported', message });
    });

    dispatchUi({ type: 'successReported', message: `copied ${row.ref} to the clipboard` });
  };

  const unsnooze = (target: SnoozeTargetKey) => {
    snoozeStore.remove([target]);
    dispatchUi({ type: 'successReported', message: `unsnoozed ${target.ref}` });
  };

  const reportMark = (message: string, saved: boolean) => {
    if (saved) {
      dispatchUi({ type: 'successReported', message });
    } else {
      dispatchUi({
        type: 'openErrorReported',
        message: `${message} · the cache is disabled for this session, so the mark is not saved`,
      });
    }
  };

  const markRead = (row: PrRow) => {
    if (row.mention === undefined) {
      return;
    }

    if (row.mention.state === 'snoozed') {
      snoozeStore.remove([{ kind: 'mention', ref: row.ref }]);
    }

    reportMark(`marked ${row.ref} read`, readStore.markRead(row.ref, row.mention.mark));
  };

  const markAllRead = (rows: readonly PrRow[]) => {
    const marks = rows.flatMap((row) => (row.mention === undefined ? [] : [{ ref: row.ref, mark: row.mention.mark }]));

    reportMark(
      `marked ${marks.length} ${marks.length === 1 ? 'mention' : 'mentions'} read`,
      readStore.markAllRead(marks),
    );
  };

  const markUnread = (row: PrRow) => {
    reportMark(`marked ${row.ref} unread`, readStore.markUnread(row.ref));
  };

  // each report stores a new notice object, so the timer restarts even when the text repeats
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

  const scrollRefs: Record<StatsTabKey, RefObject<ScrollBoxRenderable | null>> = {
    review: useRef<ScrollBoxRenderable>(null),
    size: useRef<ScrollBoxRenderable>(null),
    comment: useRef<ScrollBoxRenderable>(null),
    merged: useRef<ScrollBoxRenderable>(null),
  };

  const notifyReviewChanges = useReviewNotifications(
    notifications,
    notifier,
    (message) => {
      dispatchUi({ type: 'openErrorReported', message });
    },
    teamReviews && notifyTeamReviews,
  );

  const notifyMentionChanges = useMentionNotifications(
    trackMentions && notifications && notifyMentions,
    notifier,
    (message) => {
      dispatchUi({ type: 'openErrorReported', message });
    },
    !initialNoCache,
  );

  // an empty user option leaves the params key unchanged across a gh account switch, so the login is part of the key
  const baselineKey = (data: RawData) => `${fetchParamsKey(options)} ${data.user.toLowerCase()}`;

  const { raw, isSnapshot, loading, load, error, rateLimited, stale, reload } = useLoader(
    options,
    { noCache, mentions: trackMentions },
    {
      onSnapshot: (data) => {
        readStore.observe(data);
        notifyReviewChanges(baselineKey(data), data.reviewResults);
        notifyMentionChanges(baselineKey(data), data.mentions, data.fetchedAt);
      },
      onLoaded: (data) => {
        dispatchBrowse({
          type: 'dataLoaded',
          repos: {
            pending: buildPendingRepoOptions(data),
            reviewed: buildReviewedRepoOptions(data),
            mentions: buildMentionRepoOptions(data),
            open: buildOpenRepoOptions(data),
            review: buildReviewRepoOptions(data),
            size: buildSizeRepoOptions(data),
            comment: buildCommentRepoOptions(data),
            merged: buildMergedRepoOptions(data),
          },
        });

        readStore.observe(data);
        notifyReviewChanges(baselineKey(data), data.reviewResults);
        notifyMentionChanges(baselineKey(data), data.mentions, data.fetchedAt);
      },
    },
  );

  useAutoReload(autoReload ? reloadIntervalMs(reloadInterval) : null, loading, reload);

  useSnoozeWakeups(snoozeStore.snoozes, raw !== null, () => {
    if (raw === null) {
      return;
    }

    const due = dueSnoozes(snoozeStore.snoozes, Date.now());

    if (due.length === 0) {
      return;
    }

    const woken = [...wokenPrs(due, raw.reviewResults), ...wokenMentions(due, raw.mentions ?? [], readStore.reads)];

    snoozeStore.remove(due);

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
    readStore.reads,
    { teamReviews, teamReviewStats },
    themeState,
  );

  const showLoad = useDeferredLoading(loading, isSnapshot ? { showDelay: 0 } : undefined);

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

  const commitSetting = () => {
    if (SETTINGS[ui.selectedSetting].key === 'snoozeDuration') {
      commitSnoozeDuration();
    } else {
      commitReloadInterval();
    }
  };

  const commitSnooze = () => {
    const target = ui.snoozeTarget;

    if (target === null) {
      return;
    }

    const value = draftRef.current.trim();

    try {
      const until = Date.now() + parseSnoozeDuration(value);

      const saved = snoozeStore.add({
        kind: target.kind,
        ref: target.ref,
        until,
        at: target.at,
        ...(target.ids === undefined ? {} : { ids: target.ids }),
      });

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

  useKeyboard((key) => {
    // the editor's frame can unmount before React destroys it, so the blur keeps keys off the stale renderable
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
      trackMentions,
      notifyMentions,
      teamReviews,
      notifyTeamReviews,
      teamReviewStats,
      notifyChannel,
      openIn,
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
      setTrackMentions,
      setNotifyMentions,
      setTeamReviews,
      setNotifyTeamReviews,
      setTeamReviewStats,
      setNotifyChannel,
      setOpenIn,
      setCopyLinks,
      setThemeState,
      quit: onQuit,
      reload,
      openUrl,
      notify: notifier,
      copyRow,
      unsnooze,
      markRead,
      markAllRead,
      markUnread,
      beginEdit: (value) => {
        draftRef.current = value;

        dispatchUi({ type: 'editStarted' });
      },
      scrollBy: (forTab, delta, unit) => {
        scrollRefs[forTab].current?.scrollBy(delta, unit);
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
        rateLimited={rateLimited}
        spinning={showLoad}
        wait={loading ? (load?.wait ?? null) : null}
        reloadEvery={autoReload ? reloadInterval : null}
      />

      <TabBar tab={browse.tab} />

      <MainPanel
        views={views}
        browse={browse}
        warning={capWarning}
        scrollRefs={scrollRefs}
        error={error}
        loading={loading}
        load={load}
        openIn={openIn}
        onRefClick={copyLinks ? copyRow : null}
      />

      <Footer
        width={width}
        modal={ui.modal}
        editing={ui.editing}
        browse={browse}
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
        notifications={notifications}
        trackMentions={trackMentions}
        notifyMentions={notifyMentions}
        teamReviews={teamReviews}
        notifyTeamReviews={notifyTeamReviews}
        teamReviewStats={teamReviewStats}
        notifyChannel={notifyChannel}
        openIn={openIn}
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
