import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Load data now and again every `intervalMs` while the page is visible. `intervalMs` of `null` loads once.
 * Errors keep the last good data; `error` holds the latest message until a load works again.
 */
export function usePoll<T>(load: () => Promise<T>, intervalMs: number | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    reload();
    if (intervalMs === null) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, intervalMs);
    // Catch up right away when coming back to the tab
    const onVisible = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, reload]);

  return { data, error, reload, setData };
}

export default usePoll;
