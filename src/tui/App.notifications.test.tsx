import { setRendererCapabilities } from '@opentui/core/testing';
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureCache } from '../cache';
import { loadSettings } from '../settings';
import { App } from './App';
import { saveSnapshot, type RawData } from './data/load';
import { TEST_NOTIFICATION } from './data/notifications';
import {
  destroyApp,
  initial,
  lineWith,
  renderApp,
  waitForRefresh,
  waitForRefreshAfter,
  waitForText,
} from './testing/harness';

test('sends notifications through the injected notifier and keeps the first load and unchanged reloads quiet', async () => {
  /**
   * Persisting the toggle needs an enabled cache, so this test points
   * the cache at a temp directory like the auto-reload test and loads
   * the empty settings the way bootstrap would. The injected notifier
   * records every send and reports a delivery failure for each one,
   * which exercises the footer path without touching a real desktop.
   */
  const dir = mkdtempSync(join(tmpdir(), 'pr-stats-app-'));

  process.env.PR_STATS_CACHE_DIR = dir;
  configureCache(true);
  loadSettings();

  const sent: { title: string; body: string }[] = [];

  /**
   * The failure of a send waits until the test releases it, the way a
   * spawn error arrives after the send returned, so the frame in between
   * can prove that the message slot reported the attempt first.
   */
  const pending: { fail: (() => void) | null } = { fail: null };

  const setup = await renderApp(
    <App
      initial={initial}
      onQuit={() => {}}
      notify={(title, body, onError) => {
        sent.push({ title, body });

        pending.fail = () => {
          onError('could not send the notification (spawn notify-send ENOENT)');
        };
      }}
    />,
    { width: 140, height: 44 },
  );

  try {
    /**
     * The first load only establishes the baseline, so nothing goes out
     * even though two PRs already await a review.
     */
    await waitForText(setup, '2 PRs awaiting your review');

    const firstRefresh = await waitForRefresh(setup);
    const firstRefreshSeen = Date.now();

    expect(sent).toEqual([]);

    /**
     * The notifications toggle opens the Notifications page of the
     * settings dialog and persists right away.
     */
    setup.mockInput.pressKey('S');

    await waitForText(setup, 'reloads the data in the background');

    setup.mockInput.pressKey('3');

    await waitForText(setup, 'notifies you when a load finds');

    expect(setup.captureCharFrame()).toContain('Desktop notifications');
    expect(setup.captureCharFrame()).toContain('‹ no ›');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'saved to settings.json');

    expect(setup.captureCharFrame()).toContain('‹ yes ›');
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ notifications: true });

    /**
     * The mention toggle below it persists the same way. The next load
     * starts looking for mentions and only records them, so the reload
     * at the end still sends nothing for the canned mentions.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'also notifies you when someone @-mentions you');

    expect(setup.captureCharFrame()).toContain('Mention notifications');
    expect(setup.captureCharFrame()).toContain('‹ no ›');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, '‹ yes ›');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      notifications: true,
      notifyMentions: true,
    });

    /**
     * The team request toggle below it persists the same way. The
     * canned backend request on api#9 already sits in the baseline, so
     * the reload at the end sends nothing for it either.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'also notifies you when a PR gets requested');

    expect(setup.captureCharFrame()).toContain('Team request notifications');
    expect(lineWith(setup.captureCharFrame(), 'Team request notifications')).toContain('‹ no ›');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, '‹ yes ›');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      notifications: true,
      notifyMentions: true,
      notifyTeamReviews: true,
    });

    /**
     * The channel row below the toggles cycles auto, terminal, the
     * platform command, and bell with wrap-around, and persists each
     * step. The cycle ends back on auto, so the send below keeps the
     * default routing.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'auto tries the terminal');

    expect(setup.captureCharFrame()).toContain('‹ auto ›');

    setup.mockInput.pressArrow('right');

    await waitForText(setup, '‹ terminal ›');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      notifications: true,
      notifyMentions: true,
      notifyTeamReviews: true,
      notifyChannel: 'terminal',
    });

    setup.mockInput.pressArrow('left');

    await waitForText(setup, '‹ auto ›');

    // left from the first value wraps around to the bell at the end of the cycle
    setup.mockInput.pressArrow('left');

    await waitForText(setup, '‹ bell ›');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      notifications: true,
      notifyMentions: true,
      notifyTeamReviews: true,
      notifyChannel: 'bell',
    });

    setup.mockInput.pressArrow('right');

    await waitForText(setup, '‹ auto ›');

    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      notifications: true,
      notifyMentions: true,
      notifyTeamReviews: true,
      notifyChannel: 'auto',
    });

    /**
     * With the renderer posing as iTerm2, the test row names the
     * terminal as the channel a send takes and trades its hint for the
     * caveat about the profile setting iTerm2 gates the sequence behind,
     * because the send itself would report no failure there. The bell
     * channel never sends the sequence, so the plain hint returns with
     * it, and the cycle ends back on auto for the send below.
     */
    setRendererCapabilities(setup.renderer, { notifications: true, terminal: { name: 'iTerm2', version: '3.6.0' } });

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'Notification Center Alerts');

    expect(lineWith(setup.captureCharFrame(), 'Send test notification')).toContain('terminal');
    expect(setup.captureCharFrame()).not.toContain('sends a sample notification');

    // the caveat wraps onto the second line of the hint slot instead of clipping
    expect(setup.captureCharFrame()).toContain('Profiles › Terminal');

    setup.mockInput.pressArrow('up');

    await waitForText(setup, 'auto tries the terminal');

    setup.mockInput.pressArrow('left');

    await waitForText(setup, '‹ bell ›');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'sends a sample notification');

    expect(lineWith(setup.captureCharFrame(), 'Send test notification')).toContain('bell');

    setup.mockInput.pressArrow('up');

    await waitForText(setup, 'auto tries the terminal');

    setup.mockInput.pressArrow('right');

    await waitForText(setup, '‹ auto ›');

    /**
     * Enter on the test row sends the sample notification through the
     * injected notifier and reports the attempt in the message slot. The
     * notifier's failure report then takes the dialog's bottom line over,
     * because at this height the dialog covers the footer notice slot the
     * failure also lands in.
     */
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'Notification Center Alerts');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'test notification sent');

    expect(sent).toEqual([TEST_NOTIFICATION]);

    pending.fail?.();

    await waitForText(setup, 'could not send the notification');

    expect(setup.captureCharFrame()).not.toContain('test notification sent');

    /**
     * A reload of the unchanged canned data finds nothing new against
     * the baseline, so nothing else goes out while the setting is on.
     * The refresh time has second granularity, so the reload waits for
     * the next second before it can prove that a load finished.
     */
    setup.mockInput.pressEscape();

    await waitForText(setup, 'r reload');

    expect(setup.captureCharFrame()).not.toContain('could not send the notification');

    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1100 - (Date.now() - firstRefreshSeen))));

    setup.mockInput.pressKey('r');

    await waitForRefreshAfter(setup, firstRefresh);

    expect(sent).toHaveLength(1);
  } finally {
    destroyApp(setup);
    configureCache(false);
    delete process.env.PR_STATS_CACHE_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test('seeds the notification baseline from the startup snapshot, so the first load reports what changed since the last session', async () => {
  /**
   * The snapshot stands for the previous session and needs an enabled
   * cache to be read, so this test points the cache at a temp directory
   * like the notifications test above. It holds web#3 awaiting a review
   * since the same request the canned data reports, and api#7 sitting on
   * the reviewed queue after a review without a personal request, while
   * the canned data has api#7 awaiting a review again. It knows nothing
   * of the backend team's request on api#9.
   */
  const dir = mkdtempSync(join(tmpdir(), 'pr-stats-app-'));

  process.env.PR_STATS_CACHE_DIR = dir;

  configureCache(true);
  loadSettings();

  const snapshot: RawData = {
    user: 'testuser',
    sinceIso: '2026-06-01',
    repos: [],
    reviewResults: [
      {
        kind: 'pending',
        pr: {
          repo: 'acme/web',
          number: 3,
          title: 'Add pagination to the list view',
          url: 'https://github.com/acme/web/pull/3',
          state: 'open',
          createdAt: new Date('2026-08-22T10:00:00Z'),
        },
        requestedAt: new Date('2026-08-23T09:00:00Z'),
      },
      {
        kind: 'unrequested',
        pr: {
          repo: 'acme/api',
          number: 7,
          title: 'Refactor the billing worker',
          url: 'https://github.com/acme/api/pull/7',
          state: 'open',
          createdAt: new Date('2026-08-19T10:00:00Z'),
        },
        reviewedAt: new Date('2026-08-21T09:00:00Z'),
      },
    ],
    sizes: [],
    authoredTotal: 0,
    mentions: null,
    searchCapped: false,
    fetchedAt: new Date('2026-08-26T10:00:00Z'),
  };

  saveSnapshot(initial, snapshot);

  const sent: { title: string; body: string }[] = [];

  const setup = await renderApp(
    <App
      initial={initial}
      initialNotifications
      initialNotifyTeamReviews
      onQuit={() => {}}
      notify={(title, body) => {
        sent.push({ title, body });
      }}
    />,
    { width: 140, height: 44 },
  );

  try {
    /**
     * The snapshot renders first with its single awaiting PR, and the
     * fresh load then brings the second one and the team request. Only
     * api#7 and api#9 are news against the snapshot. Without a completed
     * request cycle of yours on it, the notification calls api#7 a new
     * request, and the backend team's request on api#9 reports under its
     * own heading because the team notifications are on.
     */
    await waitForText(setup, '1 PR awaiting your review');
    await waitForText(setup, '2 PRs awaiting your review');

    const firstRefresh = await waitForRefresh(setup);
    const firstRefreshSeen = Date.now();

    expect(sent).toEqual([
      { title: 'Review requested on acme/api#7', body: 'Refactor the billing worker' },
      { title: 'Review requested of your team on acme/api#9', body: 'Migrate the queue consumers' },
    ]);

    /**
     * A reload of the unchanged canned data finds nothing new against the
     * baseline the first load left behind, the same as without a snapshot.
     */
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1100 - (Date.now() - firstRefreshSeen))));

    setup.mockInput.pressKey('r');

    await waitForRefreshAfter(setup, firstRefresh);

    expect(sent).toHaveLength(2);
  } finally {
    destroyApp(setup);
    configureCache(false);
    delete process.env.PR_STATS_CACHE_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test('a snapshot of another account never seeds the review baseline', async () => {
  /**
   * The snapshot is the one of the test above, which reports api#7 as a
   * new request when it belongs to the same login, but it was loaded for
   * alice while the fake resolves testuser, as after switching the gh
   * account with an empty user option. Alice's pending PRs say nothing
   * about what is news to testuser, so the first load only records what
   * is there.
   */
  const dir = mkdtempSync(join(tmpdir(), 'pr-stats-app-'));

  process.env.PR_STATS_CACHE_DIR = dir;

  configureCache(true);
  loadSettings();

  const snapshot: RawData = {
    user: 'alice',
    sinceIso: '2026-06-01',
    repos: [],
    reviewResults: [
      {
        kind: 'pending',
        pr: {
          repo: 'acme/web',
          number: 3,
          title: 'Add pagination to the list view',
          url: 'https://github.com/acme/web/pull/3',
          state: 'open',
          createdAt: new Date('2026-08-22T10:00:00Z'),
        },
        requestedAt: new Date('2026-08-23T09:00:00Z'),
      },
    ],
    sizes: [],
    authoredTotal: 0,
    mentions: null,
    searchCapped: false,
    fetchedAt: new Date('2026-08-26T10:00:00Z'),
  };

  saveSnapshot(initial, snapshot);

  const sent: { title: string; body: string }[] = [];

  const setup = await renderApp(
    <App
      initial={initial}
      initialNotifications
      onQuit={() => {}}
      notify={(title, body) => {
        sent.push({ title, body });
      }}
    />,
    { width: 140, height: 44 },
  );

  try {
    await waitForText(setup, '1 PR awaiting your review');
    await waitForText(setup, '2 PRs awaiting your review');
    await waitForRefresh(setup);

    expect(sent).toEqual([]);
  } finally {
    destroyApp(setup);
    configureCache(false);
    delete process.env.PR_STATS_CACHE_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
