import { useEffect, useState } from 'react';
import type { RateLimitWait } from '../data/load';
import { theme } from '../theme';
import { describeWait } from '../utils/wait';

/**
 * Renders the rate-limit wait of the running load with a countdown that
 * ticks once a second, so the pause reads as a wait with an end instead
 * of a stalled spinner. The interval lives in this component, so only
 * the countdown re-renders, and it only runs while a wait is on screen.
 */
export function RateLimitWaitStatus({ wait }: { wait: RateLimitWait }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <text wrapMode="none" fg={theme.warn}>
      {describeWait(wait, now)}
    </text>
  );
}
