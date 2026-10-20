import { useCallback, useEffect, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { EllipsisVertical, RefreshCw, Wand2 } from "lucide-react";
import type { LibraryInfo } from "@shared/api.ts";
import type { CollectionSummary, ItemSummary, SortOrder } from "@shared/media.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { session } from "../../Session.ts";
import { router } from "../../lib/Router.tsx";
import useController from "../../lib/useController.ts";
import { toasts } from "../../lib/Toasts.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import PosterCard from "../../components/PosterCard/PosterCard.tsx";
import WideCard from "../../components/WideCard/WideCard.tsx";
import FixMatchDialog from "../../components/FixMatchDialog/FixMatchDialog.tsx";
import Select from "../../components/Select/Select.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import MusicLibrary from "../Music/MusicLibrary.tsx";
import "./Library.scss";

const PAGE_SIZE = 60;

const SORTS: { value: SortOrder; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "added", label: "Recently added" },
  { value: "year", label: "Release year" },
  { value: "rating", label: "Rating" },
];

// Videos have a recording date instead of a release year, and no ratings
const VIDEO_SORTS: { value: SortOrder; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "added", label: "Recently added" },
  { value: "year", label: "Date" },
];

export interface LibraryProps {
  id: number;
}

/**
 * One library. Music libraries have their own page; the others are a grid of titles.
 */
export default function Library(props: LibraryProps) {
  const { id } = props;
  const libraries = LibrariesApi.useLibraries();
  const library = libraries?.find((l) => l.id === id);
  if (!libraries) return <AppShell><div className="cn-library__loading"><Spinner size="2rem" /></div></AppShell>;
  if (library?.type === "music") return <AppShell><MusicLibrary library={library} /></AppShell>;
  return <TitleLibrary id={id} libraries={libraries} />;
}

/**
 * All movies or shows in one library, as a poster grid. Videos libraries show their folders and videos as 16:9 cards.
 */
function TitleLibrary(props: LibraryProps & { libraries: LibraryInfo[] }) {
  const { id, libraries } = props;
  const library = libraries.find((l) => l.id === id);
  const { query } = useController(router);
  const initialSort = SORTS.some((s) => s.value === query.get("sort")) ? query.get("sort") as SortOrder : "title";
  const [sort, setSort] = useState<SortOrder>(initialSort);
  const [genre, setGenre] = useState<string | null>(null);
  const [show, setShow] = useState<"all" | "unwatched" | "collections">("all");
  const genres = useGenres(id);
  const collections = useCollections(id, library?.type === "movies");
  const { items, total, loadMore, loading, replace } = useLibraryItems(id, sort, genre, show === "unwatched");
  const [fixing, setFixing] = useState<ItemSummary | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const canManage = session.can("LIBRARY_MANAGE");
  const isVideos = library?.type === "videos";
  const sorts = isVideos ? VIDEO_SORTS : SORTS;

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
        {!library && (
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
              <div className="cn-library__filters">
                <SegmentedControl<"all" | "unwatched" | "collections">
                  label="Show"
                  value={show}
                  onChange={setShow}
                  options={[
                    { value: "all", label: "All" },
                    { value: "unwatched", label: "Unwatched" },
                    ...(collections && collections.length > 0 ? [{ value: "collections" as const, label: "Collections" }] : []),
                  ]}
                />
                {show !== "collections" && genres && genres.length > 0 && (
                  <Select
                    label={isVideos ? "Tag" : "Genre"}
                    value={genre ?? ""}
                    options={[{ value: "", label: isVideos ? "All tags" : "All genres" }, ...genres.map((g) => ({ value: g, label: g }))]}
                    onChange={(e) => setGenre(e.target.value || null)}
                    className="cn-library__select"
                  />
                )}
                {show !== "collections" && <Select label="Sort by" value={sorts.some((s) => s.value === sort) ? sort : "title"} options={sorts} onChange={(e) => setSort(e.target.value as SortOrder)} className="cn-library__select" />}
              </div>
            </header>

            {show === "collections" && (
              <div className="cn-library__grid">
                {collections?.map((c) => <PosterCard key={c.id} item={{ ...c, type: "collection" }} />)}
              </div>
            )}

            {show !== "collections" && items && items.length === 0 && !loading && (genre || show === "unwatched") && (
              <section className="cn-library__empty">
                <h2>No matches</h2>
                <p>{show === "unwatched" ? "You've seen everything here" : isVideos ? "Nothing with this tag" : "Nothing in this genre"}{genre && show === "unwatched" ? (isVideos ? " with this tag" : " in this genre") : ""}.</p>
              </section>
            )}

            {show !== "collections" && items && items.length === 0 && !loading && !genre && show !== "unwatched" && (
              <section className="cn-library__empty">
                <h2>Nothing in here yet</h2>
                <p>{library.scan ? "Cinemion is scanning this library right now. Titles appear as they're found." : `${{ movies: "Movies", shows: "Shows", videos: "Videos", music: "Music" }[library.type]} from ${library.paths.join(", ")} appear here after a scan.`}</p>
              </section>
            )}

            {show !== "collections" && isVideos && (
              <div className="cn-library__grid cn-library__grid--wide">
                {items?.map((item) => <WideCard key={item.id} item={item} variant="video" />)}
              </div>
            )}

            {show !== "collections" && !isVideos && <div className="cn-library__grid">
              {items?.map((item) => (
                <PosterCard
                  key={item.id}
                  item={item}
                  badge={canManage && item.matchStatus === "unmatched" ? "Unmatched" : undefined}
                  actions={canManage && <ItemMenu item={item} onFix={() => setFixing(item)} onRefresh={() => refresh(item)} />}
                />
              ))}
            </div>}
            <div ref={sentinel} />
            {loading && <div className="cn-library__loading"><Spinner size="2rem" /></div>}
          </>
        )}
      </div>
      <FixMatchDialog item={fixing} onClose={() => setFixing(null)} onMatched={replace} />
    </AppShell>
  );
}

function countLabel(library: LibraryInfo, total: number | null) {
  // A Videos library lists folders too; its count is always its videos
  const count = library.type === "videos" ? library.itemCount : total ?? library.itemCount;
  if (library.type === "videos") return `${count} ${count === 1 ? "video" : "videos"}`;
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
function useGenres(libraryId: number) {
  const [genres, setGenres] = useState<string[] | null>(null);
  useEffect(() => {
    ItemsApi.genres(libraryId).then(setGenres).catch(() => setGenres([]));
  }, [libraryId]);
  return genres;
}

function useCollections(libraryId: number, enabled: boolean) {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  useEffect(() => {
    if (enabled) ItemsApi.collections(libraryId).then(setCollections).catch(() => setCollections([]));
  }, [libraryId, enabled]);
  return collections;
}

function useLibraryItems(libraryId: number, sort: SortOrder, genre: string | null, unwatched: boolean) {
  const [items, setItems] = useState<ItemSummary[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const state = useRef({ loading: false, done: false, generation: 0 });

  useEffect(() => {
    state.current = { loading: false, done: false, generation: state.current.generation + 1 };
    setItems(null);
    setTotal(null);
  }, [libraryId, sort, genre, unwatched]);

  const loadMore = useCallback(async () => {
    const s = state.current;
    if (s.loading || s.done) return;
    s.loading = true;
    setLoading(true);
    const generation = s.generation;
    try {
      const offset = items?.length ?? 0;
      const page = await ItemsApi.list(libraryId, { sort, offset, limit: PAGE_SIZE, genre, unwatched });
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
  }, [libraryId, sort, genre, unwatched, items]);

  // First page
  useEffect(() => {
    if (items === null) loadMore();
  }, [items, loadMore]);

  const replace = useCallback((updated: ItemSummary) => {
    setItems((current) => current?.map((i) => i.id === updated.id ? { ...i, ...updated } : i) ?? current);
  }, []);

  return { items, total, loading, loadMore, replace };
}
