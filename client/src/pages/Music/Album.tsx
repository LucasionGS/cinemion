import { useEffect, useState } from "react";
import { ListEnd, ListPlus, Play, Shuffle } from "lucide-react";
import type { AlbumDetail } from "@shared/music.ts";
import MusicApi from "../../Api/MusicApi.ts";
import { musicPlayer } from "../../lib/MusicPlayer.ts";
import { applyAmbient } from "../../lib/ambient.ts";
import { Link } from "../../lib/Router.tsx";
import { formatDuration } from "../../lib/playback.ts";
import { t } from "../../i18n/I18n.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import Row from "../../components/Row/Row.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import TrackList from "../../components/TrackList/TrackList.tsx";
import { AlbumCard, Cover } from "../../components/MusicCard/MusicCard.tsx";
import { addToPlaylist } from "../../components/AddToPlaylist/AddToPlaylist.tsx";
import MusicHeader from "./MusicHeader.tsx";
import "./Music.scss";

export interface AlbumProps {
  id: number;
}

/**
 * An album: its cover and tracks, and more by the same artist.
 */
export default function Album(props: AlbumProps) {
  const { id } = props;
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    MusicApi.album(id).then(setAlbum).catch((e) => setError((e as Error).message));
  }, [id]);

  useEffect(() => {
    if (album) applyAmbient(album.palette);
    return () => applyAmbient(null);
  }, [album]);

  return (
    <AppShell>
      <div className="cn-music">
        {error && <section className="cn-music__empty"><h2>{t("music.album.notFound")}</h2><p>{error}</p></section>}
        {!album && !error && <div className="cn-music__loading"><Spinner size="2rem" /></div>}
        {album && (
          <>
            <MusicHeader
              cover={<Cover image={album.cover} title={album.title} width={500} />}
              eyebrow={t("music.album.eyebrow")}
              title={album.title}
              meta={
                <>
                  {album.artistId ? <Link href={`/artist/${album.artistId}`}>{album.artistName}</Link> : <span>{album.artistName}</span>}
                  <span aria-hidden="true">·</span>
                  <span>{[album.year, t("music.trackCount", { count: album.trackCount }), formatDuration(album.duration), album.genres.join(t("common.listSeparator"))].filter(Boolean).join(t("common.dotSeparator"))}</span>
                </>
              }
              actions={
                <>
                  <Button variant="primary" icon={<Play />} onClick={() => musicPlayer.play(album.tracks)} data-autofocus>{t("common.play")}</Button>
                  <Button variant="secondary" icon={<Shuffle />} onClick={() => musicPlayer.play(album.tracks, 0, { shuffle: true })}>{t("music.actions.shuffle")}</Button>
                  <IconButton label={t("music.actions.addToQueue")} icon={<ListEnd />} onClick={() => musicPlayer.addToQueue(album.tracks)} />
                  <IconButton label={t("music.actions.addToPlaylist")} icon={<ListPlus />} onClick={() => addToPlaylist.show(album.tracks.map((track) => track.id))} />
                </>
              }
            />
            <TrackList tracks={album.tracks} variant="album" label={t("music.album.tracksOf", { title: album.title })} />
            {album.moreByArtist.length > 0 && (
              <Row title={t("music.album.moreBy", { artist: album.artistName })} kind="square" href={album.artistId ? `/artist/${album.artistId}` : undefined}>
                {album.moreByArtist.map((a) => <AlbumCard key={a.id} album={a} subtitle={a.year ? String(a.year) : ""} />)}
              </Row>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
