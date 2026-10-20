import { useEffect, useState } from "react";
import { Play, Shuffle } from "lucide-react";
import type { ArtistDetail } from "@shared/music.ts";
import MusicApi from "../../Api/MusicApi.ts";
import { musicPlayer } from "../../lib/MusicPlayer.ts";
import { applyAmbient } from "../../lib/ambient.ts";
import { toasts } from "../../lib/Toasts.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import Button from "../../components/Button/Button.tsx";
import Row from "../../components/Row/Row.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import TrackList from "../../components/TrackList/TrackList.tsx";
import { AlbumCard, Cover } from "../../components/MusicCard/MusicCard.tsx";
import MusicHeader from "./MusicHeader.tsx";
import "./Music.scss";

export interface ArtistProps {
  id: number;
}

/**
 * An artist: their albums, the tracks the profile plays most, and albums they appear on.
 */
export default function Artist(props: ArtistProps) {
  const { id } = props;
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    MusicApi.artist(id).then(setArtist).catch((e) => setError((e as Error).message));
  }, [id]);

  useEffect(() => {
    if (artist) applyAmbient(artist.palette);
    return () => applyAmbient(null);
  }, [artist]);

  async function playAll(shuffle: boolean) {
    try {
      musicPlayer.play(await MusicApi.artistTracks(id), 0, { shuffle });
    } catch (e) {
      toasts.error("Couldn't play the artist", (e as Error).message);
    }
  }

  return (
    <AppShell>
      <div className="cn-music">
        {error && <section className="cn-music__empty"><h2>Artist not found</h2><p>{error}</p></section>}
        {!artist && !error && <div className="cn-music__loading"><Spinner size="2rem" /></div>}
        {artist && (
          <>
            <MusicHeader
              cover={<Cover image={artist.image} title={artist.name} round width={500} />}
              eyebrow="Artist"
              title={artist.name}
              meta={<span>{artist.albumCount} {artist.albumCount === 1 ? "album" : "albums"}{artist.appearsOn.length > 0 && ` · on ${artist.appearsOn.length} more`}</span>}
              actions={
                <>
                  <Button variant="primary" icon={<Play />} onClick={() => playAll(false)} disabled={artist.albumCount === 0} data-autofocus>Play</Button>
                  <Button variant="secondary" icon={<Shuffle />} onClick={() => playAll(true)} disabled={artist.albumCount === 0}>Shuffle</Button>
                </>
              }
            />
            {artist.topTracks.length > 0 && (
              <section className="cn-music__section">
                <h2>You play these most</h2>
                <TrackList tracks={artist.topTracks} label="Most played" />
              </section>
            )}
            {artist.albums.length > 0 && (
              <section className="cn-music__section">
                <h2>Albums</h2>
                <div className="cn-music__grid">
                  {artist.albums.map((a) => <AlbumCard key={a.id} album={a} subtitle={a.year ? String(a.year) : `${a.trackCount} tracks`} />)}
                </div>
              </section>
            )}
            {artist.appearsOn.length > 0 && (
              <Row title="Appears on" kind="square">
                {artist.appearsOn.map((a) => <AlbumCard key={a.id} album={a} />)}
              </Row>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
