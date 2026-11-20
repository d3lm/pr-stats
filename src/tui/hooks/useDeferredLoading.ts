import { useEffect, useRef, useState } from 'react';

export interface DeferredLoadingOptions {
  showDelay?: number;
  minDuration?: number;
}

export function useDeferredLoading(
  isLoading: boolean,
  { showDelay = 300, minDuration = 500 }: DeferredLoadingOptions = {},
): boolean {
  const [shownAtMount] = useState(() => (isLoading && showDelay === 0 ? Date.now() : null));
  const [visible, setVisible] = useState(shownAtMount !== null);

  const shownAtRef = useRef<number | null>(shownAtMount);

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
