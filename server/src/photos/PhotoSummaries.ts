import type { PhotoAlbumSummary, PhotoSummary } from "@shared/photos.ts";
import { MediaFile, MediaItem, type PhotoAlbum, PhotoAlbumItem, User } from "../models/index.ts";
import FolderTree from "../library/FolderTree.ts";
import Visibility from "../library/Visibility.ts";

/**
 * Builds what grids, albums and the viewer show about photos, videos and albums, in a few batched queries.
 */
export namespace PhotoSummaries {
  // Very long panoramas and screenshots would make rows unusable; they're shown cropped beyond this
  const MIN_ASPECT = 0.25;
  const MAX_ASPECT = 4;

  /**
   * Width divided by height as shown, from the size stored for the file.
   */
  function aspectOf(file: MediaFile | undefined) {
    const width = file?.photo?.width ?? file?.width;
    const height = file?.photo?.height ?? file?.height;
    if (!width || !height) return 1.5;
    return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, Math.round(width / height * 1000) / 1000));
  }

  /**
   * Summaries for photos and videos, in the same order.
   */
  export async function photos(items: MediaItem[]): Promise<PhotoSummary[]> {
    if (items.length === 0) return [];
    const files = await MediaFile.findAll({ where: { itemId: items.map((i) => i.id) }, attributes: ["itemId", "path", "width", "height", "duration", "photo"], order: [["path", "ASC"]] });
    const fileOf = new Map<number, MediaFile>();
    for (const file of files) if (file.itemId !== null && !fileOf.has(file.itemId)) fileOf.set(file.itemId, file);
    return items.map((item) => {
      const file = fileOf.get(item.id);
      return {
        id: item.id,
        libraryId: item.libraryId,
        type: item.type === "photo" ? "photo" : "video",
        title: item.title,
        image: item.artwork.thumb,
        aspect: aspectOf(file),
        takenAt: item.takenAt ?? (item.releaseDate ? `${item.releaseDate}T00:00:00` : null),
        duration: item.type === "video" ? file?.duration ?? (item.runtime ? item.runtime * 60 : null) : null,
        folderId: item.parentId,
      };
    });
  }

  /**
   * Counts and dates of what `user` may see among `items`.
   */
  function contents(items: MediaItem[], user: User) {
    const visible = items.filter((i) => Visibility.canSee(user, i));
    const dates = visible.map((i) => i.releaseDate).filter((d): d is string => !!d).sort();
    return {
      visible,
      photoCount: visible.filter((i) => i.type === "photo").length,
      videoCount: visible.filter((i) => i.type === "video").length,
      from: dates[0] ?? null,
      to: dates[dates.length - 1] ?? null,
    };
  }

  /**
   * Summaries for folders, counting everything inside them (subfolders included) that `user` may see.
   */
  export async function folders(list: MediaItem[], user: User, tree?: FolderTree): Promise<PhotoAlbumSummary[]> {
    if (list.length === 0) return [];
    tree ??= await FolderTree.load(list.map((f) => f.libraryId));
    return list.map((folder) => {
      const { photoCount, videoCount, from, to } = contents(tree.itemsUnder(folder.id), user);
      return {
        kind: "folder",
        id: folder.id,
        libraryId: folder.libraryId,
        title: folder.title,
        cover: folder.artwork.thumb,
        palette: folder.palette,
        photoCount,
        videoCount,
        from,
        to,
        owner: null,
      };
    });
  }

  /**
   * What each hand-made album holds that `user` may see, by album id.
   */
  export async function albumItems(albums: PhotoAlbum[], user: User) {
    const entries = albums.length ? await PhotoAlbumItem.findAll({ where: { albumId: albums.map((a) => a.id) }, attributes: ["albumId", "itemId"] }) : [];
    const items = entries.length
      ? await MediaItem.findAll({ where: { id: [...new Set(entries.map((e) => e.itemId))] }, attributes: ["id", "libraryId", "type", "ageRating", "releaseDate", "takenAt", "artwork"] })
      : [];
    const byId = new Map(items.map((i) => [i.id, i]));
    const result = new Map<number, MediaItem[]>(albums.map((a) => [a.id, []]));
    for (const entry of entries) {
      const item = byId.get(entry.itemId);
      if (item && Visibility.canSee(user, item)) result.get(entry.albumId)!.push(item);
    }
    return result;
  }

  /**
   * Summaries for hand-made albums. The cover is the chosen photo when `user` may see it, otherwise the newest one.
   */
  export async function albums(list: PhotoAlbum[], user: User): Promise<PhotoAlbumSummary[]> {
    if (list.length === 0) return [];
    const itemsOf = await albumItems(list, user);
    const ownerIds = [...new Set(list.map((a) => a.userId).filter((id): id is number => id !== null))];
    const owners = new Map((ownerIds.length ? await User.findAll({ where: { id: ownerIds }, attributes: ["id", "name"] }) : []).map((u) => [u.id, u]));
    return list.map((album) => {
      const { visible, photoCount, videoCount, from, to } = contents(itemsOf.get(album.id) ?? [], user);
      const chosen = visible.find((i) => i.id === album.coverItemId && i.artwork.thumb);
      const newest = [...visible].sort((a, b) => (b.takenAt ?? "").localeCompare(a.takenAt ?? "")).find((i) => i.artwork.thumb);
      const owner = album.userId !== null ? owners.get(album.userId) : undefined;
      return {
        kind: "album",
        id: album.id,
        libraryId: album.libraryId,
        title: album.title,
        cover: (chosen ?? newest)?.artwork.thumb ?? null,
        palette: null,
        photoCount,
        videoCount,
        from,
        to,
        owner: owner ? { id: owner.id, name: owner.name } : null,
      };
    });
  }
}

export default PhotoSummaries;
