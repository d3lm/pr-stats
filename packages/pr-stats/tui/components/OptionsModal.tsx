import { FIELDS, sameOptions, type FieldSpec, type OptionsState } from '../state/options';
import { theme } from '../theme';
import { ModalFrame, ModalRow } from './ModalFrame';

const EMPTY_PLACEHOLDERS: Partial<Record<keyof OptionsState, string>> = {
  repos: '(all accessible)',
  user: '(authenticated user)',
  target: '(none)',
  sizeTarget: '(none)',
  tz: '(system)',
};

/**
 * Splits the fields into the two sections the modal renders. The fetch
 * fields change what GitHub returns, and the analysis fields recompute the
 * charts instantly from the cached data.
 */
const SECTIONS: { title: string; fields: FieldSpec[] }[] = [
  { title: 'Data', fields: FIELDS.filter((field) => field.fetch) },
  { title: 'Analysis', fields: FIELDS.filter((field) => !field.fetch) },
];

/**
 * Centered modal over the charts with every option the command line
 * exposes. The fields are grouped into sections, a save-state line
 * labels how the options relate to the saved ones, and the line below
 * it describes the selected field or shows its validation error.
 * Edits that need a reload light up the stale notice in the app footer
 * instead of the modal.
 */
export function OptionsModal({
  options,
  saved,
  selected,
  editing,
  fieldError,
  onDraft,
  onSubmit,
}: {
  options: OptionsState;
  saved: OptionsState | null;
  selected: number;
  editing: boolean;
  fieldError: string | null;
  onDraft: (value: string) => void;
  onSubmit: () => void;
}) {
  const savedState = savedLine(options, saved);

  return (
    <ModalFrame title="Options">
      {SECTIONS.map((section) => (
        <box key={section.title} flexDirection="column" marginBottom={1}>
          <text wrapMode="none" fg={theme.accent} marginLeft={2}>
            {section.title}
          </text>
          {section.fields.map((field) => {
            const index = FIELDS.indexOf(field);

            return (
              <FieldRow
                key={field.key}
                field={field}
                options={options}
                isSelected={index === selected}
                isEditing={index === selected && editing && field.kind === 'text'}
                onDraft={onDraft}
                onSubmit={onSubmit}
              />
            );
          })}
        </box>
      ))}
      <text wrapMode="none" fg={savedState.color} marginLeft={2} marginRight={2} marginBottom={1}>
        {savedState.text}
      </text>
      <text
        wrapMode="word"
        height={2}
        fg={fieldError !== null ? theme.error : theme.muted}
        marginLeft={2}
        marginRight={2}
      >
        {fieldError ?? FIELDS[selected].hint}
      </text>
    </ModalFrame>
  );
}

/**
 * Builds the save-state line above the hint. It labels whether the live
 * options match the options saved in the cache directory, so it doubles as
 * the indicator that this run pulled its options from a save.
 */
function savedLine(options: OptionsState, saved: OptionsState | null): { text: string; color: string } {
  if (saved === null) {
    return { text: 'press s to save these options for future runs', color: theme.dim };
  }

  if (sameOptions(options, saved)) {
    return { text: 'using saved options · command-line flags override them', color: theme.accent };
  }

  return { text: 'differs from saved options · press s to update', color: theme.warn };
}

function displayValue(key: keyof OptionsState, value: string | boolean): { text: string; isPlaceholder: boolean } {
  if (typeof value === 'boolean') {
    return { text: value ? 'yes' : 'no', isPlaceholder: false };
  }

  if (value === '') {
    return { text: EMPTY_PLACEHOLDERS[key] ?? '(empty)', isPlaceholder: true };
  }

  return { text: value, isPlaceholder: false };
}

/**
 * Renders one option row. The value slot right-aligns the current value,
 * turns into an input while editing, and gets arrows around toggle values
 * on the selected row to show that left and right cycle them.
 */
function FieldRow({
  field,
  options,
  isSelected,
  isEditing,
  onDraft,
  onSubmit,
}: {
  field: FieldSpec;
  options: OptionsState;
  isSelected: boolean;
  isEditing: boolean;
  onDraft: (value: string) => void;
  onSubmit: () => void;
}) {
  const value = displayValue(field.key, options[field.key]);
  const valueColor = value.isPlaceholder ? (isSelected ? theme.muted : theme.dim) : theme.muted;

  return (
    <ModalRow label={field.label} isSelected={isSelected}>
      {isEditing ? (
        <input
          width={32}
          value={String(options[field.key])}
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
      ) : isSelected && field.kind === 'toggle' ? (
        <text wrapMode="none">
          <span fg={theme.muted}>‹ </span>
          <b fg={theme.text}>{value.text}</b>
          <span fg={theme.muted}> ›</span>
        </text>
      ) : isSelected ? (
        <text wrapMode="none">
          <b fg={value.isPlaceholder ? theme.muted : theme.text}>{value.text}</b>
        </text>
      ) : (
        <text wrapMode="none" fg={valueColor}>
          {value.text}
        </text>
      )}
    </ModalRow>
  );
}
