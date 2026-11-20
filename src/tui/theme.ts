import { CliError } from '../utils';

const BASE = {
  bg: '#1e1e1e',
  border: '#363636',
  text: '#ffffff',
  muted: '#959595',
  dim: '#5d5d5d',
  accent: '#f0b689',
  selectedBg: '#483e35',
  inputBg: '#2a2a2a',
  inputFocusedBg: '#303030',
  warn: '#f0b689',
  error: '#ff8080',
  success: '#89f0ab',
  chartBar: '#b98d63',
  chartLine: '#c99a6f',
  chartDim: '#6e563f',
  heat: ['#5c4732', '#8a6a49', '#c0925f', '#f0b689'],
};

export type Palette = typeof BASE;

export type ColorKey = keyof Palette;

/**
 * Components read this at render time because applyThemeState mutates it in place.
 */
export const theme: Palette = { ...BASE, heat: [...BASE.heat] };

export const PRESETS = {
  default: {},
  green: {
    accent: '#89f0ab',
    selectedBg: '#35483c',
    warn: '#89f0ab',
    chartBar: '#63b984',
    chartLine: '#6fc991',
    chartDim: '#3f6e51',
    heat: ['#325c43', '#498a63', '#5fc088', '#89f0ab'],
  },
  blue: {
    accent: '#89bdf0',
    selectedBg: '#353e48',
    warn: '#89bdf0',
    chartBar: '#638ab9',
    chartLine: '#6f98c9',
    chartDim: '#3f546e',
    heat: ['#32445c', '#49658a', '#5f87c0', '#89bdf0'],
  },
  purple: {
    accent: '#df89f0',
    selectedBg: '#463548',
    warn: '#df89f0',
    chartBar: '#af63b9',
    chartLine: '#be6fc9',
    chartDim: '#693f6e',
    heat: ['#58325c', '#84498a', '#b85fc0', '#df89f0'],
  },
  yellow: {
    accent: '#f0df89',
    selectedBg: '#484635',
    warn: '#f0df89',
    chartBar: '#b9af63',
    chartLine: '#c9be6f',
    chartDim: '#6e693f',
    heat: ['#5c5832', '#8a8449', '#c0b85f', '#f0df89'],
  },
} satisfies Record<string, Partial<Palette>>;

export type PresetName = keyof typeof PRESETS;

export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

export type ThemeName = PresetName | 'custom';

export interface ThemeState {
  preset: ThemeName;
  base: PresetName;
  overrides: Partial<Palette>;
}

export function defaultThemeState(): ThemeState {
  return { preset: 'default', base: 'default', overrides: {} };
}

export function hasCustomTheme(state: ThemeState): boolean {
  return Object.keys(state.overrides).length > 0;
}

/**
 * OpenTUI renders other color strings as magenta and logs a warning that corrupts the screen.
 */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function parseColor(key: string, value: unknown): string {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    throw new CliError(`"${key}" must be a hex color like #f0b689`);
  }

  return value.toLowerCase();
}

function parseHeat(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== BASE.heat.length) {
    throw new CliError(`"heat" must be an array of ${BASE.heat.length} hex colors`);
  }

  return value.map((color) => parseColor('heat', color));
}

export function parseThemeSettings(value: unknown): ThemeState {
  const state = defaultThemeState();

  if (value === undefined || value === null) {
    return state;
  }

  let sawPreset = false;

  try {
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new CliError('expected an object of theme colors');
    }

    for (const [key, entry] of Object.entries(value)) {
      switch (key) {
        case 'preset': {
          if (typeof entry !== 'string' || (entry !== 'custom' && !(entry in PRESETS))) {
            throw new CliError(`"preset" must be custom or one of ${PRESET_NAMES.join(', ')}`);
          }

          state.preset = entry as ThemeName;
          sawPreset = true;

          break;
        }
        case 'base': {
          if (typeof entry !== 'string' || !(entry in PRESETS)) {
            throw new CliError(`"base" must be one of ${PRESET_NAMES.join(', ')}`);
          }

          state.base = entry as PresetName;

          break;
        }
        case 'heat': {
          state.overrides.heat = parseHeat(entry);

          break;
        }
        default: {
          if (!(key in BASE)) {
            throw new CliError(
              `"${key}" is not a theme color, use preset, base, or one of ${Object.keys(BASE).join(', ')}`,
            );
          }

          (state.overrides as Record<string, string>)[key] = parseColor(key, entry);
        }
      }
    }

    if (hasCustomTheme(state)) {
      if (!sawPreset) {
        state.preset = 'custom';
      }
    } else if (state.preset === 'custom') {
      state.preset = state.base;
    } else if (state.base !== 'default') {
      throw new CliError('"base" only applies with custom colors, use preset to pick a built-in theme');
    }
  } catch (error) {
    if (error instanceof CliError) {
      throw new CliError(`invalid theme in settings.json, ${error.message}`);
    }

    throw error;
  }

  return state;
}

export function applyThemeState(state: ThemeState): void {
  if (state.preset === 'custom') {
    Object.assign(theme, BASE, PRESETS[state.base], state.overrides);
  } else {
    Object.assign(theme, BASE, PRESETS[state.preset]);
  }

  // the copy keeps theme mutations out of the shared preset heat array
  theme.heat = [...theme.heat];
}

export function cycleTheme(state: ThemeState, step: 1 | -1): ThemeState {
  const names: ThemeName[] = hasCustomTheme(state) ? [...PRESET_NAMES, 'custom'] : [...PRESET_NAMES];
  const index = names.indexOf(state.preset);

  return { ...state, preset: names[(index + step + names.length) % names.length] };
}

export function applyTheme(value: unknown): ThemeState {
  const state = parseThemeSettings(value);

  applyThemeState(state);

  return state;
}

export function themeSettingsOf(state: ThemeState): Record<string, unknown> | undefined {
  if (!hasCustomTheme(state)) {
    return state.preset === 'default' ? undefined : { preset: state.preset };
  }

  const value: Record<string, unknown> = { preset: state.preset };

  if (state.base !== 'default') {
    value.base = state.base;
  }

  return Object.assign(value, state.overrides);
}

export function withColorOverride(state: ThemeState, key: ColorKey, text: string): ThemeState {
  const base = state.preset === 'custom' ? state.base : state.preset;
  const overrides = state.preset === 'custom' ? { ...state.overrides } : {};

  delete overrides[key];

  if (text !== '') {
    const value =
      key === 'heat' ? parseHeat(text.split(/[\s,]+/).filter((part) => part !== '')) : parseColor(key, text);

    const baseValue = { ...BASE, ...PRESETS[base] }[key];

    if (JSON.stringify(value) !== JSON.stringify(baseValue)) {
      (overrides as Record<string, unknown>)[key] = value;
    }
  }

  if (Object.keys(overrides).length > 0) {
    return { preset: 'custom', base, overrides };
  }

  return state.preset === 'custom' ? { preset: base, base, overrides: {} } : state;
}

export function themeColorText(key: ColorKey): string {
  const value = theme[key];

  return Array.isArray(value) ? value.join(' ') : value;
}
