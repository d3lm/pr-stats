import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureCache } from '../cache';
import { readMentionReads, writeMentionReads } from '../mentions';
import { loadSettings } from '../settings';
import { readSnoozes, writeSnoozes } from '../snooze';
import { App } from './App';
import { saveSnapshot, type RawData } from './data/load';
import { loadMentionBaseline, saveMentionBaseline } from './data/notifications';
import {
  destroyApp,
  initial,
  lineWith,
  mentionKey,
  renderApp,
  waitForRefresh,
  waitForRefreshAfter,
  waitForText,
  waitForTextGone,
} from './testing/harness';

test('reports the mentions that arrived since the snapshot while mention notifications are on', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-stats-app-'));

  process.env.PR_STATS_CACHE_DIR = dir;

  configureCache(true);
  loadSettings();

  const web13 = {
    repo: 'acme/web',
    number: 13,
    title: 'Redesign the dashboard',
    url: 'https://github.com/acme/web/pull/13',
    state: 'open',
    createdAt: new Date('2026-07-20T10:00:00Z'),
    updatedAt: new Date('2026-08-25T14:00:00Z'),
  };

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
        kind: 'pending',
        pr: {
          repo: 'acme/api',
          number: 7,
          title: 'Refactor the billing worker',
          url: 'https://github.com/acme/api/pull/7',
          state: 'open',
          createdAt: new Date('2026-08-19T10:00:00Z'),
        },
        requestedAt: new Date('2026-08-20T09:00:00Z'),
      },
    ],
    sizes: [],
    authoredTotal: 0,
    mentions: [{ pr: web13, mentions: [{ id: 'web13-c3', at: new Date('2026-08-25T14:00:00Z') }], earlier: [] }],
    searchCapped: false,
    fetchedAt: new Date('2026-08-24T12:00:00Z'),
  };

  saveSnapshot(initial, snapshot);

  const sent: { title: string; body: string }[] = [];

  const setup = await renderApp(
    <App
      initial={initial}
      initialNotifications
      initialNotifyMentions
      onQuit={() => {}}
      notify={(title, body) => {
        sent.push({ title, body });
      }}
    />,
    { width: 140, height: 44 },
  );

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    const firstRefresh = await waitForRefresh(setup);
    const firstRefreshSeen = Date.now();

    expect(sent).toEqual([{ title: 'Mentioned on acme/api#7', body: 'Refactor the billing worker' }]);

    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1100 - (Date.now() - firstRefreshSeen))));

    setup.mockInput.pressKey('r');

    await waitForRefreshAfter(setup, firstRefresh);

    expect(sent).toHaveLength(1);

    setup.mockInput.pressKey('S');

    await waitForText(setup, 'reloads the data in the background');

    setup.mockInput.pressKey('3');

    await waitForText(setup, 'notifies you when a load finds');

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'also notifies you when someone @-mentions you');

    expect(lineWith(setup.captureCharFrame(), 'Mention notifications')).toContain('‹ yes ›');

    const persisted = loadMentionBaseline(mentionKey('testuser'));

    expect(persisted?.seen).toEqual(new Set(['web13-c3', 'api7-r3-c3']));
    expect(persisted?.unread).toEqual(new Map());
    expect(persisted?.observedAt).toBeGreaterThan(Date.parse('2026-08-24T12:00:00Z'));
  } finally {
    destroyApp(setup);
    configureCache(false);
    delete process.env.PR_STATS_CACHE_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test('a PR the previous session could not read keeps its held cutoff across the restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-stats-app-'));

  process.env.PR_STATS_CACHE_DIR = dir;

  configureCache(true);
  loadSettings();

  const web13 = {
    repo: 'acme/web',
    number: 13,
    title: 'Redesign the dashboard',
    url: 'https://github.com/acme/web/pull/13',
    state: 'open',
    createdAt: new Date('2026-07-20T10:00:00Z'),
    updatedAt: new Date('2026-08-25T14:00:00Z'),
  };

  const api7 = {
    repo: 'acme/api',
    number: 7,
    title: 'Refactor the billing worker',
    url: 'https://github.com/acme/api/pull/7',
    state: 'open',
    createdAt: new Date('2026-08-19T10:00:00Z'),
    updatedAt: new Date('2026-08-24T16:00:00Z'),
  };

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
        kind: 'pending',
        pr: { ...api7 },
        requestedAt: new Date('2026-08-20T09:00:00Z'),
      },
    ],
    sizes: [],
    authoredTotal: 0,
    mentions: [
      { pr: web13, mentions: [{ id: 'web13-c3', at: new Date('2026-08-25T14:00:00Z') }], earlier: [] },
      { pr: api7, mentions: null, earlier: [] },
    ],
    searchCapped: false,
    fetchedAt: new Date('2026-08-24T18:00:00Z'),
  };

  saveSnapshot(initial, snapshot);

  saveMentionBaseline(mentionKey('testuser'), {
    seen: new Set(['web13-c3']),
    observedAt: Date.parse('2026-08-24T18:00:00Z'),
    unread: new Map([['acme/api#7', Date.parse('2026-08-24T12:00:00Z')]]),
  });

  const sent: { title: string; body: string }[] = [];

  const setup = await renderApp(
    <App
      initial={initial}
      initialNotifications
      initialNotifyMentions
      onQuit={() => {}}
      notify={(title, body) => {
        sent.push({ title, body });
      }}
    />,
    { width: 140, height: 44 },
  );

  try {
    await waitForText(setup, '2 PRs awaiting your review');
    await waitForRefresh(setup);

    expect(sent).toEqual([{ title: 'Mentioned on acme/api#7', body: 'Refactor the billing worker' }]);

    expect(loadMentionBaseline(mentionKey('testuser'))?.unread).toEqual(new Map());
  } finally {
    destroyApp(setup);
    configureCache(false);
    delete process.env.PR_STATS_CACHE_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test('the baseline of another account never seeds the session, and a noCache start restores none', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-stats-app-'));

  process.env.PR_STATS_CACHE_DIR = dir;

  configureCache(true);
  loadSettings();

  const sawNothingLongAgo = {
    seen: new Set<string>(),
    observedAt: Date.parse('2026-08-01T00:00:00Z'),
    unread: new Map<string, number>(),
  };

  for (const run of ['alice', 'noCache'] as const) {
    saveMentionBaseline(mentionKey(run === 'alice' ? 'alice' : 'testuser'), sawNothingLongAgo);

    const sent: { title: string; body: string }[] = [];

    const setup = await renderApp(
      <App
        initial={initial}
        initialNotifications
        initialNotifyMentions
        initialNoCache={run === 'noCache'}
        onQuit={() => {}}
        notify={(title, body) => {
          sent.push({ title, body });
        }}
      />,
      { width: 140, height: 44 },
    );

    try {
      await waitForRefresh(setup);

      expect(sent).toEqual([]);

      const persisted = loadMentionBaseline(mentionKey('testuser'));

      expect(persisted?.seen).toEqual(new Set(['web13-c3', 'api7-r3-c3']));
      expect(persisted?.observedAt).toBeGreaterThan(sawNothingLongAgo.observedAt);
    } finally {
      destroyApp(setup);
    }
  }

  configureCache(false);
  delete process.env.PR_STATS_CACHE_DIR;
  rmSync(dir, { recursive: true, force: true });
}, 30_000);

function inboxSnapshot(): RawData {
  return {
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
        kind: 'pending',
        pr: {
          repo: 'acme/api',
          number: 7,
          title: 'Refactor the billing worker',
          url: 'https://github.com/acme/api/pull/7',
          state: 'open',
          createdAt: new Date('2026-08-19T10:00:00Z'),
        },
        requestedAt: new Date('2026-08-20T09:00:00Z'),
      },
    ],
    sizes: [],
    authoredTotal: 0,
    mentions: [],
    searchCapped: false,
    fetchedAt: new Date('2026-08-24T12:00:00Z'),
  };
}

test('the mention inbox lists the mentions since the seed, and d, D, and s mark, snooze, and restore them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-stats-app-'));

  process.env.PR_STATS_CACHE_DIR = dir;

  configureCache(true);
  loadSettings();
  saveSnapshot(initial, inboxSnapshot());

  const alice = {
    seed: { at: Date.parse('2026-08-01T00:00:00Z'), ids: [] },
    reads: new Map([
      ['acme/web#13', { at: Date.parse('2026-08-25T14:00:00Z'), ids: ['web13-c3'] }],
      ['acme/api#7', { at: Date.parse('2026-08-24T16:00:00Z'), ids: ['api7-r3-c3'] }],
    ]),
  };

  writeMentionReads(new Map([['alice', alice]]));

  const setup = await renderApp(<App initial={initial} initialMentionReads={readMentionReads()} onQuit={() => {}} />, {
    width: 140,
    height: 44,
  });

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    expect(readMentionReads().get('testuser')?.seed).toEqual({ at: Date.parse('2026-08-24T12:00:00Z'), ids: [] });

    setup.mockInput.pressEnter();

    await waitForText(setup, '@ Refactor the billing worker');

    const awaitingFrame = setup.captureCharFrame();

    expect(awaitingFrame).toContain('Awaiting your review (n=2)');
    expect(awaitingFrame).toContain('* Awaiting review   Reviewed   * Mentions');
    expect(lineWith(awaitingFrame, 'acme/web#3')).not.toContain('@ ');
    expect(awaitingFrame).not.toContain('acme/web#13');
    expect(awaitingFrame).toContain('s snooze');
    expect(awaitingFrame).not.toContain('d mark');
    expect(awaitingFrame).not.toContain('D read all');

    setup.mockInput.pressKey('t');

    await waitForText(setup, 'list the open PRs you reviewed');

    setup.mockInput.pressKey('t');

    await waitForText(setup, 'open its mention inbox');

    expect(setup.captureCharFrame()).toContain('2 unread mentions');
    expect(setup.captureCharFrame()).toContain('1 unread mention');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Unread (n=2)');

    const inboxFrame = setup.captureCharFrame();

    expect(inboxFrame.indexOf('acme/web#13')).toBeLessThan(inboxFrame.indexOf('acme/api#7'));
    expect(inboxFrame).not.toContain('@ ');
    expect(inboxFrame).not.toContain('Read (n=');
    expect(inboxFrame).toContain('s snooze · d mark read · D read all');

    setup.mockInput.pressKey('d');

    await waitForText(setup, '✔ marked acme/web#13 read');

    const readFrame = setup.captureCharFrame();

    expect(readFrame).toContain('Unread (n=1)');
    expect(readFrame).toContain('Read (n=1)');
    expect(readFrame.indexOf('acme/api#7')).toBeLessThan(readFrame.indexOf('acme/web#13'));

    expect(readMentionReads().get('testuser')?.reads).toEqual(
      new Map([['acme/web#13', { at: Date.parse('2026-08-25T14:00:00Z'), ids: ['web13-c3'] }]]),
    );

    setup.mockInput.pressKey('s');

    await waitForText(setup, 'Snooze for');

    expect(setup.captureCharFrame()).toContain('acme/api#7');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Snoozed (n=1)');

    const snoozedFrame = setup.captureCharFrame();

    expect(snoozedFrame).not.toContain('Unread (n=');
    expect(lineWith(snoozedFrame, 'acme/api#7')).toContain('until ');

    expect(readSnoozes().map((snooze) => [snooze.kind, snooze.ref, snooze.at, snooze.ids])).toEqual([
      ['mention', 'acme/api#7', Date.parse('2026-08-24T16:00:00Z'), ['api7-r3-c3']],
    ]);

    setup.mockInput.pressKey('t');

    await waitForText(setup, 'Awaiting your review (n=2)');

    expect(lineWith(setup.captureCharFrame(), 'acme/api#7')).not.toContain('@ ');

    setup.mockInput.pressKey('t');

    await waitForText(setup, 'list the open PRs you reviewed');

    setup.mockInput.pressKey('t');

    await waitForText(setup, 'Snoozed (n=1)');

    await waitForText(setup, 's unsnooze · d mark read');

    setup.mockInput.pressKey('d');

    await waitForText(setup, '✔ marked acme/api#7 read');

    expect(setup.captureCharFrame()).toContain('Read (n=2)');
    expect(setup.captureCharFrame()).not.toContain('Snoozed (n=');
    expect(readSnoozes()).toEqual([]);

    setup.mockInput.pressArrow('down');

    await waitForText(setup, 'd mark unread');

    expect(setup.captureCharFrame()).not.toContain('s snooze');

    setup.mockInput.pressKey('d');

    await waitForText(setup, '✔ marked acme/web#13 unread');

    expect(setup.captureCharFrame()).toContain('Unread (n=1)');
    expect(setup.captureCharFrame()).toContain('Read (n=1)');
    expect(readMentionReads().get('testuser')?.reads.get('acme/web#13')).toBeNull();

    setup.mockInput.pressKey('D');

    await waitForText(setup, '✔ marked 1 mention read');

    expect(setup.captureCharFrame()).not.toContain('Unread (n=');
    expect(setup.captureCharFrame()).toContain('Read (n=2)');
    expect(setup.captureCharFrame()).not.toContain('D read all');

    expect(setup.captureCharFrame()).toContain('* Awaiting review   Reviewed   Mentions');

    expect(readMentionReads().get('testuser')?.reads).toEqual(
      new Map([
        ['acme/web#13', { at: Date.parse('2026-08-25T14:00:00Z'), ids: ['web13-c3'] }],
        ['acme/api#7', { at: Date.parse('2026-08-24T16:00:00Z'), ids: ['api7-r3-c3'] }],
      ]),
    );

    expect(readMentionReads().get('alice')).toEqual(alice);

    setup.mockInput.pressKey('S');

    await waitForText(setup, 'reloads the data in the background');

    setup.mockInput.pressKey('2');

    await waitForText(setup, 'searches the PRs that @-mention you');

    expect(lineWith(setup.captureCharFrame(), 'Track mentions')).toContain('‹ yes ›');

    setup.mockInput.pressKey(' ');

    await waitForText(setup, 'saved to settings.json');

    expect(lineWith(setup.captureCharFrame(), 'Track mentions')).toContain('‹ no ›');
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ trackMentions: false });

    setup.mockInput.pressEscape();

    await waitForTextGone(setup, 'Track mentions');

    expect(setup.captureCharFrame()).toContain('Read (n=2)');

    setup.mockInput.pressKey('r');

    await waitForText(setup, 'Mention tracking is off');

    expect(setup.captureCharFrame()).not.toContain('Read (n=');
    expect(readMentionReads().get('testuser')?.seed).toBeNull();
    expect(readMentionReads().get('testuser')?.reads.size).toBe(2);
    expect(readMentionReads().get('alice')).toEqual(alice);
  } finally {
    destroyApp(setup);
    configureCache(false);
    delete process.env.PR_STATS_CACHE_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test('a mention snooze wakes up on time, puts the mention back in the inbox, and notifies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-stats-app-'));

  process.env.PR_STATS_CACHE_DIR = dir;

  configureCache(true);
  loadSettings();
  saveSnapshot(initial, inboxSnapshot());

  writeMentionReads(
    new Map([
      [
        'testuser',
        {
          seed: { at: Date.parse('2026-08-24T12:00:00Z'), ids: [] },
          reads: new Map([['acme/web#13', { at: Date.parse('2026-08-25T14:00:00Z'), ids: ['web13-c3'] }]]),
        },
      ],
    ]),
  );

  const until = Date.now() + 4000;

  writeSnoozes([
    { kind: 'mention', ref: 'acme/api#7', until, at: Date.parse('2026-08-24T15:58:00Z'), ids: ['api7-r3-c3'] },
  ]);

  const sent: { title: string; body: string }[] = [];

  const setup = await renderApp(
    <App
      initial={initial}
      initialNotifications
      initialSnoozes={readSnoozes()}
      initialMentionReads={readMentionReads()}
      onQuit={() => {}}
      notify={(title, body) => {
        sent.push({ title, body });
      }}
    />,
    { width: 140, height: 44 },
  );

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    setup.mockInput.pressKey('t');

    await waitForText(setup, 'list the open PRs you reviewed');

    setup.mockInput.pressKey('t');

    await waitForText(setup, '0 unread mentions, 1 snoozed, 1 read');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Snoozed (n=1)');

    expect(setup.captureCharFrame()).not.toContain('Unread (n=');
    expect(setup.captureCharFrame()).toContain('Read (n=1)');
    expect(sent).toEqual([]);

    await waitForText(setup, 'Unread (n=1)');

    expect(setup.captureCharFrame()).not.toContain('Snoozed (n=');
    expect(Date.now()).toBeGreaterThanOrEqual(until);
    expect(sent).toEqual([{ title: 'Snooze ended on acme/api#7', body: 'Refactor the billing worker' }]);
    expect(readSnoozes()).toEqual([]);
  } finally {
    destroyApp(setup);
    configureCache(false);
    delete process.env.PR_STATS_CACHE_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
