import { type MouseEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu } from "@base-ui/react/menu";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Ellipsis, FolderOpen, ImageMinus, ImagePlus, Images, Info, Maximize, Minimize, Pause, Play } from "lucide-react";
import { type PhotoAlbumKind, type PhotoDetail, type PhotoSummary, SLIDESHOW_SECONDS } from "@shared/photos.ts";
import PhotosApi from "../../Api/PhotosApi.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { router } from "../../lib/Router.tsx";
import { deviceMode } from "../../lib/DeviceMode.ts";
import { musicPlayer } from "../../lib/MusicPlayer.ts";
import { session } from "../../Session.ts";
import { toasts } from "../../lib/Toasts.ts";
import { formatDateTime } from "../../lib/format.ts";
import useController from "../../lib/useController.ts";
import cx from "../../lib/cx.ts";
import { t } from "../../i18n/I18n.ts";
import IconButton from "../IconButton/IconButton.tsx";
import Button from "../Button/Button.tsx";
import { addToPhotoAlbum } from "../AddToPhotoAlbum/AddToPhotoAlbum.tsx";
import PhotoInfo from "./PhotoInfo.tsx";
import InlineVideo from "./InlineVideo.tsx";
import "./PhotoViewer.scss";

export interface PhotoViewerProps {
  items: PhotoSummary[];
  index: number;
  /**
   * How many there are in all, when more than `items` will load. `null` = `items` is everything.
   */
  total: number | null;
  /**
   * Where the photos are, like "Holiday 2024", shown under the date.
   */
  contextTitle: string;
  /**
   * The folder or hand-made album being looked at, for "Use as album cover" and "Remove from this album".
   */
  album?: { kind: PhotoAlbumKind; id: number; canEdit: boolean } | null;
  /**
   * Start with the slideshow running.
   */
  startPlaying?: boolean;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /**
   * Called near the end of `items`, so the page can load the next page.
   */
  onNeedMore?: () => void;
  /**
   * Called after something changed that the page shows, like a cover or a photo taken out of the album.
   */
  onChanged?: () => void;
}

const INFO_KEY = "cn-photo-info";
const FILMSTRIP_SIDE = 7;
const SWIPE_DISTANCE = 50;

/**
 * Photos (and videos) one at a time, full screen: arrows, swipes and keys move along, a filmstrip shows what's
 * around, the details panel shows what the file says, and the slideshow moves on by itself.
 */
export default function PhotoViewer(props: PhotoViewerProps) {
  const { items, index, total, contextTitle, album = null, startPlaying = false, onIndexChange, onClose, onNeedMore, onChanged } = props;
  const photo = items[index] as PhotoSummary | undefined;
  const { mode } = useController(deviceMode);
  const [detail, setDetail] = useState<PhotoDetail | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [playing, setPlaying] = useState(startPlaying);
  const [infoOpen, setInfoOpen] = useState(() => readInfoPref());
  const [controlsShown, setControlsShown] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const count = total ?? items.length;
  const canManage = session.can("LIBRARY_MANAGE");

  const go = useCallback((delta: number) => {
    const next = index + delta;
    if (next >= 0 && next < items.length) onIndexChange(next);
    // The slideshow starts over at the end, once everything is loaded
    else if (delta > 0 && playing && items.length >= count) onIndexChange(0);
  }, [index, items.length, count, playing, onIndexChange]);

  // The page behind doesn't scroll, and music doesn't play over videos
  useEffect(() => {
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    if (photo?.type === "video") musicPlayer.pause();
  }, [photo?.id]);

  // Details for the panel, and the full-size picture
  useEffect(() => {
    if (!photo) return;
    setDetail(null);
    setFull(null);
    setZoomed(false);
    let cancelled = false;
    PhotosApi.get(photo.id).then((d) => {
      if (!cancelled) setDetail(d);
    }).catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [photo?.id]);

  // The thumbnail shows at once; the original replaces it when it's loaded. The slideshow keeps to thumbnails,
  // which are plenty for a screen and much quicker to load.
  useEffect(() => {
    if (!detail || detail.type !== "photo" || (playing && !zoomed)) return;
    const image = new Image();
    image.onload = () => setFull(detail.viewUrl);
    image.src = detail.viewUrl;
    return () => {
      image.onload = null;
    };
  }, [detail?.viewUrl, playing, zoomed]);

  // The neighbours load ahead, and the page loads more near the end
  useEffect(() => {
    for (const i of [index + 1, index - 1, index + 2]) {
      const p = items[i];
      if (p?.image) new Image().src = ItemsApi.imageUrl(p.image, 1920);
    }
    if (index >= items.length - 6 && items.length < count) onNeedMore?.();
  }, [index, items.length]);

  // Photos stay up for a few seconds in a slideshow; videos play to the end
  useEffect(() => {
    if (!playing || !photo || photo.type === "video") return;
    const timer = setTimeout(() => go(1), SLIDESHOW_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [playing, photo?.id, go]);

  // Controls step aside while the slideshow runs, and come back when the mouse moves or a key is pressed
  const poke = useCallback(() => {
    setControlsShown(true);
    clearTimeout(hideTimer.current);
    if (playing) hideTimer.current = setTimeout(() => setControlsShown(false), 2000);
  }, [playing]);

  useEffect(() => {
    poke();
    return () => clearTimeout(hideTimer.current);
  }, [playing]);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    };
  }, []);

  const toggleInfo = useCallback(() => {
    setInfoOpen((open) => {
      try {
        localStorage.setItem(INFO_KEY, open ? "0" : "1");
      } catch {
        // Not remembered then
      }
      return !open;
    });
  }, []);

  // Keys work anywhere in the viewer. On TV, left and right move between photos unless focus is on a button.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (document.querySelector("[role=dialog][data-open], [role=alertdialog][data-open], .cn-menu")) return;
      // Keys sent to the page itself (some remotes and gamepads) have no element as their target
      const target = e.target instanceof Element ? e.target : document.body;
      if (target.closest("input, textarea, select")) return;
      const onControl = !!target.closest("[data-viewer-controls]");
      poke();
      let handled = true;
      if (e.key === "ArrowRight" && !(onControl && deviceMode.isTv())) go(1);
      else if (e.key === "ArrowLeft" && !(onControl && deviceMode.isTv())) go(-1);
      else if (e.key === "Escape" || (e.key === "Backspace" && deviceMode.isTv())) {
        if (zoomed) setZoomed(false);
        else onClose();
      }
      else if (e.key === " " && !onControl) setPlaying((p) => !p);
      else if (e.key === "i" && !e.ctrlKey && !e.metaKey) toggleInfo();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [go, zoomed, onClose, poke, toggleInfo]);

  // Focus starts on the picture, so a TV remote's arrows work straight away
  useEffect(() => {
    root.current?.querySelector<HTMLElement>(".cn-photo-viewer__stage")?.focus({ preventScroll: true });
  }, []);

  function onPointerDown(e: PointerEvent) {
    if (!zoomed) swipe.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e: PointerEvent) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    // On phones a tap shows or hides the controls
    else if (deviceMode.mode === "mobile" && Math.abs(dx) < 8 && Math.abs(dy) < 8) setControlsShown((shown) => !shown);
  }

  function toggleZoom(e: MouseEvent<HTMLDivElement>) {
    if (photo?.type !== "photo") return;
    const stage = e.currentTarget;
    const next = !zoomed;
    setZoomed(next);
    setPlaying(false);
    if (next) {
      // Keep the spot that was clicked under the pointer
      const rect = stage.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      requestAnimationFrame(() => {
        stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) * fx;
        stage.scrollTop = (stage.scrollHeight - stage.clientHeight) * fy;
      });
    }
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => { });
    else await root.current?.requestFullscreen().catch(() => { });
  }

  async function useAsCover() {
    if (!album || !photo) return;
    try {
      if (album.kind === "folder") await PhotosApi.setFolderCover(album.id, photo.id);
      else await PhotosApi.updateAlbum(album.id, { coverItemId: photo.id });
      toasts.success(t("photos.cover.changed"));
      onChanged?.();
    } catch (error) {
      toasts.error(t("photos.cover.couldntChange"), (error as Error).message);
    }
  }

  async function removeFromAlbum() {
    if (!album || !photo) return;
    try {
      await PhotosApi.removeFromAlbum(album.id, [photo.id]);
      toasts.success(t("photos.viewer.takenOut"), t("photos.viewer.takenOutDescription"));
      onChanged?.();
    } catch (error) {
      toasts.error(t("photos.viewer.couldntTakeOut"), (error as Error).message);
    }
  }

  const strip = useMemo(() => {
    const from = Math.max(0, index - FILMSTRIP_SIDE);
    return items.slice(from, index + FILMSTRIP_SIDE + 1).map((p, i) => ({ photo: p, index: from + i }));
  }, [items, index]);

  if (!photo) return null;
  const thumbnail = photo.image ? ItemsApi.imageUrl(photo.image, 1920) : null;
  const when = photo.takenAt ? formatDateTime(photo.takenAt, mode === "mobile") : t("photos.viewer.dateUnknown");
  const canEditAlbum = !!album?.canEdit;

  return createPortal(
    <div
      ref={root}
      className={cx("cn-photo-viewer cn-dark-theme", !controlsShown && "cn-photo-viewer--idle", infoOpen && "cn-photo-viewer--info", playing && "cn-photo-viewer--playing")}
      role="dialog"
      aria-modal="true"
      aria-label={t("photos.viewer.label")}
      data-focus-scope
      onMouseMove={poke}
    >
      <div className="cn-photo-viewer__main">
        <div
          className={cx("cn-photo-viewer__stage", zoomed && "cn-photo-viewer__stage--zoomed")}
          tabIndex={0}
          aria-label={photo.type === "video" ? t("photos.viewer.video", { when }) : t("photos.viewer.photo", { when })}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onDoubleClick={toggleZoom}
        >
          {photo.type === "video"
            ? <InlineVideo key={photo.id} id={photo.id} poster={thumbnail} onEnded={() => playing && go(1)} />
            : (full || thumbnail) && <img key={photo.id} className="cn-photo-viewer__image" src={full ?? thumbnail!} alt={detail?.caption ?? ""} draggable={false} />}
        </div>

        <header className="cn-photo-viewer__bar" data-viewer-controls>
          <IconButton label={t("common.close")} icon={<ArrowLeft />} variant="ghost" onClick={onClose} />
          <div className="cn-photo-viewer__title">
            <strong>{when}</strong>
            <span>{t("photos.viewer.position", { context: contextTitle, index: index + 1, count })}</span>
          </div>
          <Button size="sm" icon={playing ? <Pause /> : <Play />} onClick={() => setPlaying((p) => !p)} className="cn-photo-viewer__play">
            {playing ? t("photos.viewer.pause") : t("photos.viewer.slideshow")}
          </Button>
          {mode === "desktop" && <IconButton label={fullscreen ? t("photos.viewer.leaveFullScreen") : t("photos.viewer.fullScreen")} icon={fullscreen ? <Minimize /> : <Maximize />} variant="ghost" onClick={toggleFullscreen} />}
          <IconButton label={t("photos.viewer.details")} icon={<Info />} variant="ghost" onClick={toggleInfo} aria-pressed={infoOpen} />
          {detail && mode !== "tv" && (
            <a className="cn-icon-button cn-icon-button--ghost cn-icon-button--md" href={detail.downloadUrl} download={detail.fileName} aria-label={t("photos.viewer.download")} title={t("photos.viewer.download")}>
              <Download />
            </a>
          )}
          <Menu.Root>
            <Menu.Trigger className="cn-icon-button cn-icon-button--ghost cn-icon-button--md" aria-label={t("common.more")} title={t("common.more")}><Ellipsis /></Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner sideOffset={6} align="end" className="cn-menu__positioner">
                <Menu.Popup className="cn-menu">
                  <Menu.Item className="cn-menu__item" onClick={() => addToPhotoAlbum.show(photo.libraryId, [photo.id])}><ImagePlus /> {t("photos.viewer.addToAlbum")}</Menu.Item>
                  {canEditAlbum && <Menu.Item className="cn-menu__item" onClick={useAsCover}><Images /> {t("photos.viewer.useAsCover")}</Menu.Item>}
                  {canEditAlbum && album?.kind === "album" && <Menu.Item className="cn-menu__item" onClick={removeFromAlbum}><ImageMinus /> {t("photos.viewer.takeOut")}</Menu.Item>}
                  {photo.folderId && !(album?.kind === "folder" && album.id === photo.folderId) && (
                    <Menu.Item className="cn-menu__item" onClick={() => router.navigate(`/photos/folder/${photo.folderId}?photo=${photo.id}`)}><FolderOpen /> {t("photos.viewer.openFolder")}</Menu.Item>
                  )}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </header>

        {index > 0 && <IconButton className="cn-photo-viewer__nav cn-photo-viewer__nav--prev" label={t("photos.viewer.previous")} icon={<ChevronLeft />} onClick={() => go(-1)} data-viewer-controls />}
        {index < items.length - 1 && <IconButton className="cn-photo-viewer__nav cn-photo-viewer__nav--next" label={t("common.next")} icon={<ChevronRight />} onClick={() => go(1)} data-viewer-controls />}

        {mode === "desktop" && items.length > 1 && (
          <div className="cn-photo-viewer__strip" aria-label={t("photos.viewer.around")} data-viewer-controls>
            {strip.map(({ photo: p, index: i }) => (
              <button
                key={p.id}
                type="button"
                className={cx("cn-photo-viewer__thumb", i === index && "cn-photo-viewer__thumb--current")}
                onClick={() => onIndexChange(i)}
                aria-label={p.type === "video" ? t("photos.viewer.videoNumber", { number: i + 1 }) : t("photos.viewer.photoNumber", { number: i + 1 })}
                aria-current={i === index || undefined}
                tabIndex={-1}
              >
                {p.image && <img src={ItemsApi.imageUrl(p.image, 160)} alt="" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {infoOpen && (
        <aside className="cn-photo-viewer__panel" aria-label={t("photos.viewer.details")} data-viewer-controls>
          <PhotoInfo
            detail={detail}
            canEdit={canManage}
            onClose={toggleInfo}
            onSaved={(updated) => {
              setDetail(updated);
              onChanged?.();
            }}
          />
        </aside>
      )}
    </div>,
    document.body,
  );
}

function readInfoPref() {
  try {
    return localStorage.getItem(INFO_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Keep the photo viewer in the address (`?photo=<id>`), so Back closes it and a link opens it again. Opening adds
 * a history entry; moving between photos replaces it.
 */
export function usePhotoParam() {
  const { query, path } = useController(router);
  const id = query.get("photo") ? Number(query.get("photo")) : null;
  const pushed = useRef(false);

  const open = useCallback((photoId: number, extra?: Record<string, string>) => {
    const params = new URLSearchParams(location.search);
    params.set("photo", String(photoId));
    for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
    const replace = params.has("photo") && new URLSearchParams(location.search).has("photo");
    if (!replace) pushed.current = true;
    router.navigate(`${path}?${params}`, { replace, keepScroll: true });
  }, [path]);

  const close = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      history.back();
      return;
    }
    // Opened from a link: there's no entry to go back to
    const params = new URLSearchParams(location.search);
    params.delete("photo");
    params.delete("slideshow");
    router.navigate(params.size ? `${path}?${params}` : path, { replace: true, keepScroll: true });
  }, [path]);

  return { id, open, close, slideshow: query.get("slideshow") };
}
