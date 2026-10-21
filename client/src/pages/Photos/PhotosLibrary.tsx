import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ListChecks, Play, Plus } from "lucide-react";
import type { LibraryInfo } from "@shared/api.ts";
import type { PhotoAlbumSort, PhotosOverview } from "@shared/photos.ts";
import PhotosApi from "../../Api/PhotosApi.ts";
import { router } from "../../lib/Router.tsx";
import useController from "../../lib/useController.ts";
import { toasts } from "../../lib/Toasts.ts";
import { addToPhotoAlbum } from "../../components/AddToPhotoAlbum/AddToPhotoAlbum.tsx";
import PhotoAlbumCard from "../../components/PhotoAlbumCard/PhotoAlbumCard.tsx";
import PhotoGrid from "../../components/PhotoGrid/PhotoGrid.tsx";
import PhotoViewer from "../../components/PhotoViewer/PhotoViewer.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Select from "../../components/Select/Select.tsx";
import Button from "../../components/Button/Button.tsx";
import Dialog from "../../components/Dialog/Dialog.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import usePhotoList from "./usePhotoList.ts";
import usePhotoViewer from "./usePhotoViewer.ts";
import SelectionBar, { useSelection } from "./SelectionBar.tsx";
import "../Library/Library.scss";
import "../../components/AddToPlaylist/AddToPlaylist.scss";
import "./Photos.scss";

type View = "albums" | "timeline";

const SORTS: { value: PhotoAlbumSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "title", label: "Name" },
];

export interface PhotosLibraryProps {
  library: LibraryInfo;
}

/**
 * A Photos library: its albums (folders and hand-made ones) with the photos outside every folder below them, or
 * everything by date on the Timeline.
 */
export default function PhotosLibrary(props: PhotosLibraryProps) {
  const { library } = props;
  const { query } = useController(router);
  const view: View = query.get("view") === "timeline" ? "timeline" : "albums";
  const [sort, setSort] = useState<PhotoAlbumSort>("newest");
  const [overview, setOverview] = useState<PhotosOverview | null>(null);
  const [creating, setCreating] = useState(false);
  const { changes } = useController(addToPhotoAlbum);
  const selection = useSelection();

  const scope = view === "albums" ? "loose" : "all";
  const load = useCallback((offset: number) => PhotosApi.libraryItems(library.id, scope, offset), [library.id, scope]);
  const list = usePhotoList(load);
  // A slideshow from the albums view shows the whole library, shuffled; the timeline plays in its own order
  const loadEverything = useCallback(async () => view === "timeline" ? await list.loadAll() : await PhotosApi.everything((offset) => PhotosApi.libraryItems(library.id, "all", offset)), [view, list.loadAll, library.id]);
  const viewer = usePhotoViewer(list.items, list.total, loadEverything);

  useEffect(() => {
    PhotosApi.overview(library.id, sort).then(setOverview).catch((error) => toasts.error("Couldn't load the albums", (error as Error).message));
  }, [library.id, sort, changes, !!library.scan]);

  function setView(next: View) {
    selection.stop();
    router.navigate(next === "timeline" ? `/library/${library.id}?view=timeline` : `/library/${library.id}`, { replace: true, keepScroll: true });
  }

  const counts = overview ? photoCounts(overview.photoCount, overview.videoCount) : null;
  const albumCount = overview?.albums.length ?? 0;
  const empty = overview && overview.photoCount + overview.videoCount === 0;

  return (
    <div className="cn-library cn-photos">
      <header className="cn-library__header">
        <div>
          <h1>{library.name}</h1>
          <p>{[counts, albumCount ? `${albumCount} ${albumCount === 1 ? "album" : "albums"}` : null].filter(Boolean).join(" · ")}{library.scan && " · Scanning…"}</p>
        </div>
        <div className="cn-library__filters">
          <SegmentedControl<View> label="Show" value={view} onChange={setView} options={[{ value: "albums", label: "Albums" }, { value: "timeline", label: "Timeline" }]} />
          {view === "albums" && <Select label="Sort albums" value={sort} options={SORTS} onChange={(e) => setSort(e.target.value as PhotoAlbumSort)} className="cn-library__select" />}
          {view === "albums" && <Button icon={<Plus />} onClick={() => setCreating(true)}>New album</Button>}
          {!empty && <Button icon={<ListChecks />} onClick={selection.selected ? selection.stop : selection.start} aria-pressed={!!selection.selected}>Select</Button>}
          {!empty && <Button variant="primary" icon={<Play />} onClick={() => viewer.slideshow(view !== "timeline")}>Slideshow</Button>}
        </div>
      </header>

      {!overview && <div className="cn-library__loading"><Spinner size="2rem" /></div>}

      {empty && (
        <section className="cn-library__empty">
          <h2>Nothing in here yet</h2>
          <p>
            {library.scan
              ? "Cinemion is scanning this library right now. Photos appear as they're found."
              : `Photos and videos from ${library.paths.join(", ")} appear here after a scan. Every folder becomes an album, and dates come from the photos themselves.`}
          </p>
        </section>
      )}

      {view === "albums" && overview && overview.albums.length > 0 && (
        <div className="cn-library__grid cn-library__grid--wide">
          {overview.albums.map((album) => <PhotoAlbumCard key={`${album.kind}-${album.id}`} album={album} />)}
        </div>
      )}

      {view === "albums" && overview && overview.looseCount > 0 && (
        <section className="cn-photos__section" aria-labelledby="cn-photos-loose">
          <h2 id="cn-photos-loose">{overview.albums.length ? "Photos outside albums" : "Photos"}</h2>
          {list.items && <PhotoGrid items={list.items} onOpen={viewer.open} selected={selection.selected} onToggle={selection.toggle} />}
        </section>
      )}

      {view === "timeline" && list.items && <PhotoGrid items={list.items} groupBy="month" onOpen={viewer.open} selected={selection.selected} onToggle={selection.toggle} />}

      <div ref={list.sentinel} />
      {list.loading && <div className="cn-library__loading"><Spinner size="2rem" /></div>}

      {selection.selected && <SelectionBar libraryId={library.id} selected={selection.selected} onDone={selection.stop} />}

      {viewer.isOpen && (
        <PhotoViewer
          items={viewer.list}
          index={viewer.index}
          total={viewer.total}
          contextTitle={library.name}
          startPlaying={viewer.startPlaying}
          onIndexChange={viewer.open}
          onClose={viewer.close}
          onNeedMore={list.loadMore}
        />
      )}

      <NewAlbumDialog libraryId={library.id} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

/**
 * "2,034 photos · 94 videos".
 */
export function photoCounts(photos: number, videos: number) {
  return [
    `${photos.toLocaleString()} ${photos === 1 ? "photo" : "photos"}`,
    videos ? `${videos.toLocaleString()} ${videos === 1 ? "video" : "videos"}` : null,
  ].filter(Boolean).join(" · ");
}

/**
 * Name a new, empty album and go to it. Photos are added from anywhere with "Select" or the viewer's menu.
 */
function NewAlbumDialog(props: { libraryId: number; open: boolean; onClose: () => void }) {
  const { libraryId, open, onClose } = props;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const album = await PhotosApi.createAlbum({ libraryId, title: name });
      addToPhotoAlbum.changed();
      onClose();
      router.navigate(`/photos/album/${album.id}`);
    } catch (error) {
      toasts.error("Couldn't make the album", (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !value && onClose()}
      title="New album"
      description="Albums collect photos from anywhere in this library. The files stay where they are."
      size="sm"
    >
      <form className="cn-add-playlist__new" onSubmit={create}>
        <TextField label="Name" placeholder="Best of the summer" value={name} maxLength={128} onChange={(e) => setName(e.target.value)} autoFocus />
        <Button type="submit" variant="primary" disabled={!name.trim()} loading={busy}>Create</Button>
      </form>
    </Dialog>
  );
}
