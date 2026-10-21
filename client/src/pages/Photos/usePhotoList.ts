import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoPage, PhotoSummary } from "@shared/photos.ts";
import { toasts } from "../../lib/Toasts.ts";

/**
 * Photos loaded a page at a time as `sentinel` scrolls into view, with `loadAll()` for slideshows and selecting
 * everything. `load` must be memoised; a new one starts the list over, and so does `reload()`.
 */
export default function usePhotoList(load: ((offset: number) => Promise<PhotoPage>) | null) {
  const [items, setItems] = useState<PhotoSummary[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const state = useRef({ generation: 0, items: [] as PhotoSummary[], total: null as number | null, pending: null as Promise<void> | null });
  const sentinel = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(() => {
    const s = state.current;
    if (!load || s.pending || (s.total !== null && s.items.length >= s.total)) return s.pending ?? Promise.resolve();
    const generation = s.generation;
    setLoading(true);
    s.pending = load(s.items.length).then((page) => {
      if (generation !== state.current.generation) return;
      s.items = [...s.items, ...page.items];
      // An empty page means the list shrank while loading; stop here
      s.total = page.items.length === 0 ? s.items.length : page.total;
      setItems(s.items);
      setTotal(s.total);
    }).catch((error) => {
      if (generation !== state.current.generation) return;
      s.total = s.items.length;
      toasts.error("Couldn't load the photos", (error as Error).message);
    }).finally(() => {
      if (generation !== state.current.generation) return;
      s.pending = null;
      setLoading(false);
    });
    return s.pending;
  }, [load]);

  /**
   * Load every page, and return the whole list.
   */
  const loadAll = useCallback(async () => {
    const s = state.current;
    while (s.total === null || s.items.length < s.total) {
      const before = s.items.length;
      await loadMore();
      if (s.items.length === before && s.total !== null) break;
    }
    return s.items;
  }, [loadMore]);

  useEffect(() => {
    state.current = { generation: state.current.generation + 1, items: [], total: null, pending: null };
    setItems(null);
    setTotal(null);
    setLoading(false);
    loadMore();
  }, [loadMore, version]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: "1200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, items === null]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { items, total, loading, sentinel, loadMore, loadAll, reload };
}
