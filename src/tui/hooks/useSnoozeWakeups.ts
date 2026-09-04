import { useEffect, useEffectEvent } from 'react';
import { nextWakeUp, type Snooze } from '../../snooze';

/**
 * Longest delay a timer takes, the largest 32-bit signed integer in
 * milliseconds, a bit under 25 days. A snooze that ends later re-arms the
 * timer once it fires.
 */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Fires the wake-up handler when the snooze that ends next reaches its
 * wake-up time. The timer arms itself on that time and re-arms whenever
 * it changes, which happens when a snooze gets added, ended, or wakes up.
 * A wake-up time that already passed, like a snooze that ended while the
 * TUI was closed, fires right away. The ready flag holds the timer back
 * until data is on screen, because the handler needs the data to tell
 * which woken PRs still await a review.
 *
 * The handler runs through an effect event, so a wake-up calls the
 * handler of the latest committed render and reads the current snoozes,
 * data, and notification setting, the same way a reload tick does.
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
          // a wake-up past the timer's reach arms again until its time comes
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
