import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureCache } from '../cache';
import { loadSettings } from '../settings';
import { readSnoozes, writeSnoozes } from '../snooze';
import { App } from './App';
import { saveSnapshot, type RawData } from './data/load';
import { clearInput, destroyApp, initial, lineWith, renderApp, waitForText, waitForTextGone } from './testing/harness';

test('snoozes the highlighted PR through the snooze dialog and unsnoozes it with the same key', async () => {
  const setup = await renderApp(<App initial={initial} onQuit={() => {}} />, { width: 140, height: 44 });

  try {
    await waitForText(setup, '2 PRs awaiting your review');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Awaiting your review (n=2)');

    expect(setup.captureCharFrame()).toContain('s snooze');
    expect(setup.captureCharFrame()).not.toContain('Snoozed (n=');

    setup.mockInput.pressKey('s');

    await waitForText(setup, 'Snooze for');

    const dialogFrame = setup.captureCharFrame();

    expect(dialogFrame).toContain('acme/api#7');
    expect(dialogFrame).toContain('Refactor the billing worker');
    expect(dialogFrame).toContain('how long to park the PR');
    expect(dialogFrame).toContain('enter snooze · esc cancel');
    expect(lineWith(dialogFrame, 'Snooze for')).toContain('30m');

    setup.mockInput.pressEscape();

    await waitForTextGone(setup, 'Snooze for');

    expect(setup.captureCharFrame()).toContain('Awaiting your review (n=2)');
    expect(setup.captureCharFrame()).not.toContain('Snoozed (n=');

    setup.mockInput.pressKey('s');

    await waitForText(setup, 'Snooze for');

    clearInput(setup.mockInput, '30m');

    await setup.mockInput.typeText('5x');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'invalid snooze duration "5x"');

    expect(setup.captureCharFrame()).toContain('Snooze for');

    clearInput(setup.mockInput, '5x');

    await setup.mockInput.typeText('2h');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Snoozed (n=1)');

    const snoozedFrame = setup.captureCharFrame();

    expect(snoozedFrame).not.toContain('Snooze for');
    expect(snoozedFrame).toContain('Awaiting your review (n=1)');
    expect(lineWith(snoozedFrame, 'acme/api#7')).toContain('until ');
    expect(snoozedFrame).toContain('snoozed acme/api#7 until');
    expect(snoozedFrame).toContain('the snooze is not saved');

    setup.mockInput.pressEscape();

    await waitForText(setup, '1 PR awaiting your review, 1 requested of your team, 1 snoozed');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Snoozed (n=1)');

    expect(setup.captureCharFrame()).toContain('s snooze');

    setup.mockInput.pressArrow('down');
    setup.mockInput.pressArrow('down');

    await waitForText(setup, 's unsnooze');

    setup.mockInput.pressKey('s');

    await waitForText(setup, '✔ unsnoozed acme/api#7');

    const restoredFrame = setup.captureCharFrame();

    expect(restoredFrame).toContain('Awaiting your review (n=2)');
    expect(restoredFrame).not.toContain('Snoozed (n=');
    expect(lineWith(restoredFrame, 'acme/api#7')).not.toContain('until ');
  } finally {
    destroyApp(setup);
  }
}, 30_000);

test('wakes a snooze up on time, puts the PR back on the awaiting list, persists the change, and notifies', async () => {
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
      {
        kind: 'unrequested',
        pr: {
          repo: 'acme/api',
          number: 8,
          title: 'Add caching to the sessions store',
          url: 'https://github.com/acme/api/pull/8',
          state: 'open',
          createdAt: new Date('2026-08-21T10:00:00Z'),
        },
        reviewedAt: new Date('2026-08-24T09:00:00Z'),
      },
      {
        kind: 'team-pending',
        pr: {
          repo: 'acme/api',
          number: 9,
          title: 'Migrate the queue consumers',
          url: 'https://github.com/acme/api/pull/9',
          state: 'open',
          createdAt: new Date('2026-08-25T08:00:00Z'),
        },
        requestedAt: new Date('2026-08-25T09:00:00Z'),
        team: 'acme/backend',
      },
    ],
    sizes: [],
    authoredTotal: 0,
    mentions: null,
    searchCapped: false,
    fetchedAt: new Date('2026-08-26T10:00:00Z'),
  };

  saveSnapshot(initial, snapshot);

  const until = Date.now() + 4000;

  writeSnoozes([{ kind: 'review', ref: 'acme/api#7', until, at: Date.parse('2026-08-20T09:00:00Z') }]);

  const sent: { title: string; body: string }[] = [];

  const setup = await renderApp(
    <App
      initial={initial}
      initialNotifications
      initialSnoozes={readSnoozes()}
      onQuit={() => {}}
      notify={(title, body) => {
        sent.push({ title, body });
      }}
    />,
    { width: 140, height: 44 },
  );

  try {
    await waitForText(setup, '1 PR awaiting your review, 1 requested of your team, 1 snoozed');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'Snoozed (n=1)');

    expect(setup.captureCharFrame()).toContain('Awaiting your review (n=1)');
    expect(lineWith(setup.captureCharFrame(), 'acme/api#7')).toContain('until ');
    expect(sent).toEqual([]);

    await waitForTextGone(setup, 'Snoozed (n=1)');

    expect(setup.captureCharFrame()).toContain('Awaiting your review (n=2)');
    expect(lineWith(setup.captureCharFrame(), 'acme/api#7')).not.toContain('until ');
    expect(Date.now()).toBeGreaterThanOrEqual(until);

    expect(sent).toEqual([{ title: 'Snooze ended on acme/api#7', body: 'Refactor the billing worker' }]);
    expect(readSnoozes()).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, 'snoozes.json'), 'utf8'))).toEqual({});

    setup.mockInput.pressKey('s');

    await waitForText(setup, 'Snooze for');

    setup.mockInput.pressEnter();

    await waitForText(setup, '✔ snoozed acme/api#7 until');

    const stored = readSnoozes();

    expect(stored).toHaveLength(1);
    expect(stored[0].kind).toBe('review');
    expect(stored[0].ref).toBe('acme/api#7');
    expect(stored[0].at).toBe(Date.parse('2026-08-20T09:00:00Z'));
    expect(stored[0].until).toBeGreaterThan(Date.now() + 29 * 60 * 1000);
    expect(stored[0].until).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);

    expect(setup.captureCharFrame()).toContain('Snoozed (n=1)');
    expect(sent).toHaveLength(1);

    setup.mockInput.pressKey('S');

    await waitForText(setup, 'reloads the data in the background');

    setup.mockInput.pressKey('2');

    await waitForText(setup, 'searches the PRs that @-mention you');

    for (const hint of [
      'only a team of yours is asked',
      'counts the team requests you reviewed',
      'the duration the snooze dialog starts with',
    ]) {
      setup.mockInput.pressArrow('down');

      await waitForText(setup, hint);
    }

    expect(lineWith(setup.captureCharFrame(), 'Default snooze')).toContain('30m');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'enter apply · esc cancel');

    clearInput(setup.mockInput, '30m');

    await setup.mockInput.typeText('30s');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'invalid snooze duration "30s"');

    clearInput(setup.mockInput, '30s');

    await setup.mockInput.typeText('2d');

    setup.mockInput.pressEnter();

    await waitForText(setup, 'saved to settings.json');

    expect(lineWith(setup.captureCharFrame(), 'Default snooze')).toContain('2d');
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ snoozeDuration: '2d' });

    setup.mockInput.pressEscape();

    await waitForText(setup, 's snooze');

    setup.mockInput.pressKey('s');

    await waitForText(setup, 'Snooze for');

    expect(lineWith(setup.captureCharFrame(), 'Snooze for')).toContain('2d');

    setup.mockInput.pressEscape();

    await waitForTextGone(setup, 'Snooze for');
  } finally {
    destroyApp(setup);
    configureCache(false);
    delete process.env.PR_STATS_CACHE_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
