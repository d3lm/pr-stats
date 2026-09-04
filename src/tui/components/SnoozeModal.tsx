import type { SnoozeTarget } from '../state/ui';
import { theme } from '../theme';
import { ModalFrame, ModalInput, ModalRow } from './ModalFrame';

const HINT = 'how long to park the PR, like 30m, 2h, or 1d · enter snoozes · esc cancels';

/**
 * Small centered modal that asks how long to snooze the highlighted PR
 * of the awaiting-review queue. It names the PR, opens straight into the
 * duration input seeded with the default snooze, and the bottom line
 * carries the hint or the validation error of a rejected duration. The
 * App's commit handler reads the final draft on enter, and escape closes
 * the dialog through the shared edit-cancel path.
 */
export function SnoozeModal({
  target,
  snoozeDuration,
  error,
  onDraft,
  onSubmit,
}: {
  target: SnoozeTarget;
  /**
   * Holds the default snooze duration the input starts with.
   */
  snoozeDuration: string;
  error: string | null;
  onDraft: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <ModalFrame title="Snooze">
      <text wrapMode="word" height={2} marginLeft={2} marginRight={2} marginBottom={1}>
        <b fg={theme.accent}>{target.ref}</b>
        <span fg={theme.muted}> {target.title}</span>
      </text>
      <ModalRow label="Snooze for" isSelected>
        <ModalInput width={16} value={snoozeDuration} onDraft={onDraft} onSubmit={onSubmit} />
      </ModalRow>
      <text
        wrapMode="word"
        height={2}
        fg={error !== null ? theme.error : theme.muted}
        marginTop={1}
        marginLeft={2}
        marginRight={2}
      >
        {error ?? HINT}
      </text>
    </ModalFrame>
  );
}
