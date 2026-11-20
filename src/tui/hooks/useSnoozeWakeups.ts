import { useEffect, useEffectEvent } from 'react';
import { nextWakeUp, type Snooze } from '../../snooze';

// setTimeout overflows past a 32-bit signed delay, so longer snoozes re-arm until their time comes
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * The ready flag holds the timer back because the handler needs loaded data to tell which woken PRs
 * still await review.
 */
export function useSnoozeWakeups(snoozes: readonly Snooze[], ready: boolean, onWakeUp: () => void): void {
  const wake = useEffectEvent(() => {
    onWakeUp();
  });

  const next = nextWakeUp(snoozes);

  useEffect(() => {
    if (!ready || next === null) {
      return undefined;
    }

    let timer: ReturnType<typeof setTimeout>;

    const arm = () => {
      timer = setTimeout(
        () => {
          if (Date.now() < next) {
            arm();
            return;
          }

          wake();
        },
        Math.min(Math.max(0, next - Date.now()), MAX_TIMER_MS),
      );
    };

    arm();

    return () => {
      clearTimeout(timer);
    };
  }, [ready, next]);
}
