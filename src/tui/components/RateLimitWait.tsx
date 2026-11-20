import { useEffect, useState } from 'react';
import type { RateLimitWait } from '../data/load';
import { theme } from '../theme';
import { describeWait } from '../utils/wait';

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
