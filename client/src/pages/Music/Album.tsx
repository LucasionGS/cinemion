import { useEffect, useState } from "react";
import { ListEnd, ListPlus, Play, Shuffle } from "lucide-react";
import type { AlbumDetail } from "@shared/music.ts";
import MusicApi from "../../Api/MusicApi.ts";
import { musicPlayer } from "../../lib/MusicPlayer.ts";
import { applyAmbient } from "../../lib/ambient.ts";
import { Link } from "../../lib/Router.tsx";
import { formatDuration } from "../../lib/playback.ts";
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
        {error && <section className="cn-music__empty"><h2>Album not found</h2><p>{error}</p></section>}
        {!album && !error && <div className="cn-music__loading"><Spinner size="2rem" /></div>}
        {album && (
          <>
            <MusicHeader
              cover={<Cover image={album.cover} title={album.title} width={500} />}
              eyebrow="Album"
              title={album.title}
              meta={
                <>
                  {album.artistId ? <Link href={`/artist/${album.artistId}`}>{album.artistName}</Link> : <span>{album.artistName}</span>}
                  <span aria-hidden="true">·</span>
                  <span>{[album.year, `${album.trackCount} ${album.trackCount === 1 ? "track" : "tracks"}`, formatDuration(album.duration), album.genres.join(", ")].filter(Boolean).join(" · ")}</span>
                </>
              }
              actions={
                <>
                  <Button variant="primary" icon={<Play />} onClick={() => musicPlayer.play(album.tracks)} data-autofocus>Play</Button>
                  <Button variant="secondary" icon={<Shuffle />} onClick={() => musicPlayer.play(album.tracks, 0, { shuffle: true })}>Shuffle</Button>
                  <IconButton label="Add to queue" icon={<ListEnd />} onClick={() => musicPlayer.addToQueue(album.tracks)} />
                  <IconButton label="Add to playlist" icon={<ListPlus />} onClick={() => addToPlaylist.show(album.tracks.map((t) => t.id))} />
                </>
              }
            />
            <TrackList tracks={album.tracks} variant="album" label={`Tracks of ${album.title}`} />
            {album.moreByArtist.length > 0 && (
              <Row title={`More by ${album.artistName}`} kind="square" href={album.artistId ? `/artist/${album.artistId}` : undefined}>
                {album.moreByArtist.map((a) => <AlbumCard key={a.id} album={a} subtitle={a.year ? String(a.year) : ""} />)}
              </Row>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
