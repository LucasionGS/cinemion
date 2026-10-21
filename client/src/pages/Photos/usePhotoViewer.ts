import { useCallback, useEffect, useState } from "react";
import type { PhotoSummary } from "@shared/photos.ts";
import PhotosApi from "../../Api/PhotosApi.ts";
import { usePhotoParam } from "../../components/PhotoViewer/PhotoViewer.tsx";

/**
 * What a page needs to show the photo viewer over its list: which photo is open (from the address), the list the
 * viewer moves through, and how to start a slideshow.
 * @param loadAll Everything a slideshow plays, which can be more than the page lists (like a folder's subfolders).
 */
export default function usePhotoViewer(items: PhotoSummary[] | null, total: number | null, loadAll: () => Promise<PhotoSummary[]>) {
  const param = usePhotoParam();
  // A slideshow's own list, when it isn't the page's (shuffled, or with more in it)
  const [playlist, setPlaylist] = useState<PhotoSummary[] | null>(null);
  const [single, setSingle] = useState<PhotoSummary[] | null>(null);
  const list = playlist ?? items ?? [];
  const found = param.id === null ? -1 : list.findIndex((p) => p.id === param.id);

  // A link to a photo that isn't in what's loaded shows it on its own
  useEffect(() => {
    if (param.id === null || found >= 0 || items === null) {
      setSingle(null);
      return;
    }
    let cancelled = false;
    PhotosApi.get(param.id).then((photo) => {
      if (!cancelled) setSingle([photo]);
    }).catch(() => {
      if (!cancelled) param.close();
    });
    return () => {
      cancelled = true;
    };
  }, [param.id, found >= 0, items === null]);

  // Closing the viewer ends the slideshow's own list
  useEffect(() => {
    if (param.id === null) setPlaylist(null);
  }, [param.id]);

  const slideshow = useCallback(async (shuffle: boolean) => {
    const all = await loadAll();
    const order = shuffle ? shuffleCopy(all) : all;
    if (order.length === 0) return;
    if (order !== items) setPlaylist(order);
    param.open(order[0].id, { slideshow: "1" });
  }, [items, loadAll, param.open]);

  const open = useCallback((index: number) => {
    const photo = list[index];
    if (photo) param.open(photo.id);
  }, [list, param.open]);

  return {
    isOpen: param.id !== null && (found >= 0 || single !== null),
    list: single ?? list,
    index: single ? 0 : found,
    total: single || playlist ? null : total,
    startPlaying: param.slideshow === "1",
    open,
    close: param.close,
    slideshow,
  };
}

function shuffleCopy<T>(list: T[]) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
