import type { ReactNode } from 'react';
import { theme } from '../theme';

const MODAL_WIDTH = 64;

/**
 * Centered modal overlay with the title in a small tab whose label row
 * doubles as the panel's top border. Both the options and the settings
 * dialog render inside this frame.
 */
export function ModalFrame({ title, children }: { title: string; children: ReactNode }) {
  /**
   * Total tab width counting the label, one column of padding on each side,
   * and the two border columns.
   */
  const tabWidth = title.length + 4;

  const tabTopRow = `┌${'─'.repeat(tabWidth - 2)}┐`;

  /**
   * Border segment that follows the label on the title row. It turns the
   * tab's right border into the panel's top border and ends at the panel's
   * top-right corner, so the label sits on the same row as the panel's top
   * border.
   */
  const tabTitleSuffix = ` └${'─'.repeat(MODAL_WIDTH - tabWidth - 1)}┐`;

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
      zIndex={10}
    >
      <box flexDirection="column" width={MODAL_WIDTH}>
        <text alignSelf="flex-start" wrapMode="none" fg={theme.border} bg={theme.bg}>
          {tabTopRow}
        </text>
        <text wrapMode="none" bg={theme.bg}>
          <span fg={theme.border}>│ </span>
          <span fg={theme.muted}>{title}</span>
          <span fg={theme.border}>{tabTitleSuffix}</span>
        </text>
        <box
          border={['left', 'right', 'bottom']}
          borderColor={theme.border}
          backgroundColor={theme.bg}
          flexDirection="column"
          paddingTop={1}
          paddingBottom={1}
        >
          {children}
        </box>
      </box>
    </box>
  );
}

/**
 * Full-width selectable row with the label on the left and the given value
 * content right-aligned. The selected row gets a warm background and an
 * accent bar that sits on the modal border itself, drawn one column left
 * of the row over the border character. Rows never clip children, so the
 * overlay renders outside the row's own bounds.
 */
export function ModalRow({ label, isSelected, children }: { label: string; isSelected: boolean; children: ReactNode }) {
  return (
    <box
      flexDirection="row"
      height={1}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={isSelected ? theme.selectedBg : undefined}
    >
      {isSelected ? (
        <text position="absolute" left={-1} wrapMode="none" fg={theme.accent} bg={theme.bg}>
          ┃
        </text>
      ) : null}
      <text wrapMode="none" fg={theme.text}>
        {label}
      </text>
      <box flexGrow={1} />
      {children}
    </box>
  );
}

/**
 * Focused text input that replaces the value slot of a row while it is
 * being edited. It reports every keystroke through onDraft and the enter
 * press through onSubmit, with the dialogs' commit handlers reading the
 * final draft.
 */
export function ModalInput({
  width,
  value,
  onDraft,
  onSubmit,
}: {
  width: number;
  value: string;
  onDraft: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <input
      width={width}
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
  );
}
