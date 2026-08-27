import { useEffect, useRef, useState } from 'react';
import { CliError } from '../../utils';
import { loadData, loadSnapshot, type LoadPhase, type RawData } from '../data/load';
import { fetchParamsKey, type OptionsState } from '../state/options';

export interface Loader {
  /**
   * Holds the loaded data, or null until the first load or the startup
   * snapshot delivers some.
   */
  raw: RawData | null;
  /**
   * Marks the shown data as the startup snapshot from the previous
   * session. The flag drops once fresh data replaces it.
   */
  isSnapshot: boolean;
  loading: boolean;
  /**
   * Holds the progress of the running load for the placeholder and the
   * header spinner.
   */
  load: LoadPhase | null;
  error: string | null;
  /**
   * Reports that the live options differ from the ones the shown data was
   * loaded for, so the footer can ask for a reload.
   */
  stale: boolean;
  /**
   * Reloads the data. A plain reload serves closed PRs from the on-disk
   * cache, and a hard reload bypasses it, refetching everything and
   * rewriting the cached entries. While the disable-cache setting is on,
   * every reload bypasses the cache.
   */
  reload: (bypassCache?: boolean) => void;
}

/**
 * Owns the data-loading lifecycle. The lazy snapshot initializer runs
 * once on mount, so the disk read happens exactly once and the charts
 * render instantly from the previous session while the first real load
 * runs in the background. While noCache is set, from the --no-cache flag,
 * the saved setting, or the settings dialog toggle, every load bypasses
 * the cache, and a noCache start also skips the snapshot like every
 * other cache read. Reload reads the options from the render it was
 * created in, which useKeyboard keeps current, so a reload always
 * fetches for the latest committed options. The onLoaded callback fires
 * with every freshly loaded dataset, right after it became the shown
 * data, and never for the startup snapshot.
 */
export function useLoader(options: OptionsState, noCache: boolean, onLoaded?: (data: RawData) => void): Loader {
  const [startupSnapshot] = useState(() => (noCache ? null : loadSnapshot(options)));

  const [raw, setRaw] = useState<RawData | null>(startupSnapshot);

  const [appliedKey, setAppliedKey] = useState<string | null>(
    startupSnapshot === null ? null : fetchParamsKey(options),
  );

  const [isSnapshot, setIsSnapshot] = useState(startupSnapshot !== null);
  const [load, setLoad] = useState<LoadPhase | null>({ phase: 'search' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Guards against overlapping loads through a ref, because a second
   * keypress can land before the loading state commits.
   */
  const loadingRef = useRef(false);

  /**
   * Marks the hook as disposed once its component unmounts, through the
   * mount effect cleanup. A load that resolves later checks the flag and
   * publishes nothing, so no state write can land in an unmounted
   * component.
   */
  const disposedRef = useRef(false);

  /**
   * Runs one load and publishes its outcome. Every state update in here
   * lands after an await, so the mount effect can start a load without
   * ever setting state synchronously inside an effect, and every one is
   * gated on the disposed flag.
   */
  const run = async (bypassCache: boolean) => {
    loadingRef.current = true;

    const publishPhase = (phase: LoadPhase) => {
      if (!disposedRef.current) {
        setLoad(phase);
      }
    };

    try {
      const data = await loadData(options, publishPhase, { bypassCache });

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
    setLoading(true);
    setLoad({ phase: 'search' });

    void run(bypassCache || noCache);
  };

  /**
   * The first load starts on mount, behind the startup snapshot when one
   * rendered. The initial state already describes a running load, so this
   * skips the resets a reload does and only starts the fetch, with the
   * mount-render closure carrying exactly the initial options the first
   * load must fetch for. The ref guard keeps later renders of this
   * dependency-free effect from starting the load again.
   *
   * The cleanup marks the hook disposed, which keeps a load that resolves
   * after unmount from writing state. On re-renders the cleanup and the
   * next effect body run back to back in the same synchronous flush, so
   * the body resets the flag before any in-flight load can observe it and
   * only a real unmount leaves it set.
   */
  const startedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;

    if (!startedRef.current) {
      startedRef.current = true;

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
    stale: raw !== null && appliedKey !== null && fetchParamsKey(options) !== appliedKey,
    reload,
  };
}
