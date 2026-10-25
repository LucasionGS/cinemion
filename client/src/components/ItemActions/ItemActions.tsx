import { type ReactNode, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { BookmarkCheck, BookmarkPlus, Check, EllipsisVertical, Pencil, Plus, RefreshCw, RotateCcw, Trash2, Wand2 } from "lucide-react";
import { type ItemDetail, type ItemSummary, isPlayable } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import WatchlistApi from "../../Api/WatchlistApi.ts";
import { session } from "../../Session.ts";
import { toasts } from "../../lib/Toasts.ts";
import { play, timeLeft } from "../../lib/playback.ts";
import { t } from "../../i18n/I18n.ts";
import Button from "../Button/Button.tsx";
import IconButton from "../IconButton/IconButton.tsx";
import FixMatchDialog from "../FixMatchDialog/FixMatchDialog.tsx";
import EditDetailsDialog from "../EditDetailsDialog/EditDetailsDialog.tsx";
import DownloadButton from "../DownloadButton/DownloadButton.tsx";
import DeleteDialog from "../DeleteDialog/DeleteDialog.tsx";
import { router } from "../../lib/Router.tsx";
import "./ItemActions.scss";

export interface ItemActionsProps {
  item: ItemDetail;
  /**
   * What Play starts. Default is the item itself; for shows, the next episode; for folders, the next video.
   */
  playTarget?: ItemSummary | null;
  /**
   * Called after anything changed the item, so the page can reload it.
   */
  onChanged: () => void;
  /**
   * More buttons for this kind of item, after the others, like the star and cutting for clips.
   */
  children?: ReactNode;
}

/**
 * Kinds of titles that can go on "My list".
 */
const LIST_TYPES: string[] = ["movie", "show", "video"];

/**
 * Kinds of titles that can be deleted from disk here.
 */
const DELETABLE: string[] = ["movie", "show", "episode", "video"];

/**
 * Play or Resume, Play from start, the watched toggle, My list, Download, and (for managers) Fix match or Edit details, and
 * Refresh.
 */
export default function ItemActions(props: ItemActionsProps) {
  const { item, playTarget, onChanged, children } = props;
  const [fixing, setFixing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [onList, setOnList] = useState(item.onList);
  const [deleting, setDeleting] = useState(false);
  const canManage = session.can("LIBRARY_MANAGE");
  const canDelete = session.can("MEDIA_DELETE") && DELETABLE.includes(item.type);
  const target = playTarget ?? (isPlayable(item.type) ? item : null);
  const editable = item.type === "video" || item.type === "folder";
  const resumable = !!target?.userData?.position;
  const watched = item.userData?.watched ?? false;
  const left = target ? timeLeft(target) : null;

  // "Resume S1 E3" on shows, so it's clear which episode starts
  const episode = target && target.type === "episode" && item.type !== "episode" ? { season: String(target.seasonNumber), episode: String(target.episodeNumber) } : null;
  const playLabel = episode
    ? t(resumable ? "itemActions.resumeEpisode" : "itemActions.playEpisode", episode)
    : t(resumable ? "itemActions.resume" : "itemActions.play");

  async function toggleWatched() {
    try {
      await ItemsApi.setWatched(item.id, !watched);
      onChanged();
    } catch (error) {
      toasts.error(t("itemActions.updateFailed"), (error as Error).message);
    }
  }

  async function toggleList() {
    const next = !onList;
    setOnList(next);
    try {
      if (next) await WatchlistApi.add(item.id);
      else await WatchlistApi.remove(item.id);
      toasts.success(next ? t("itemActions.addedToList", { title: item.title }) : t("itemActions.removedFromList", { title: item.title }));
    } catch (error) {
      setOnList(!next);
      toasts.error(t("itemActions.updateFailed"), (error as Error).message);
    }
  }

  async function refresh() {
    const id = toasts.show({ title: t("itemActions.refreshing", { title: item.title }) });
    try {
      await ItemsApi.refresh(item.id);
      toasts.dismiss(id);
      toasts.success(t("itemActions.upToDate", { title: item.title }));
      onChanged();
    } catch (error) {
      toasts.dismiss(id);
      toasts.error(t("itemActions.refreshFailed"), (error as Error).message);
    }
  }

  return (
    <div className="cn-actions">
      <div className="cn-actions__buttons">
        {target && (
          <Button variant="primary" size="lg" className="cn-actions__play" icon={<PlayRing />} onClick={() => play(target)} data-autofocus>
            {playLabel}
          </Button>
        )}
        {target && resumable && <Button variant="secondary" size="lg" icon={<RotateCcw />} onClick={() => play(target, { fromStart: true })}>{t("itemActions.fromStart")}</Button>}
        <IconButton
          label={watched ? t("itemActions.markUnwatched") : t("itemActions.markWatched")}
          icon={watched ? <Check /> : <Plus />}
          size="lg"
          className={watched ? "cn-actions__watched cn-actions__watched--on" : "cn-actions__watched"}
          onClick={toggleWatched}
        />
        {LIST_TYPES.includes(item.type) && (
          <IconButton
            label={onList ? t("itemActions.removeFromList") : t("itemActions.addToList")}
            icon={onList ? <BookmarkCheck /> : <BookmarkPlus />}
            size="lg"
            className={onList ? "cn-actions__watched cn-actions__watched--on" : "cn-actions__watched"}
            aria-pressed={onList}
            onClick={toggleList}
          />
        )}
        {isPlayable(item.type) && session.can("MEDIA_DOWNLOAD") && <DownloadButton item={item} />}
        {children}
        {(canManage || canDelete) && (
          <Menu.Root>
            <Menu.Trigger className="cn-icon-button cn-icon-button--glass cn-icon-button--lg" aria-label={t("itemActions.moreOptions")}><EllipsisVertical /></Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner sideOffset={8} align="start" className="cn-menu__positioner">
                <Menu.Popup className="cn-menu">
                  {canManage && (item.type === "movie" || item.type === "show") && <Menu.Item className="cn-menu__item" onClick={() => setFixing(true)}><Wand2 /> {t("itemActions.fixMatch")}</Menu.Item>}
                  {canManage && editable && <Menu.Item className="cn-menu__item" onClick={() => setEditing(true)}><Pencil /> {t("itemActions.editDetails")}</Menu.Item>}
                  {canManage && <Menu.Item className="cn-menu__item" onClick={refresh}><RefreshCw /> {t("itemActions.refresh")}</Menu.Item>}
                  {canDelete && <Menu.Item className="cn-menu__item cn-menu__item--danger" onClick={() => setDeleting(true)}><Trash2 /> {t("itemActions.delete")}</Menu.Item>}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )}
      </div>
      {resumable && target?.userData?.progress && (
        <div className="cn-actions__progress">
          <span className="cn-actions__bar"><span style={{ width: `${Math.round(target.userData.progress * 100)}%` }} /></span>
          <span>{left}</span>
        </div>
      )}
      <FixMatchDialog item={fixing ? item : null} onClose={() => setFixing(false)} onMatched={() => onChanged()} />
      {editable && <EditDetailsDialog item={editing ? item : null} onClose={() => setEditing(false)} onSaved={onChanged} />}
      {canDelete && (
        <DeleteDialog
          item={deleting ? item : null}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            // An episode goes back to its show; anything else to its library
            router.navigate(item.type === "episode" && item.showId ? `/item/${item.showId}` : `/library/${item.libraryId}`, { replace: true });
          }}
        />
      )}
    </div>
  );
}

/**
 * The play button motif: a ring with a play triangle.
 */
export function PlayRing() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className="cn-play-ring">
      <circle cx="32" cy="32" r="24" stroke="currentColor" strokeWidth="6" />
      <path d="M27 22 43 32 27 42z" fill="currentColor" />
    </svg>
  );
}
