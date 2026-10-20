import { Fragment, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { Disc3, EllipsisVertical, ListEnd, ListPlus, ListStart, Mic2, Play } from "lucide-react";
import type { TrackInfo } from "@shared/music.ts";
import { musicPlayer } from "../../lib/MusicPlayer.ts";
import useController from "../../lib/useController.ts";
import { router } from "../../lib/Router.tsx";
import { formatClock } from "../../lib/playback.ts";
import cx from "../../lib/cx.ts";
import { addToPlaylist } from "../AddToPlaylist/AddToPlaylist.tsx";
import { Cover } from "../MusicCard/MusicCard.tsx";
import "./TrackList.scss";

export interface TrackListProps {
  tracks: TrackInfo[];
  /**
   * Play the list from this track. Default plays `tracks` from it.
   */
  onPlay?: (index: number) => void;
  /**
   * `album`: track numbers and disc headings. `list`: covers, with the album in its own column.
   */
  variant?: "album" | "list";
  /**
   * Extra items for a track's menu, like "Remove from playlist".
   */
  menuItems?: (track: TrackInfo, index: number) => ReactNode;
  label?: string;
}

/**
 * Rows of tracks that play when clicked, with a menu for the queue and playlists. The playing track is highlighted.
 */
export default function TrackList(props: TrackListProps) {
  const { tracks, onPlay, variant = "list", menuItems, label = "Tracks" } = props;
  const player = useController(musicPlayer);
  const current = player.current;
  const discs = variant === "album" && new Set(tracks.map((t) => t.disc ?? 1)).size > 1;
  const play = (index: number) => onPlay ? onPlay(index) : musicPlayer.play(tracks, index);

  return (
    <ol className={cx("cn-tracks", `cn-tracks--${variant}`)} aria-label={label}>
      {tracks.map((track, i) => {
        const isCurrent = current?.id === track.id;
        const newDisc = discs && (i === 0 || (tracks[i - 1].disc ?? 1) !== (track.disc ?? 1));
        return (
          <Fragment key={"entryId" in track ? `e${track.entryId}` : `${track.id}-${i}`}>
            {newDisc && <li className="cn-tracks__disc" aria-hidden="true"><Disc3 /> Disc {track.disc ?? 1}</li>}
            <li className={cx("cn-tracks__row", isCurrent && "cn-tracks__row--current")}>
              <button type="button" className="cn-tracks__main" onClick={() => isCurrent ? musicPlayer.toggle() : play(i)} aria-label={`${isCurrent && player.playing ? "Pause" : "Play"} ${track.title}`}>
                <span className="cn-tracks__lead">
                  {variant === "list" && <Cover image={track.cover} title={track.albumTitle} width={96} className="cn-tracks__cover" />}
                  {variant === "album" && <span className="cn-tracks__number">{track.number ?? i + 1}</span>}
                  {isCurrent && player.playing ? <Bars /> : <Play className="cn-tracks__play" />}
                </span>
                <span className="cn-tracks__title">
                  <strong>{track.title}</strong>
                  {(variant === "list" || track.trackArtist) && <span>{track.trackArtist ?? track.artistName}</span>}
                </span>
                {variant === "list" && <span className="cn-tracks__album">{track.albumTitle}</span>}
                <span className="cn-tracks__time">{formatClock(track.duration)}</span>
              </button>
              <TrackMenu track={track} index={i} extra={menuItems?.(track, i)} />
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

/**
 * The little moving bars on the track that's playing.
 */
export function Bars() {
  return <span className="cn-bars" aria-hidden="true"><span /><span /><span /></span>;
}

function TrackMenu(props: { track: TrackInfo; index: number; extra?: ReactNode }) {
  const { track, extra } = props;
  return (
    <Menu.Root>
      <Menu.Trigger className="cn-tracks__menu" aria-label={`More for ${track.title}`}><EllipsisVertical /></Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="cn-menu__positioner">
          <Menu.Popup className="cn-menu">
            <Menu.Item className="cn-menu__item" onClick={() => musicPlayer.playNext([track])}><ListStart /> Play next</Menu.Item>
            <Menu.Item className="cn-menu__item" onClick={() => musicPlayer.addToQueue([track])}><ListEnd /> Add to queue</Menu.Item>
            <Menu.Item className="cn-menu__item" onClick={() => addToPlaylist.show([track.id])}><ListPlus /> Add to playlist…</Menu.Item>
            {(track.albumId || track.artistId) && <Menu.Separator className="cn-menu__separator" />}
            {track.albumId && <Menu.Item className="cn-menu__item" onClick={() => router.navigate(`/album/${track.albumId}`)}><Disc3 /> Go to album</Menu.Item>}
            {track.artistId && <Menu.Item className="cn-menu__item" onClick={() => router.navigate(`/artist/${track.artistId}`)}><Mic2 /> Go to artist</Menu.Item>}
            {extra && <Menu.Separator className="cn-menu__separator" />}
            {extra}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
