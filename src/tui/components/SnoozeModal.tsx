import type { SnoozeTarget } from '../state/ui';
import { theme } from '../theme';
import { ModalFrame, ModalInput, ModalRow } from './ModalFrame';

const HINT = 'how long to park the PR, like 30m, 2h, or 1d · enter snoozes · esc cancels';

export function SnoozeModal({
  target,
  snoozeDuration,
  error,
  onDraft,
  onSubmit,
}: {
  target: SnoozeTarget;
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
