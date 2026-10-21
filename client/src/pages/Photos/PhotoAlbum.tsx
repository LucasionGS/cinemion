import { useCallback, useEffect, useId, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Ellipsis, ImageMinus, Images, ListChecks, Pencil, Play, RotateCcw, Shuffle, Trash2 } from "lucide-react";
import type { PhotoAlbumDetail, PhotoAlbumKind } from "@shared/photos.ts";
import PhotosApi from "../../Api/PhotosApi.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import { Link, router } from "../../lib/Router.tsx";
import { applyAmbient } from "../../lib/ambient.ts";
import useController from "../../lib/useController.ts";
import { toasts } from "../../lib/Toasts.ts";
import { formatDateRange } from "../../lib/format.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import { addToPhotoAlbum } from "../../components/AddToPhotoAlbum/AddToPhotoAlbum.tsx";
import PhotoAlbumCard, { albumCounts } from "../../components/PhotoAlbumCard/PhotoAlbumCard.tsx";
import PhotoGrid from "../../components/PhotoGrid/PhotoGrid.tsx";
import PhotoViewer from "../../components/PhotoViewer/PhotoViewer.tsx";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import Dialog, { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import usePhotoList from "./usePhotoList.ts";
import usePhotoViewer from "./usePhotoViewer.ts";
import SelectionBar, { useSelection } from "./SelectionBar.tsx";
import "../Library/Library.scss";
import "../../components/TextField/TextField.scss";
import "./Photos.scss";

export interface PhotoAlbumProps {
  kind: PhotoAlbumKind;
  id: number;
}

/**
 * `/photos/folder/<id>` and `/photos/album/<id>`: a folder of a Photos library, with the folders inside it, or an
 * album someone made. Photos are grouped by day, oldest first.
 */
export default function PhotoAlbum(props: PhotoAlbumProps) {
  const { kind, id } = props;
  const [detail, setDetail] = useState<PhotoAlbumDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { changes } = useController(addToPhotoAlbum);
  const libraries = LibrariesApi.useLibraries();
  const library = libraries?.find((l) => l.id === detail?.libraryId);
  const selection = useSelection();

  const load = useCallback((offset: number) => kind === "folder" ? PhotosApi.folderItems(id, offset) : PhotosApi.albumItems(id, offset), [kind, id]);
  const list = usePhotoList(load);
  // Slideshows of a folder take in its subfolders too
  const hasSubfolders = !!detail?.albums.length;
  const loadEverything = useCallback(() => hasSubfolders ? PhotosApi.everything((offset) => PhotosApi.folderItems(id, offset, true)) : list.loadAll(), [hasSubfolders, id, list.loadAll]);
  const viewer = usePhotoViewer(list.items, list.total, loadEverything);
  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
    list.reload();
  }, [list.reload]);

  useEffect(() => {
    (kind === "folder" ? PhotosApi.folder(id) : PhotosApi.album(id)).then(setDetail).catch((e: Error) => setError(e.message));
  }, [kind, id, version]);

  // Photos added to a hand-made album from elsewhere (the viewer's menu) show up here
  useEffect(() => {
    if (kind === "album" && changes) refresh();
  }, [changes]);

  // The page takes the cover's colours
  useEffect(() => {
    applyAmbient(detail?.palette ?? null);
    return () => applyAmbient(null);
  }, [detail?.palette?.accent]);

  const canEdit = !!detail?.canEdit;
  const contextTitle = detail?.title ?? "";

  async function takeOut() {
    if (!selection.selected?.size) return;
    try {
      await PhotosApi.removeFromAlbum(id, [...selection.selected]);
      toasts.success(`Took ${selection.selected.size === 1 ? "1 photo" : `${selection.selected.size} photos`} out of the album`, "The files themselves are still where they were.");
      selection.stop();
      refresh();
    } catch (e) {
      toasts.error("Couldn't take them out", (e as Error).message);
    }
  }

  async function useAsCover() {
    const [photoId] = [...selection.selected ?? []];
    if (photoId === undefined) return;
    try {
      if (kind === "folder") await PhotosApi.setFolderCover(id, photoId);
      else await PhotosApi.updateAlbum(id, { coverItemId: photoId });
      toasts.success("Album cover changed");
      selection.stop();
      setVersion((v) => v + 1);
    } catch (e) {
      toasts.error("Couldn't change the cover", (e as Error).message);
    }
  }

  async function automaticCover() {
    try {
      if (kind === "folder") await PhotosApi.setFolderCover(id, null);
      else await PhotosApi.updateAlbum(id, { coverItemId: null });
      setVersion((v) => v + 1);
    } catch (e) {
      toasts.error("Couldn't change the cover", (e as Error).message);
    }
  }

  async function remove() {
    try {
      await PhotosApi.deleteAlbum(id);
      toasts.success(`Deleted ${detail?.title}`, "The photos in it are still in the library.");
      addToPhotoAlbum.changed();
      router.navigate(detail ? `/library/${detail.libraryId}` : "/", { replace: true });
    } catch (e) {
      toasts.error("Couldn't delete the album", (e as Error).message);
    }
  }

  return (
    <AppShell>
      <div className="cn-library cn-photos">
        {!detail && !error && <div className="cn-library__loading"><Spinner size="2rem" /></div>}
        {error && (
          <section className="cn-library__empty">
            <h2>This album isn't available</h2>
            <p>{error}</p>
          </section>
        )}

        {detail && (
          <>
            <header className="cn-photos__album-head">
              <div className="cn-photos__album-text">
                <nav className="cn-photos__path" aria-label="Folders">
                  {library && <Link href={`/library/${library.id}`}>{library.name}</Link>}
                  {detail.folders.map((f) => (
                    <span key={f.id}>
                      <span aria-hidden="true">›</span>
                      <Link href={`/photos/folder/${f.id}`}>{f.title}</Link>
                    </span>
                  ))}
                </nav>
                <h1>{detail.title}</h1>
                <p className="cn-photos__album-meta">
                  {[
                    detail.from && detail.to ? formatDateRange(detail.from, detail.to) : null,
                    albumCounts(detail),
                    detail.owner ? `Made by ${detail.owner.name}` : null,
                  ].filter(Boolean).join(" · ")}
                </p>
                {detail.description && <p className="cn-photos__album-description">{detail.description}</p>}
              </div>
              <div className="cn-photos__album-actions">
                <Button variant="primary" icon={<Play />} onClick={() => viewer.slideshow(false)} disabled={detail.photoCount + detail.videoCount === 0}>Slideshow</Button>
                <IconButton label="Shuffle slideshow" icon={<Shuffle />} onClick={() => viewer.slideshow(true)} disabled={detail.photoCount + detail.videoCount === 0} />
                <IconButton label="Select photos" icon={<ListChecks />} onClick={selection.selected ? selection.stop : selection.start} aria-pressed={!!selection.selected} disabled={!list.items?.length} />
                {canEdit && (
                  <Menu.Root>
                    <Menu.Trigger className="cn-icon-button cn-icon-button--glass cn-icon-button--md" aria-label="More" title="More"><Ellipsis /></Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Positioner sideOffset={6} align="end" className="cn-menu__positioner">
                        <Menu.Popup className="cn-menu">
                          <Menu.Item className="cn-menu__item" onClick={() => setEditing(true)}><Pencil /> {kind === "album" ? "Rename and describe" : "Edit details"}</Menu.Item>
                          <Menu.Item className="cn-menu__item" onClick={automaticCover}><RotateCcw /> Use the automatic cover</Menu.Item>
                          {kind === "album" && <Menu.Separator className="cn-menu__separator" />}
                          {kind === "album" && <Menu.Item className="cn-menu__item cn-menu__item--danger" onClick={() => setDeleting(true)}><Trash2 /> Delete album</Menu.Item>}
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.Root>
                )}
              </div>
            </header>

            {detail.albums.length > 0 && (
              <div className="cn-library__grid cn-library__grid--wide cn-photos__subalbums">
                {detail.albums.map((album) => <PhotoAlbumCard key={album.id} album={album} />)}
              </div>
            )}

            {list.items?.length === 0 && detail.albums.length === 0 && (
              <section className="cn-library__empty">
                <h2>{kind === "album" ? "No photos in this album yet" : "Nothing in here this profile can see"}</h2>
                {kind === "album" && <p>Open a photo anywhere in {library?.name ?? "the library"} and choose “Add to album” from its menu, or pick several with Select.</p>}
              </section>
            )}

            {list.items && list.items.length > 0 && <PhotoGrid items={list.items} groupBy="day" onOpen={viewer.open} selected={selection.selected} onToggle={selection.toggle} />}
            <div ref={list.sentinel} />
            {list.loading && <div className="cn-library__loading"><Spinner size="2rem" /></div>}
          </>
        )}
      </div>

      {detail && selection.selected && (
        <SelectionBar libraryId={detail.libraryId} selected={selection.selected} onDone={selection.stop}>
          {canEdit && selection.selected.size === 1 && <Button size="sm" icon={<Images />} onClick={useAsCover}>Use as cover</Button>}
          {canEdit && kind === "album" && <Button size="sm" icon={<ImageMinus />} disabled={selection.selected.size === 0} onClick={takeOut}>Take out</Button>}
        </SelectionBar>
      )}

      {detail && viewer.isOpen && (
        <PhotoViewer
          items={viewer.list}
          index={viewer.index}
          total={viewer.total}
          contextTitle={contextTitle}
          album={{ kind, id, canEdit }}
          startPlaying={viewer.startPlaying}
          onIndexChange={viewer.open}
          onClose={viewer.close}
          onNeedMore={list.loadMore}
          onChanged={refresh}
        />
      )}

      {detail && <EditAlbumDialog detail={detail} open={editing} onClose={() => setEditing(false)} onSaved={() => setVersion((v) => v + 1)} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${detail?.title}?`}
        description="The album goes away; the photos in it stay in the library and on disk."
        confirmLabel="Delete album"
        danger
        onConfirm={remove}
      />
    </AppShell>
  );
}

/**
 * A folder's or album's name and description.
 */
function EditAlbumDialog(props: { detail: PhotoAlbumDetail; open: boolean; onClose: () => void; onSaved: () => void }) {
  const { detail, open, onClose, onSaved } = props;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    setTitle(detail.title);
    setDescription(detail.description ?? "");
  }, [open]);

  async function save() {
    setSaving(true);
    try {
      if (detail.kind === "folder") await ItemsApi.editDetails(detail.id, { title, releaseDate: null, overview: description || null, tags: [], contentRating: null });
      else await PhotosApi.updateAlbum(detail.id, { title, description: description || null });
      toasts.success("Saved");
      onSaved();
      onClose();
    } catch (e) {
      toasts.error("Couldn't save", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !value && onClose()}
      title={detail.kind === "album" ? "Rename and describe" : "Edit album details"}
      description={detail.kind === "folder" ? "The folder on disk keeps its name; this is what Cinemion shows." : undefined}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={!title.trim()}>Save</Button>
      </>}
    >
      <div className="cn-photos__edit">
        <TextField label="Name" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={128} />
        <div className="cn-field">
          <label className="cn-field__label" htmlFor={descriptionId}>Description</label>
          <textarea id={descriptionId} className="cn-field__input cn-photos__textarea" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={5000} />
        </div>
      </div>
    </Dialog>
  );
}
