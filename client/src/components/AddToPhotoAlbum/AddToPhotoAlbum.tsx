import { type FormEvent, useEffect, useState } from "react";
import { ImagePlus, Plus } from "lucide-react";
import type { PhotoAlbumSummary } from "@shared/photos.ts";
import PhotosApi from "../../Api/PhotosApi.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import Controller from "../../lib/Controller.ts";
import useController from "../../lib/useController.ts";
import { toasts } from "../../lib/Toasts.ts";
import { t } from "../../i18n/I18n.ts";
import Dialog from "../Dialog/Dialog.tsx";
import Button from "../Button/Button.tsx";
import TextField from "../TextField/TextField.tsx";
import { albumCounts } from "../PhotoAlbumCard/PhotoAlbumCard.tsx";
import "../AddToPlaylist/AddToPlaylist.scss";
import "./AddToPhotoAlbum.scss";

/**
 * Opens the "Add to album" dialog from anywhere, like the photo viewer or a selection of photos.
 */
export class AddToPhotoAlbumController extends Controller {
  public libraryId = 0;
  public itemIds: number[] = [];
  public open = false;
  /**
   * Bumped when an album changes, so pages showing albums can load them again.
   */
  public changes = 0;

  public show(libraryId: number, itemIds: number[]) {
    if (itemIds.length === 0) return;
    this.libraryId = libraryId;
    this.itemIds = itemIds;
    this.open = true;
    this.notify();
  }

  public close() {
    this.open = false;
    this.notify();
  }

  public changed() {
    this.changes++;
    this.notify();
  }
}

export const addToPhotoAlbum = new AddToPhotoAlbumController();

/**
 * Pick one of your albums for some photos, or make a new one with them. Rendered once, at the root of the app.
 * The photos stay where they are on disk; albums only point at them.
 */
export default function AddToPhotoAlbum() {
  const { open, libraryId, itemIds } = useController(addToPhotoAlbum);
  const [albums, setAlbums] = useState<PhotoAlbumSummary[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const count = itemIds.length;

  useEffect(() => {
    if (!open) return;
    setName("");
    setAlbums(null);
    PhotosApi.albums(libraryId, true).then(setAlbums).catch(() => setAlbums([]));
  }, [open, libraryId]);

  async function addTo(album: PhotoAlbumSummary) {
    setBusy(true);
    try {
      const result = await PhotosApi.addToAlbum(album.id, itemIds);
      toasts.success(result.added === 0 ? t("photos.addToAlbum.alreadyIn", { album: album.title }) : t("photos.addToAlbum.added", { count: result.added, album: album.title }));
      addToPhotoAlbum.changed();
      addToPhotoAlbum.close();
    } catch (error) {
      toasts.error(t("photos.addToAlbum.couldntAdd"), (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const album = await PhotosApi.createAlbum({ libraryId, title: name, itemIds });
      toasts.success(t("photos.addToAlbum.made", { count, album: album.title }));
      addToPhotoAlbum.changed();
      addToPhotoAlbum.close();
    } catch (error) {
      toasts.error(t("photos.addToAlbum.couldntMake"), (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && addToPhotoAlbum.close()} title={t("photos.addToAlbum.title")} description={t("photos.addToAlbum.description", { count })} size="sm">
      <form className="cn-add-playlist__new" onSubmit={create}>
        <TextField label={t("photos.addToAlbum.newAlbum")} placeholder={t("photos.addToAlbum.name")} value={name} maxLength={128} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="primary" icon={<Plus />} disabled={!name.trim()} loading={busy && !!name.trim()}>{t("photos.addToAlbum.create")}</Button>
      </form>
      {albums && albums.length > 0 && (
        <ul className="cn-add-playlist__list">
          {albums.map((album) => (
            <li key={album.id}>
              <button type="button" className="cn-add-playlist__item" disabled={busy} onClick={() => addTo(album)}>
                <span className="cn-add-photo-album__cover cn-dark-theme">
                  {album.cover && <img src={ItemsApi.imageUrl(album.cover, 160)} alt="" />}
                </span>
                <span>
                  <strong>{album.title}</strong>
                  <span>{albumCounts(album)}</span>
                </span>
                <ImagePlus aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
