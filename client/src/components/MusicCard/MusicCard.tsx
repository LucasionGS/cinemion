import { type MouseEvent, type ReactNode, useState } from "react";
import { Play } from "lucide-react";
import type { AlbumSummary, ArtistSummary, PlaylistSummary } from "@shared/music.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import MusicApi from "../../Api/MusicApi.ts";
import { musicPlayer } from "../../lib/MusicPlayer.ts";
import { router } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import cx from "../../lib/cx.ts";
import { t } from "../../i18n/I18n.ts";
import { fallbackColor } from "../PosterCard/PosterCard.tsx";
import "./MusicCard.scss";

export interface CoverProps {
  image: string | null;
  /**
   * Shown when there's no picture, and used to pick its colour.
   */
  title: string;
  round?: boolean;
  /**
   * Up to four covers in a grid, for playlists. Overrides `image`.
   */
  mosaic?: string[];
  className?: string;
  /**
   * Shown width, to pick the image size. Unit is in pixels.
   */
  width?: number;
}

/**
 * Square album art, a round artist picture, or a playlist's mosaic. Without a picture, a tile in the title's colour.
 */
export function Cover(props: CoverProps) {
  const { image, title, round = false, mosaic, className, width = 342 } = props;
  const [broken, setBroken] = useState(false);
  const tiles = mosaic && mosaic.length >= 4 ? mosaic.slice(0, 4) : null;
  const single = tiles ? null : (mosaic?.[0] ?? image);
  return (
    <span
      className={cx("cn-cover", "cn-dark-theme", round && "cn-cover--round", tiles && "cn-cover--mosaic", className)}
      style={single && !broken ? undefined : { background: `linear-gradient(160deg, ${fallbackColor(title)} 0%, #0B0D12 130%)` }}
    >
      {tiles && tiles.map((key, i) => <img key={i} src={ItemsApi.imageUrl(key, width / 2)} alt="" loading="lazy" />)}
      {single && !broken && <img src={ItemsApi.imageUrl(single, width)} alt="" loading="lazy" onError={() => setBroken(true)} />}
      {!tiles && (!single || broken) && <span className="cn-cover__initials">{initials(title)}</span>}
    </span>
  );
}

function initials(name: string) {
  const words = name.replace(/^the\s+/i, "").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

export interface MusicCardProps {
  title: string;
  subtitle?: ReactNode;
  cover: ReactNode;
  onClick: () => void;
  /**
   * Plays straight from the card, from a button on the cover.
   */
  onPlay?: () => void;
  round?: boolean;
  className?: string;
}

/**
 * A cover with a title underneath, for albums, artists and playlists.
 */
export default function MusicCard(props: MusicCardProps) {
  const { title, subtitle, cover, onClick, onPlay, round = false, className } = props;
  function play(e: MouseEvent) {
    e.stopPropagation();
    onPlay?.();
  }
  return (
    <div className={cx("cn-music-card", round && "cn-music-card--round", className)}>
      <button type="button" className="cn-music-card__button" onClick={onClick} aria-label={title}>
        {cover}
      </button>
      {onPlay && (
        <button type="button" className="cn-music-card__play" onClick={play} aria-label={t("music.card.play", { title })} tabIndex={-1}>
          <Play />
        </button>
      )}
      <div className="cn-music-card__meta">
        <span className="cn-music-card__title" title={title}>{title}</span>
        {subtitle && <span className="cn-music-card__sub">{subtitle}</span>}
      </div>
    </div>
  );
}

/**
 * Play an album from the start.
 */
export async function playAlbum(albumId: number, opts?: { shuffle?: boolean }) {
  try {
    const album = await MusicApi.album(albumId);
    musicPlayer.play(album.tracks, 0, opts);
  } catch (error) {
    toasts.error(t("music.card.playAlbumFailed"), (error as Error).message);
  }
}

export function AlbumCard(props: { album: AlbumSummary; subtitle?: string }) {
  const { album, subtitle } = props;
  return (
    <MusicCard
      title={album.title}
      subtitle={subtitle ?? [album.artistName, album.year].filter(Boolean).join(t("common.dotSeparator"))}
      cover={<Cover image={album.cover} title={album.title} />}
      onClick={() => router.navigate(`/album/${album.id}`)}
      onPlay={() => playAlbum(album.id)}
    />
  );
}

export function ArtistCard(props: { artist: ArtistSummary }) {
  const { artist } = props;
  return (
    <MusicCard
      round
      title={artist.name}
      subtitle={t("music.albumCount", { count: artist.albumCount })}
      cover={<Cover image={artist.image} title={artist.name} round />}
      onClick={() => router.navigate(`/artist/${artist.id}`)}
    />
  );
}

export function PlaylistCard(props: { playlist: PlaylistSummary }) {
  const { playlist } = props;
  return (
    <MusicCard
      title={playlist.name}
      subtitle={t("music.trackCount", { count: playlist.trackCount })}
      cover={<Cover image={null} mosaic={playlist.covers} title={playlist.name} />}
      onClick={() => router.navigate(`/playlist/${playlist.id}`)}
    />
  );
}
