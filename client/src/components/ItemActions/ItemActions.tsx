import { type ReactNode, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Check, EllipsisVertical, Pencil, Plus, RefreshCw, RotateCcw, Wand2 } from "lucide-react";
import { type ItemDetail, type ItemSummary, isPlayable } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { session } from "../../Session.ts";
import { toasts } from "../../lib/Toasts.ts";
import { play, timeLeft } from "../../lib/playback.ts";
import Button from "../Button/Button.tsx";
import IconButton from "../IconButton/IconButton.tsx";
import FixMatchDialog from "../FixMatchDialog/FixMatchDialog.tsx";
import EditDetailsDialog from "../EditDetailsDialog/EditDetailsDialog.tsx";
import DownloadButton from "../DownloadButton/DownloadButton.tsx";
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
 * Play or Resume, Play from start, the watched toggle, Download, and (for managers) Fix match or Edit details, and
 * Refresh.
 */
export default function ItemActions(props: ItemActionsProps) {
  const { item, playTarget, onChanged, children } = props;
  const [fixing, setFixing] = useState(false);
  const [editing, setEditing] = useState(false);
  const target = playTarget ?? (isPlayable(item.type) ? item : null);
  const editable = item.type === "video" || item.type === "folder";
  const resumable = !!target?.userData?.position;
  const watched = item.userData?.watched ?? false;
  const left = target ? timeLeft(target) : null;

  // "Resume S1 E3" on shows, so it's clear which episode starts
  const episodeTag = target && target.type === "episode" && item.type !== "episode" ? ` S${target.seasonNumber} E${target.episodeNumber}` : "";
  const playLabel = resumable ? `Resume${episodeTag}` : `Play${episodeTag}`;

  async function toggleWatched() {
    try {
      await ItemsApi.setWatched(item.id, !watched);
      onChanged();
    } catch (error) {
      toasts.error("Couldn't update", (error as Error).message);
    }
  }

  async function refresh() {
    const id = toasts.show({ title: `Refreshing ${item.title}…` });
    try {
      await ItemsApi.refresh(item.id);
      toasts.dismiss(id);
      toasts.success(`${item.title} is up to date`);
      onChanged();
    } catch (error) {
      toasts.dismiss(id);
      toasts.error("Couldn't refresh", (error as Error).message);
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
        {target && resumable && <Button variant="secondary" size="lg" icon={<RotateCcw />} onClick={() => play(target, { fromStart: true })}>From start</Button>}
        <IconButton
          label={watched ? "Mark as unwatched" : "Mark as watched"}
          icon={watched ? <Check /> : <Plus />}
          size="lg"
          className={watched ? "cn-actions__watched cn-actions__watched--on" : "cn-actions__watched"}
          onClick={toggleWatched}
        />
        {isPlayable(item.type) && session.can("MEDIA_DOWNLOAD") && <DownloadButton item={item} />}
        {children}
        {session.can("LIBRARY_MANAGE") && (
          <Menu.Root>
            <Menu.Trigger className="cn-icon-button cn-icon-button--glass cn-icon-button--lg" aria-label="More options"><EllipsisVertical /></Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner sideOffset={8} align="start" className="cn-menu__positioner">
                <Menu.Popup className="cn-menu">
                  {(item.type === "movie" || item.type === "show") && <Menu.Item className="cn-menu__item" onClick={() => setFixing(true)}><Wand2 /> Fix match</Menu.Item>}
                  {editable && <Menu.Item className="cn-menu__item" onClick={() => setEditing(true)}><Pencil /> Edit details</Menu.Item>}
                  <Menu.Item className="cn-menu__item" onClick={refresh}><RefreshCw /> Refresh details</Menu.Item>
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
