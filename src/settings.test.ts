import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureCache } from './cache';
import { parseCliArgs } from './flags';
import {
  applySettings,
  loadSettings,
  parseReloadInterval,
  reloadIntervalMs,
  resetSettings,
  saveAutoReload,
  saveCopyLinks,
  saveNoCache,
  saveNotifications,
  saveNotifyChannel,
  saveReloadInterval,
  saveTheme,
} from './settings';
import {
  applyTheme,
  applyThemeState,
  cycleTheme,
  defaultThemeState,
  PRESETS,
  theme,
  themeSettingsOf,
  withColorOverride,
  type ThemeState,
} from './tui/theme';
import { CliError } from './utils';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pr-stats-settings-'));
  process.env.PR_STATS_CACHE_DIR = dir;
  configureCache(true);
});

afterEach(() => {
  configureCache(false);
  delete process.env.PR_STATS_CACHE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function writeSettingsFile(contents: unknown): void {
  writeFileSync(join(dir, 'settings.json'), typeof contents === 'string' ? contents : JSON.stringify(contents));
}

test('reads empty settings without a file and while the cache is disabled', () => {
  expect(loadSettings()).toEqual({});

  writeSettingsFile({ noCache: true });

  expect(loadSettings()).toEqual({ noCache: true });

  configureCache(false);

  expect(loadSettings()).toEqual({});
});

test('saveNoCache persists the toggle and keeps hand-written keys', () => {
  writeSettingsFile({ theme: { accent: '#89b4f0' }, custom: 1 });
  loadSettings();

  expect(saveNoCache(true)).toBe(true);

  expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
    theme: { accent: '#89b4f0' },
    custom: 1,
    noCache: true,
  });

  expect(loadSettings().noCache).toBe(true);

  // a disabled cache stores nothing, the way debug runs stay isolated
  configureCache(false);

  expect(saveNoCache(false)).toBe(false);
  expect((JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { noCache: boolean }).noCache).toBe(true);
});

test('saveCopyLinks persists the toggle and keeps hand-written keys', () => {
  writeSettingsFile({ theme: { accent: '#89b4f0' }, noCache: true });
  loadSettings();

  expect(saveCopyLinks(true)).toBe(true);

  expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
    theme: { accent: '#89b4f0' },
    noCache: true,
    copyLinks: true,
  });

  expect(loadSettings().copyLinks).toBe(true);

  // a disabled cache stores nothing, the way debug runs stay isolated
  configureCache(false);

  expect(saveCopyLinks(false)).toBe(false);

  expect((JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { copyLinks: boolean }).copyLinks).toBe(true);
});

test('saveAutoReload and saveReloadInterval persist next to each other and keep hand-written keys', () => {
  writeSettingsFile({ theme: { accent: '#89b4f0' }, noCache: true });
  loadSettings();

  expect(saveAutoReload(true)).toBe(true);
  expect(saveReloadInterval('10m')).toBe(true);

  expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
    theme: { accent: '#89b4f0' },
    noCache: true,
    autoReload: true,
    reloadInterval: '10m',
  });

  // turning the reload off keeps the interval, so turning it back on resumes the cadence
  expect(saveAutoReload(false)).toBe(true);

  expect(loadSettings()).toEqual({
    theme: { accent: '#89b4f0' },
    noCache: true,
    autoReload: false,
    reloadInterval: '10m',
  });

  // a disabled cache stores nothing, the way debug runs stay isolated
  configureCache(false);

  expect(saveAutoReload(true)).toBe(false);
  expect(saveReloadInterval('1h')).toBe(false);

  const stored = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as {
    autoReload: boolean;
    reloadInterval: string;
  };

  expect(stored.autoReload).toBe(false);
  expect(stored.reloadInterval).toBe('10m');
});

test('saveNotifications persists the toggle and keeps hand-written keys', () => {
  writeSettingsFile({ theme: { accent: '#89b4f0' }, autoReload: true });
  loadSettings();

  expect(saveNotifications(true)).toBe(true);

  expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
    theme: { accent: '#89b4f0' },
    autoReload: true,
    notifications: true,
  });

  expect(loadSettings().notifications).toBe(true);

  // a disabled cache stores nothing, the way debug runs stay isolated
  configureCache(false);

  expect(saveNotifications(false)).toBe(false);

  expect(
    (JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { notifications: boolean }).notifications,
  ).toBe(true);
});

test('saveNotifyChannel persists the channel and keeps hand-written keys', () => {
  writeSettingsFile({ theme: { accent: '#89b4f0' }, notifications: true });
  loadSettings();

  expect(saveNotifyChannel('terminal')).toBe(true);

  expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
    theme: { accent: '#89b4f0' },
    notifications: true,
    notifyChannel: 'terminal',
  });

  expect(loadSettings().notifyChannel).toBe('terminal');

  // a disabled cache stores nothing, the way debug runs stay isolated
  configureCache(false);

  expect(saveNotifyChannel('command')).toBe(false);

  expect(
    (JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { notifyChannel: string }).notifyChannel,
  ).toBe('terminal');
});

test('parses reload intervals in seconds, minutes, and hours within a day', () => {
  expect(reloadIntervalMs('1s')).toBe(1000);
  expect(reloadIntervalMs('30s')).toBe(30_000);
  expect(reloadIntervalMs('10m')).toBe(600_000);
  expect(reloadIntervalMs('2h')).toBe(7_200_000);
  expect(reloadIntervalMs('24h')).toBe(86_400_000);
  expect(reloadIntervalMs('1440m')).toBe(86_400_000);

  // anything outside 1s to 24h or not in the amount-unit form is refused
  for (const input of ['', '0s', '0m', '25h', '1441m', '86401s', '10', 'm', '1d', '1.5h', ' 1s', '1s ', '1S', '-1s']) {
    expect(reloadIntervalMs(input)).toBeNull();
  }

  expect(parseReloadInterval('10m')).toBe(600_000);

  expect(() => {
    parseReloadInterval('1d');
  }).toThrow(CliError);

  expect(() => {
    parseReloadInterval('1d');
  }).toThrow('invalid reload interval "1d"');
});

test('resetSettings deletes the file only while the cache is enabled', () => {
  writeSettingsFile({ theme: { accent: '#89b4f0' }, noCache: true });
  loadSettings();

  configureCache(false);

  expect(resetSettings()).toBe(false);
  expect(existsSync(join(dir, 'settings.json'))).toBe(true);

  configureCache(true);

  expect(resetSettings()).toBe(true);
  expect(existsSync(join(dir, 'settings.json'))).toBe(false);
  expect(loadSettings()).toEqual({});

  // a save after the reset writes a fresh file without the old keys
  expect(saveNoCache(true)).toBe(true);
  expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ noCache: true });
});

test('the saved noCache setting fills in only where no flag was given', () => {
  writeSettingsFile({ noCache: true });

  const plain = parseCliArgs([]);

  expect(applySettings(plain.values, plain.explicit).noCache).toBe(true);
  expect(plain.values['no-cache']).toBe(true);

  /**
   * A saved false never downgrades the explicit flag, and without the
   * flag it leaves the default alone.
   */
  writeSettingsFile({ noCache: false });

  const flagged = parseCliArgs(['--no-cache']);

  applySettings(flagged.values, flagged.explicit);

  expect(flagged.values['no-cache']).toBe(true);

  const defaulted = parseCliArgs([]);

  applySettings(defaulted.values, defaulted.explicit);

  expect(defaulted.values['no-cache']).toBe(false);
});

test('rejects a settings file that is malformed or holds the wrong types', () => {
  writeSettingsFile('not json');

  expect(() => loadSettings()).toThrow(CliError);

  writeSettingsFile('[]');

  expect(() => loadSettings()).toThrow(CliError);

  writeSettingsFile({ noCache: 'yes' });

  expect(() => loadSettings()).toThrow(CliError);

  writeSettingsFile({ copyLinks: 'yes' });

  expect(() => loadSettings()).toThrow(CliError);

  writeSettingsFile({ autoReload: 'yes' });

  expect(() => loadSettings()).toThrow(CliError);

  writeSettingsFile({ notifications: 'yes' });

  expect(() => loadSettings()).toThrow('"notifications"');

  // only the four known channel names pass, anything else is a typo
  writeSettingsFile({ notifyChannel: 'osascript' });

  expect(() => loadSettings()).toThrow('"notifyChannel"');

  writeSettingsFile({ notifyChannel: 'bell' });

  expect(loadSettings().notifyChannel).toBe('bell');

  writeSettingsFile({ reloadInterval: 600 });

  expect(() => loadSettings()).toThrow('"reloadInterval"');

  // a hand-written interval goes through the same parser as an edit in the dialog
  writeSettingsFile({ reloadInterval: '1d' });

  expect(() => loadSettings()).toThrow('"reloadInterval"');

  writeSettingsFile({ autoReload: true, reloadInterval: '2h' });

  expect(loadSettings()).toEqual({ autoReload: true, reloadInterval: '2h' });
});

test('applies hand-written colors as the active custom theme', () => {
  const original = { ...theme, heat: [...theme.heat] };

  try {
    // absent theme settings leave the theme alone
    applyTheme(undefined);
    applyTheme(null);

    expect(theme).toEqual(original);

    // colors without a preset activate the custom theme they define
    const state = applyTheme({ accent: '#89b4f0', heat: ['#111', '#2222', '#333333', '#44444480'] });

    expect(state.preset).toBe('custom');
    expect(state.base).toBe('default');
    expect(theme.accent).toBe('#89b4f0');
    expect(theme.heat).toEqual(['#111', '#2222', '#333333', '#44444480']);
    expect(theme.bg).toBe(original.bg);
  } finally {
    Object.assign(theme, original);
  }
});

test('renders built-in presets pure and the custom theme from its base', () => {
  const original = { ...theme, heat: [...theme.heat] };

  try {
    // an active built-in keeps the custom colors saved without applying them
    const state = applyTheme({ preset: 'green', accent: '#89b4f0' });

    expect(state).toEqual({ preset: 'green', base: 'default', overrides: { accent: '#89b4f0' } });
    expect(theme.accent).toBe(PRESETS.green.accent);
    expect(theme.chartBar).toBe(PRESETS.green.chartBar);

    // the custom theme starts from its base and applies the overrides on top
    const custom = applyTheme({ preset: 'custom', base: 'green', accent: '#89b4f0' });

    expect(custom).toEqual({ preset: 'custom', base: 'green', overrides: { accent: '#89b4f0' } });
    expect(theme.accent).toBe('#89b4f0');
    expect(theme.chartBar).toBe(PRESETS.green.chartBar);
    expect(theme.heat).toEqual(PRESETS.green.heat);
    expect(theme.bg).toBe(original.bg);

    // a custom preset without custom colors falls back to its base
    expect(applyTheme({ preset: 'custom' })).toEqual(defaultThemeState());

    expect(applyTheme({ preset: 'custom', base: 'green' })).toEqual({
      preset: 'green',
      base: 'green',
      overrides: {},
    });

    expect(theme.accent).toBe(PRESETS.green.accent);

    // switching back to the default restores the base palette
    applyThemeState(defaultThemeState());

    expect(theme).toEqual(original);
  } finally {
    Object.assign(theme, original);
  }
});

test('cycleTheme walks the built-ins and includes an existing custom theme', () => {
  expect(cycleTheme(defaultThemeState(), 1).preset).toBe('green');
  expect(cycleTheme(defaultThemeState(), -1).preset).toBe('yellow');

  const custom: ThemeState = { preset: 'custom', base: 'green', overrides: { accent: '#89b4f0' } };

  expect(cycleTheme(custom, 1).preset).toBe('default');
  expect(cycleTheme(custom, -1).preset).toBe('yellow');
  expect(cycleTheme({ ...custom, preset: 'yellow' }, 1).preset).toBe('custom');

  // the custom colors ride along, so cycling away and back loses nothing
  expect(cycleTheme(custom, 1).overrides).toEqual({ accent: '#89b4f0' });
  expect(cycleTheme(custom, 1).base).toBe('green');
});

test('rejects unknown theme keys, presets, and colors that are not hex', () => {
  expect(() => {
    applyTheme('dark');
  }).toThrow(CliError);

  expect(() => {
    applyTheme({ acccent: '#89b4f0' });
  }).toThrow('"acccent"');

  expect(() => {
    applyTheme({ preset: 'neon' });
  }).toThrow('"preset"');

  // base needs the custom theme its colors would form
  expect(() => {
    applyTheme({ base: 'green' });
  }).toThrow('"base"');

  expect(() => {
    applyTheme({ base: 'neon', accent: '#89b4f0' });
  }).toThrow('"base"');

  expect(() => {
    applyTheme({ accent: 'blue' });
  }).toThrow('hex color');

  expect(() => {
    applyTheme({ heat: ['#111', '#222'] });
  }).toThrow('4 hex colors');

  expect(() => {
    applyTheme({ heat: ['#111', '#222', '#333', 'nope'] });
  }).toThrow('hex color');
});

test('withColorOverride creates, updates, and dissolves the custom theme', () => {
  const green: ThemeState = { preset: 'green', base: 'default', overrides: {} };

  // an edit on a built-in seeds the custom theme from it and activates it
  const set = withColorOverride(green, 'accent', '#89B4F0');

  expect(set).toEqual({ preset: 'custom', base: 'green', overrides: { accent: '#89b4f0' } });

  // the heat colors split on spaces and commas
  const heat = withColorOverride(set, 'heat', '#111, #222 #333 #444');

  expect(heat.preset).toBe('custom');
  expect(heat.overrides.heat).toEqual(['#111', '#222', '#333', '#444']);
  expect(heat.overrides.accent).toBe('#89b4f0');

  // empty input and the base's own color both drop the override
  expect(withColorOverride(heat, 'heat', '').overrides).toEqual({ accent: '#89b4f0' });

  expect(withColorOverride(heat, 'accent', PRESETS.green.accent).overrides).toEqual({
    heat: ['#111', '#222', '#333', '#444'],
  });

  // dropping the last override dissolves the custom theme into its base
  expect(withColorOverride(set, 'accent', '')).toEqual({ preset: 'green', base: 'green', overrides: {} });

  // a no-op edit on a built-in keeps a saved custom theme untouched
  const inactive: ThemeState = { preset: 'blue', base: 'green', overrides: { accent: '#89b4f0' } };

  expect(withColorOverride(inactive, 'accent', PRESETS.blue.accent)).toBe(inactive);

  expect(() => {
    withColorOverride(green, 'accent', 'blue');
  }).toThrow('hex color');

  expect(() => {
    withColorOverride(green, 'heat', '#111 #222');
  }).toThrow('hex colors');
});

test('themeSettingsOf serializes the state and drops the plain default', () => {
  expect(themeSettingsOf(defaultThemeState())).toBeUndefined();

  expect(themeSettingsOf({ preset: 'blue', base: 'default', overrides: {} })).toEqual({ preset: 'blue' });

  // the preset lands next to custom colors, so saved colors never change the active theme
  expect(themeSettingsOf({ preset: 'default', base: 'default', overrides: { accent: '#89b4f0' } })).toEqual({
    preset: 'default',
    accent: '#89b4f0',
  });

  expect(themeSettingsOf({ preset: 'custom', base: 'green', overrides: { accent: '#89b4f0' } })).toEqual({
    preset: 'custom',
    base: 'green',
    accent: '#89b4f0',
  });
});

test('saveTheme persists the theme and keeps the other keys', () => {
  writeSettingsFile({ noCache: true, custom: 1 });
  loadSettings();

  expect(saveTheme({ preset: 'green' })).toBe(true);

  expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
    noCache: true,
    custom: 1,
    theme: { preset: 'green' },
  });

  // an undefined value removes the theme key again
  expect(saveTheme(undefined)).toBe(true);

  expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ noCache: true, custom: 1 });

  // a disabled cache stores nothing, the way debug runs stay isolated
  configureCache(false);

  expect(saveTheme({ preset: 'blue' })).toBe(false);

  expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ noCache: true, custom: 1 });
});
