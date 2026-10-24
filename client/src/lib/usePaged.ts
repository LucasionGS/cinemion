import { useCallback, useEffect, useRef, useState } from "react";
import { toasts } from "./Toasts.ts";
import { t } from "../i18n/I18n.ts";

/**
 * A list loaded a page at a time, with the next page coming when `sentinel` scrolls into view.
 * `load` must be memoised; a new one starts the list over.
 */
export default function usePaged<T>(load: (offset: number) => Promise<{ items: T[]; total: number }>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const state = useRef({ loading: false, done: false, generation: 0, count: 0 });
  const sentinel = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    const s = state.current;
    if (s.loading || s.done) return;
    s.loading = true;
    setLoading(true);
    const generation = s.generation;
    try {
      const page = await load(s.count);
      if (generation !== state.current.generation) return;
      s.count += page.items.length;
      s.done = page.items.length === 0 || s.count >= page.total;
      setTotal(page.total);
      setItems((previous) => [...(previous ?? []), ...page.items]);
    } catch (error) {
      s.done = true;
      toasts.error(t("app.errors.loadList"), (error as Error).message);
    } finally {
      if (generation === state.current.generation) {
        s.loading = false;
        setLoading(false);
      }
    }
  }, [load]);

  // A new `load` (other sort or filter) starts over
  useEffect(() => {
    state.current = { loading: false, done: false, generation: state.current.generation + 1, count: 0 };
    setItems(null);
    setTotal(null);
    loadMore();
  }, [loadMore]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: "800px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  return { items, total, loading, sentinel };
}
