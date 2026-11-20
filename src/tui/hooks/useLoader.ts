import { useEffect, useRef, useState } from 'react';
import { RateLimitError } from '../../github';
import { CliError } from '../../utils';
import { loadData, loadSnapshot, type LoadPhase, type RawData } from '../data/load';
import { fetchParamsKey, type OptionsState } from '../state/options';

export interface Loader {
  raw: RawData | null;
  isSnapshot: boolean;
  loading: boolean;
  load: LoadPhase | null;
  error: string | null;
  rateLimited: boolean;
  stale: boolean;
  reload: (bypassCache?: boolean) => void;
}

export interface LoaderCallbacks {
  onSnapshot?: (data: RawData) => void;
  onLoaded?: (data: RawData) => void;
}

export interface LoaderSettings {
  noCache: boolean;
  mentions: boolean;
}

export function useLoader(
  options: OptionsState,
  { noCache, mentions }: LoaderSettings,
  callbacks: LoaderCallbacks = {},
): Loader {
  const { onSnapshot, onLoaded } = callbacks;

  const [startupSnapshot] = useState(() => (noCache ? null : loadSnapshot(options)));

  const [raw, setRaw] = useState<RawData | null>(startupSnapshot);

  const [appliedKey, setAppliedKey] = useState<string | null>(
    startupSnapshot === null ? null : fetchParamsKey(options),
  );

  const [isSnapshot, setIsSnapshot] = useState(startupSnapshot !== null);
  const [load, setLoad] = useState<LoadPhase | null>({ phase: 'search' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);

  // a ref guards against overlapping loads because a second keypress can land before the loading state commits
  const loadingRef = useRef(false);

  const disposedRef = useRef(false);

  const run = async (bypassCache: boolean) => {
    loadingRef.current = true;

    const publishPhase = (phase: LoadPhase) => {
      if (!disposedRef.current) {
        setLoad(phase);
      }
    };

    try {
      const data = await loadData(options, publishPhase, { bypassCache, mentions });

      if (disposedRef.current) {
        return;
      }

      setRaw(data);
      setIsSnapshot(false);
      setAppliedKey(fetchParamsKey(options));

      onLoaded?.(data);
    } catch (error) {
      if (!disposedRef.current) {
        setError(error instanceof CliError ? error.message : String(error));
        setRateLimited(error instanceof RateLimitError);
      }
    } finally {
      loadingRef.current = false;

      if (!disposedRef.current) {
        setLoading(false);
      }
    }
  };

  const reload = (bypassCache = false) => {
    if (loadingRef.current) {
      return;
    }

    setError(null);
    setRateLimited(false);
    setLoading(true);
    setLoad({ phase: 'search' });

    void run(bypassCache || noCache);
  };

  // the effect runs after every render, so only a real unmount leaves disposedRef set
  const startedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;

    if (!startedRef.current) {
      startedRef.current = true;

      if (startupSnapshot !== null) {
        onSnapshot?.(startupSnapshot);
      }

      void run(noCache);
    }

    return () => {
      disposedRef.current = true;
    };
  });

  return {
    raw,
    isSnapshot,
    loading,
    load,
    error,
    rateLimited,
    stale: raw !== null && appliedKey !== null && fetchParamsKey(options) !== appliedKey,
    reload,
  };
}
