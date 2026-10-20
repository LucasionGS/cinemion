import { useCallback, useEffect, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { EllipsisVertical, RefreshCw, Wand2 } from "lucide-react";
import type { LibraryInfo } from "@shared/api.ts";
import type { ItemSummary, SortOrder } from "@shared/media.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { session } from "../../Session.ts";
import { toasts } from "../../lib/Toasts.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import PosterCard from "../../components/PosterCard/PosterCard.tsx";
import FixMatchDialog from "../../components/FixMatchDialog/FixMatchDialog.tsx";
import Select from "../../components/Select/Select.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import "./Library.scss";

const PAGE_SIZE = 60;

const SORTS: { value: SortOrder; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "added", label: "Recently added" },
  { value: "year", label: "Release year" },
  { value: "rating", label: "Rating" },
];

export interface LibraryProps {
  id: number;
}

/**
 * All movies or shows in one library, as a poster grid.
 */
export default function Library(props: LibraryProps) {
  const { id } = props;
  const libraries = LibrariesApi.useLibraries();
  const library = libraries?.find((l) => l.id === id);
  const [sort, setSort] = useState<SortOrder>("title");
  const { items, total, loadMore, loading, replace } = useLibraryItems(id, sort);
  const [fixing, setFixing] = useState<ItemSummary | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const canManage = session.can("LIBRARY_MANAGE");

  // Load the next page when the end of the grid comes into view
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: "800px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  async function refresh(item: ItemSummary) {
    const id = toasts.show({ title: `Refreshing ${item.title}…` });
    try {
      replace(await ItemsApi.refresh(item.id));
      toasts.dismiss(id);
      toasts.success(`${item.title} is up to date`);
    } catch (error) {
      toasts.dismiss(id);
      toasts.error("Couldn't refresh", (error as Error).message);
    }
  }

  return (
    <AppShell>
      <div className="cn-library">
        {libraries && !library && (
          <section className="cn-library__empty">
            <h2>Library not found</h2>
            <p>It may have been removed, or your profile doesn't have access to it.</p>
          </section>
        )}

        {library && (
          <>
            <header className="cn-library__header">
              <div>
                <h1>{library.name}</h1>
                <p>{countLabel(library, total)}{library.scan && " · Scanning…"}</p>
              </div>
              <Select label="Sort by" value={sort} options={SORTS} onChange={(e) => setSort(e.target.value as SortOrder)} className="cn-library__sort" />
            </header>

            {items && items.length === 0 && !loading && (
              <section className="cn-library__empty">
                <h2>Nothing in here yet</h2>
                <p>{library.scan ? "Cinemion is scanning this library right now. Titles appear as they're found." : `${library.type === "shows" ? "Shows" : "Movies"} from ${library.paths.join(", ")} appear here after a scan.`}</p>
              </section>
            )}

            <div className="cn-library__grid">
              {items?.map((item) => (
                <PosterCard
                  key={item.id}
                  item={item}
                  badge={canManage && item.matchStatus === "unmatched" ? "Unmatched" : undefined}
                  actions={canManage && <ItemMenu item={item} onFix={() => setFixing(item)} onRefresh={() => refresh(item)} />}
                />
              ))}
            </div>
            <div ref={sentinel} />
            {loading && <div className="cn-library__loading"><Spinner size="2rem" /></div>}
          </>
        )}
        {!libraries && <div className="cn-library__loading"><Spinner size="2rem" /></div>}
      </div>
      <FixMatchDialog item={fixing} onClose={() => setFixing(null)} onMatched={replace} />
    </AppShell>
  );
}

function countLabel(library: LibraryInfo, total: number | null) {
  const count = total ?? library.itemCount;
  if (library.type === "shows") return `${count} ${count === 1 ? "show" : "shows"}`;
  return `${count} ${count === 1 ? "movie" : "movies"}`;
}

function ItemMenu(props: { item: ItemSummary; onFix: () => void; onRefresh: () => void }) {
  const { item, onFix, onRefresh } = props;
  return (
    <Menu.Root>
      <Menu.Trigger className="cn-library__menu-button" aria-label={`More for ${item.title}`}><EllipsisVertical /></Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="cn-menu__positioner">
          <Menu.Popup className="cn-menu">
            <Menu.Item className="cn-menu__item" onClick={onFix}><Wand2 /> Fix match</Menu.Item>
            <Menu.Item className="cn-menu__item" onClick={onRefresh}><RefreshCw /> Refresh details</Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * The library's titles, loaded a page at a time. `replace()` swaps in an updated item.
 */
function useLibraryItems(libraryId: number, sort: SortOrder) {
  const [items, setItems] = useState<ItemSummary[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const state = useRef({ loading: false, done: false, generation: 0 });

  useEffect(() => {
    state.current = { loading: false, done: false, generation: state.current.generation + 1 };
    setItems(null);
    setTotal(null);
  }, [libraryId, sort]);

  const loadMore = useCallback(async () => {
    const s = state.current;
    if (s.loading || s.done) return;
    s.loading = true;
    setLoading(true);
    const generation = s.generation;
    try {
      const offset = items?.length ?? 0;
      const page = await ItemsApi.list(libraryId, { sort, offset, limit: PAGE_SIZE });
      // Ignore pages for a sort or library that's no longer shown
      if (generation !== state.current.generation) return;
      setItems((current) => [...(current ?? []), ...page.items]);
      setTotal(page.total);
      s.done = offset + page.items.length >= page.total;
    } catch (error) {
      toasts.error("Couldn't load this library", (error as Error).message);
      s.done = true;
    } finally {
      s.loading = false;
      setLoading(false);
    }
  }, [libraryId, sort, items]);

  // First page
  useEffect(() => {
    if (items === null) loadMore();
  }, [items, loadMore]);

  const replace = useCallback((updated: ItemSummary) => {
    setItems((current) => current?.map((i) => i.id === updated.id ? { ...i, ...updated } : i) ?? current);
  }, []);

  return { items, total, loading, loadMore, replace };
}
