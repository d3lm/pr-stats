import { useEffect, useEffectEvent } from 'react';

/**
 * The interval counts from the end of the last load, so a manual reload or a slow fetch does not
 * overlap the next tick.
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
