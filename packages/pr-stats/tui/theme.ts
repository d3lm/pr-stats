import { CliError } from '../utils';

/**
 * Default palette of the TUI, a warm amber accent family over neutral
 * grays. The presets below replace the hue-carrying subset of these
 * colors, and the theme object the components read starts as a copy.
 */
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
  chartBar: '#b98d63',
  chartLine: '#c99a6f',
  chartDim: '#6e563f',
  heat: ['#5c4732', '#8a6a49', '#c0925f', '#f0b689'],
};

export type Palette = typeof BASE;

export type ColorKey = keyof Palette;

/**
 * Live theme the components read at render time. applyThemeState rebuilds
 * it in place from the default palette and the active theme, so modules
 * must read theme colors at render time rather than capture them at
 * module load.
 */
export const theme: Palette = { ...BASE, heat: [...BASE.heat] };

/**
 * Built-in themes the settings dialog cycles through. Every preset takes
 * the hue-carrying colors of the default palette and rotates their hue to
 * one target while keeping saturation and lightness, so each preset keeps
 * the default's contrast relationships. The neutral text and background
 * colors and the error red stay shared across all presets.
 */
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

/**
 * Names one selectable theme, a built-in preset or the custom theme the
 * user assembled by editing colors.
 */
export type ThemeName = PresetName | 'custom';

/**
 * Parsed form of the theme settings. The preset names the active theme,
 * one of the built-ins or the custom theme. The custom theme starts from
 * the base built-in with the overrides replacing single colors, and it
 * exists once any override is set, whether or not it is active.
 */
export interface ThemeState {
  preset: ThemeName;
  base: PresetName;
  overrides: Partial<Palette>;
}

/**
 * Returns a fresh state of the default theme without a custom theme.
 */
export function defaultThemeState(): ThemeState {
  return { preset: 'default', base: 'default', overrides: {} };
}

/**
 * Reports whether a custom theme exists, which is the case while any
 * color override is set.
 */
export function hasCustomTheme(state: ThemeState): boolean {
  return Object.keys(state.overrides).length > 0;
}

/**
 * Matches the hex forms OpenTUI parses, with 3, 4, 6, or 8 hex digits.
 * Anything else would render as a magenta fallback with a console warning
 * that corrupts the TUI screen, so every color is validated before it
 * reaches the theme.
 */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Validates one hex color and returns it lowercased. The message names
 * the theme color, so a typo in settings.json or the theme dialog points
 * at itself.
 */
function parseColor(key: string, value: unknown): string {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    throw new CliError(`"${key}" must be a hex color like #f0b689`);
  }

  return value.toLowerCase();
}

/**
 * Validates the heat colors, which take one hex color per heatmap level
 * from cool to hot.
 */
function parseHeat(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== BASE.heat.length) {
    throw new CliError(`"heat" must be an array of ${BASE.heat.length} hex colors`);
  }

  return value.map((color) => parseColor('heat', color));
}

/**
 * Parses the theme value from settings.json into a theme state. The
 * preset names the active theme, a built-in or custom, and when absent it
 * defaults to custom while colors are present and to default otherwise.
 * The base names the built-in the custom colors start from. Every other
 * key must name a theme color with a hex value, where heat takes an array
 * of four colors, and together those keys form the custom theme. A custom
 * preset without any colors quietly falls back to its base built-in,
 * because a missing custom theme has an obvious stand-in. A bad key or
 * value throws a CliError naming it, so a typo fails the start like a bad
 * flag instead of silently keeping the default.
 */
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
      // hand-written colors without a preset mean the custom theme is active
      if (!sawPreset) {
        state.preset = 'custom';
      }
    } else if (state.preset === 'custom') {
      // without custom colors there is no custom theme, so the base stands in
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

/**
 * Rebuilds the theme in place from the state's active theme. A built-in
 * preset applies over the default palette alone, and the custom theme
 * applies its base preset with the overrides on top. The settings dialog
 * calls this on every theme change, and the App re-renders afterwards so
 * every component picks up the new colors.
 */
export function applyThemeState(state: ThemeState): void {
  if (state.preset === 'custom') {
    Object.assign(theme, BASE, PRESETS[state.base], state.overrides);
  } else {
    Object.assign(theme, BASE, PRESETS[state.preset]);
  }

  // a copy keeps later theme mutations away from the palette constants
  theme.heat = [...theme.heat];
}

/**
 * Returns the state with the previous or next theme active. The cycle
 * walks the built-in themes and appends the custom theme once one exists,
 * and the custom colors ride along untouched, so cycling away from custom
 * and back restores them.
 */
export function cycleTheme(state: ThemeState, step: 1 | -1): ThemeState {
  const names: ThemeName[] = hasCustomTheme(state) ? [...PRESET_NAMES, 'custom'] : [...PRESET_NAMES];
  const index = names.indexOf(state.preset);

  return { ...state, preset: names[(index + step + names.length) % names.length] };
}

/**
 * Parses the theme settings and applies them onto the theme. Bootstrap
 * calls this before the renderer starts, so a broken theme fails with a
 * plain printed error, and the returned state seeds the settings dialog.
 */
export function applyTheme(value: unknown): ThemeState {
  const state = parseThemeSettings(value);

  applyThemeState(state);

  return state;
}

/**
 * Serializes a theme state back into the value settings.json stores under
 * the theme key. Without a custom theme only a non-default preset gets
 * stored, and the plain default returns undefined, so saveTheme drops the
 * key entirely. With a custom theme the preset is always stored next to
 * the custom colors, so the saved colors never change which theme is
 * active, and the base is stored when the custom theme starts from a
 * non-default built-in.
 */
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

/**
 * Returns the theme state with the given color replaced by the given
 * input text from the theme dialog. An edit on a built-in theme seeds a
 * fresh custom theme from it, replacing any previous custom theme, and
 * activates it. An edit on the custom theme updates its overrides, where
 * empty text and a value equal to the base's own color both drop the
 * override, so the overrides only hold real deviations, and dropping the
 * last override dissolves the custom theme back into its base. Bad input
 * throws a CliError naming the color.
 */
export function withColorOverride(state: ThemeState, key: ColorKey, text: string): ThemeState {
  // the ternaries repeat the check because a boolean would not narrow the type
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

  // nothing deviates, so the base built-in stays or becomes active again
  return state.preset === 'custom' ? { preset: base, base, overrides: {} } : state;
}

/**
 * Renders the current value of one theme color as editable text, with the
 * heat colors joined by spaces. The theme dialog seeds its input with it.
 */
export function themeColorText(key: ColorKey): string {
  const value = theme[key];

  return Array.isArray(value) ? value.join(' ') : value;
}
