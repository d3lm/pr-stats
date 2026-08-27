import { useEffect, useRef, useState } from 'react';

export interface DeferredLoadingOptions {
  /**
   * Sets how many milliseconds a load must run before the indicator
   * shows. Loads that finish inside this window never show it, and a
   * zero delay shows it on the next tick. Defaults to 400.
   */
  showDelay?: number;

  /**
   * Keeps the indicator visible for at least this many milliseconds once
   * it has shown, even when the load finishes earlier, so it never
   * flashes on and straight off again. Defaults to 500.
   */
  minDuration?: number;
}

/**
 * Defers a loading indicator in both directions. The indicator appears
 * only after the load has run for showDelay, so fast loads never flash
 * it, and once visible it stays up for minDuration, so it never pops on
 * and straight off again. A load that restarts during that linger keeps
 * the indicator up without a gap.
 *
 * The hide side needs to know when the indicator appeared, so the show
 * timestamp lives in a ref that survives across effect runs. The effect
 * depends only on the loading flag, which keeps the timers untouched
 * while progress updates re-render the component, and every visibility
 * change flows through a timer callback, an immediate hide included, so
 * the effect never sets state synchronously.
 */
export function useDeferredLoading(
  isLoading: boolean,
  { showDelay = 300, minDuration = 500 }: DeferredLoadingOptions = {},
): boolean {
  const [visible, setVisible] = useState(isLoading && showDelay === 0);

  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => {
        shownAtRef.current = Date.now();
        setVisible(true);
      }, showDelay);

      return () => {
        clearTimeout(timer);
      };
    }

    const shownAt = shownAtRef.current;
    const remaining = shownAt === null ? 0 : Math.max(0, shownAt + minDuration - Date.now());

    const timer = setTimeout(() => {
      shownAtRef.current = null;
      setVisible(false);
    }, remaining);

    return () => {
      clearTimeout(timer);
    };
  }, [isLoading, showDelay, minDuration]);

  return visible;
}
