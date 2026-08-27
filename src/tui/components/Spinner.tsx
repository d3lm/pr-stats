import { useEffect, useState } from 'react';
import { theme } from '../theme';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const SPINNER_INTERVAL_MS = 80;

/**
 * Renders the animated spinner that stands in for the textual load status
 * in the header. The frame ticks on a local interval, so only this
 * component re-renders, and it only mounts while the deferred load
 * indicator is visible, so the interval never runs while idle.
 */
export function Spinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((previous) => (previous + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <text wrapMode="none" fg={theme.accent}>
      {SPINNER_FRAMES[frame]}
    </text>
  );
}
