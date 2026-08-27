import { CACHE_MESSAGES, THEME_COLORS, type CacheAction, type ThemeColorSpec } from '../state/settings';
import { theme, themeColorText, type Palette } from '../theme';
import { ModalFrame, ModalRow } from './ModalFrame';

/**
 * Centered modal listing every theme color with a swatch and its current
 * hex value, opened from the settings dialog. Enter edits the selected
 * color in place. A committed value applies to the live theme right away
 * and becomes part of the custom theme, which starts from the built-in
 * theme on screen and persists to settings.json, and an empty value
 * returns the color to that built-in. The bottom line describes where the
 * selected color shows up, or reports a validation error or the save
 * feedback.
 */
export function ThemeModal({
  selected,
  editing,
  error,
  cacheAction,
  overrides,
  onDraft,
  onSubmit,
}: {
  selected: number;
  editing: boolean;
  error: string | null;
  cacheAction: CacheAction | null;
  overrides: Partial<Palette>;
  onDraft: (value: string) => void;
  onSubmit: () => void;
}) {
  const spec = THEME_COLORS[selected];
  const message = cacheAction === null ? null : CACHE_MESSAGES[cacheAction];
  const hint = spec.key in overrides ? `${spec.hint} · custom color, an empty value restores the theme` : spec.hint;

  return (
    <ModalFrame title="Theme colors">
      <box flexDirection="column" marginBottom={1}>
        {THEME_COLORS.map((color, index) => (
          <ColorRow
            key={color.key}
            color={color}
            isSelected={index === selected}
            isEditing={index === selected && editing}
            isCustom={color.key in overrides}
            onDraft={onDraft}
            onSubmit={onSubmit}
          />
        ))}
      </box>
      <text wrapMode="word" height={2} fg={error !== null ? theme.error : theme.muted} marginLeft={2} marginRight={2}>
        {error ?? message?.text ?? hint}
      </text>
    </ModalFrame>
  );
}

/**
 * Renders one color row. The value slot shows a swatch in the color
 * itself next to the hex value, marks overridden colors in the primary
 * text color, and turns into an input while editing.
 */
function ColorRow({
  color,
  isSelected,
  isEditing,
  isCustom,
  onDraft,
  onSubmit,
}: {
  color: ThemeColorSpec;
  isSelected: boolean;
  isEditing: boolean;
  isCustom: boolean;
  onDraft: (value: string) => void;
  onSubmit: () => void;
}) {
  const value = themeColorText(color.key);
  const swatch = theme[color.key];

  return (
    <ModalRow label={color.key} isSelected={isSelected}>
      {isEditing ? (
        <input
          width={36}
          value={value}
          focused
          onInput={(next: unknown) => {
            onDraft(String(next));
          }}
          onSubmit={() => {
            onSubmit();
          }}
          backgroundColor={theme.inputBg}
          focusedBackgroundColor={theme.inputFocusedBg}
          textColor={theme.text}
          cursorColor={theme.accent}
        />
      ) : (
        <text wrapMode="none">
          {Array.isArray(swatch) ? (
            <>
              <span fg={swatch[0]}>█</span>
              <span fg={swatch[1]}>█</span>
              <span fg={swatch[2]}>█</span>
              <span fg={swatch[3]}>█</span>
            </>
          ) : (
            <span fg={swatch}>██</span>
          )}
          <span> </span>
          {isSelected ? <b fg={theme.text}>{value}</b> : <span fg={isCustom ? theme.text : theme.muted}>{value}</span>}
        </text>
      )}
    </ModalRow>
  );
}
