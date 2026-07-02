import { useEffect, useRef, useState } from "react";

/**
 * Runs an async loader when `deps` change. Aborts in-flight work on cleanup or re-run
 * so rapid tab/page switches do not leave boards stuck loading or apply stale results.
 */
export function useAbortableLoad(
  deps: readonly unknown[],
  load: (signal: AbortSignal) => Promise<void>
): { loading: boolean; error: string | null; setError: (msg: string | null) => void; reload: () => void } {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        await loadRef.current(ac.signal);
      } catch (e) {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Failed");
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls deps intentionally
  }, [...deps, tick]);

  return {
    loading,
    error,
    setError,
    reload: () => setTick((n) => n + 1),
  };
}
