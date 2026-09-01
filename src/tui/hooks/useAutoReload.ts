import { useEffect, useEffectEvent } from 'react';

/**
 * Reloads the data in the background on a fixed cadence while the
 * auto-reload setting is on. The timer counts from the end of the last
 * load, whether a keypress or the timer itself started that load, so a
 * manual reload never stacks a second fetch right behind it and a slow
 * fetch never overlaps the next tick. A null interval, which an off or
 * an invalid setting yields, schedules nothing, and changing the interval
 * restarts the countdown with the new length.
 *
 * The reload runs through an effect event, so a tick calls the reload of
 * the latest committed render and fetches for the current options, the
 * same way a keypress does through useKeyboard.
 */
export function useAutoReload(intervalMs: number | null, loading: boolean, reload: () => void): void {
  const tick = useEffectEvent(() => {
    reload();
  });

  useEffect(() => {
    if (intervalMs === null || loading) {
      return undefined;
    }

    const timer = setTimeout(() => {
      tick();
    }, intervalMs);

    return () => {
      clearTimeout(timer);
    };
  }, [intervalMs, loading]);
}
