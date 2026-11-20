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
  const dir = mkdtempSync(join(tmpdir(), 'pr-stats-app-'));

  process.env.PR_STATS_CACHE_DIR = dir;

  configureCache(true);
  loadSettings();

  const sent: { title: string; body: string }[] = [];

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
    await waitForText(setup, '2 PRs awaiting your review');

    const firstRefresh = await waitForRefresh(setup);
    const firstRefreshSeen = Date.now();

    expect(sent).toEqual([]);

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

    // iTerm2 silently drops the notification sequence unless a profile setting allows it
    setRendererCapabilities(setup.renderer, { notifications: true, terminal: { name: 'iTerm2', version: '3.6.0' } });

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'Notification Center Alerts');

    expect(lineWith(setup.captureCharFrame(), 'Send test notification')).toContain('terminal');
    expect(setup.captureCharFrame()).not.toContain('sends a sample notification');
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

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'Notification Center Alerts');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'test notification sent');

    expect(sent).toEqual([TEST_NOTIFICATION]);

    pending.fail?.();

    await waitForText(setup, 'could not send the notification');

    expect(setup.captureCharFrame()).not.toContain('test notification sent');

    setup.mockInput.pressEscape();

    await waitForText(setup, 'r reload');

    expect(setup.captureCharFrame()).not.toContain('could not send the notification');

    // the refresh time has second granularity
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
    await waitForText(setup, '1 PR awaiting your review');
    await waitForText(setup, '2 PRs awaiting your review');

    const firstRefresh = await waitForRefresh(setup);
    const firstRefreshSeen = Date.now();

    expect(sent).toEqual([
      { title: 'Review requested on acme/api#7', body: 'Refactor the billing worker' },
      { title: 'Review requested of your team on acme/api#9', body: 'Migrate the queue consumers' },
    ]);

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
