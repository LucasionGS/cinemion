import { useCallback, useEffect, useState } from "react";
import { Plus, Shuffle } from "lucide-react";
import type { LibraryInfo } from "@shared/api.ts";
import type { AlbumSummary, ArtistSummary, MusicOverview, MusicSort, PlaylistSummary, TrackInfo } from "@shared/music.ts";
import MusicApi from "../../Api/MusicApi.ts";
import PlaylistsApi from "../../Api/PlaylistsApi.ts";
import { musicPlayer } from "../../lib/MusicPlayer.ts";
import { router } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import useController from "../../lib/useController.ts";
import usePaged from "../../lib/usePaged.ts";
import Button from "../../components/Button/Button.tsx";
import Row from "../../components/Row/Row.tsx";
import Select from "../../components/Select/Select.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import TrackList from "../../components/TrackList/TrackList.tsx";
import { AlbumCard, ArtistCard, PlaylistCard } from "../../components/MusicCard/MusicCard.tsx";
import { addToPlaylist } from "../../components/AddToPlaylist/AddToPlaylist.tsx";
import "./Music.scss";

type Tab = "albums" | "artists" | "songs" | "playlists";

const SORTS: { value: MusicSort; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "added", label: "Recently added" },
  { value: "year", label: "Release year" },
];

export interface MusicLibraryProps {
  library: LibraryInfo;
}

/**
 * A Music library: albums, artists and every song, plus the profile's playlists. Shown by the library page.
 */
export default function MusicLibrary(props: MusicLibraryProps) {
  const { library } = props;
  const { query } = useController(router);
  const tab = (["albums", "artists", "songs", "playlists"].includes(query.get("tab") ?? "") ? query.get("tab") : "albums") as Tab;

  async function shuffleAll() {
    try {
      musicPlayer.play(await MusicApi.shuffle(library.id), 0);
    } catch (error) {
      toasts.error("Couldn't shuffle", (error as Error).message);
    }
  }

  return (
    <div className="cn-music">
      <header className="cn-library__header">
        <div>
          <h1>{library.name}</h1>
          <p>{library.itemCount} {library.itemCount === 1 ? "album" : "albums"}{library.scan && " · Scanning…"}</p>
        </div>
        <div className="cn-music__filters">
          <SegmentedControl<Tab>
            label="Show"
            value={tab}
            onChange={(value) => router.navigate(`/library/${library.id}${value === "albums" ? "" : `?tab=${value}`}`, { replace: true })}
            options={[
              { value: "albums", label: "Albums" },
              { value: "artists", label: "Artists" },
              { value: "songs", label: "Songs" },
              { value: "playlists", label: "Playlists" },
            ]}
          />
          <Button variant="secondary" icon={<Shuffle />} onClick={shuffleAll} disabled={library.itemCount === 0}>Shuffle all</Button>
        </div>
      </header>

      {library.itemCount === 0 && tab !== "playlists" && (
        <section className="cn-music__empty">
          <h2>Nothing in here yet</h2>
          <p>{library.scan ? "Cinemion is scanning this library right now. Albums appear as they're found." : `Music from ${library.paths.join(", ")} appears here after a scan. Tags are read from the files; without them, folders like Artist/Album/01 Title.mp3 work too.`}</p>
        </section>
      )}
      {library.itemCount > 0 && tab === "albums" && <Albums libraryId={library.id} />}
      {library.itemCount > 0 && tab === "artists" && <Artists libraryId={library.id} />}
      {library.itemCount > 0 && tab === "songs" && <Songs libraryId={library.id} />}
      {tab === "playlists" && <Playlists />}
    </div>
  );
}

function Albums(props: { libraryId: number }) {
  const { libraryId } = props;
  const [sort, setSort] = useState<MusicSort>("title");
  const [genre, setGenre] = useState<string | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [overview, setOverview] = useState<MusicOverview | null>(null);
  const load = useCallback((offset: number) => MusicApi.albums(libraryId, { sort, genre, offset }), [libraryId, sort, genre]);
  const { items, sentinel, loading } = usePaged<AlbumSummary>(load);

  useEffect(() => {
    MusicApi.genres(libraryId).then(setGenres).catch(() => setGenres([]));
    MusicApi.overview(libraryId).then(setOverview).catch(() => setOverview(null));
  }, [libraryId]);

  return (
    <>
      {overview && overview.recentlyPlayed.length > 0 && !genre && (
        <Row title="Played lately" kind="square">
          {overview.recentlyPlayed.map((a) => <AlbumCard key={a.id} album={a} />)}
        </Row>
      )}
      <div className="cn-music__section">
        <div className="cn-music__toolbar">
          <h2>All albums</h2>
          <div className="cn-music__filters">
            {genres.length > 0 && (
              <Select
                label="Genre"
                value={genre ?? ""}
                options={[{ value: "", label: "All genres" }, ...genres.map((g) => ({ value: g, label: g }))]}
                onChange={(e) => setGenre(e.target.value || null)}
                className="cn-music__select"
              />
            )}
            <Select label="Sort by" value={sort} options={SORTS} onChange={(e) => setSort(e.target.value as MusicSort)} className="cn-music__select" />
          </div>
        </div>
        <div className="cn-music__grid">
          {items?.map((a) => <AlbumCard key={a.id} album={a} subtitle={sort === "year" ? [a.year, a.artistName].filter(Boolean).join(" · ") : undefined} />)}
        </div>
        <div ref={sentinel} />
        {loading && <div className="cn-music__loading"><Spinner size="2rem" /></div>}
      </div>
    </>
  );
}

function Artists(props: { libraryId: number }) {
  const { libraryId } = props;
  const load = useCallback((offset: number) => MusicApi.artists(libraryId, offset), [libraryId]);
  const { items, sentinel, loading } = usePaged<ArtistSummary>(load);
  return (
    <div className="cn-music__section">
      <div className="cn-music__grid">
        {items?.map((a) => <ArtistCard key={a.id} artist={a} />)}
      </div>
      <div ref={sentinel} />
      {loading && <div className="cn-music__loading"><Spinner size="2rem" /></div>}
    </div>
  );
}

function Songs(props: { libraryId: number }) {
  const { libraryId } = props;
  const [sort, setSort] = useState<MusicSort>("title");
  const load = useCallback((offset: number) => MusicApi.tracks(libraryId, { sort, offset }), [libraryId, sort]);
  const { items, total, sentinel, loading } = usePaged<TrackInfo>(load);
  return (
    <div className="cn-music__section">
      <div className="cn-music__toolbar">
        <h2>{total ?? ""} {total === 1 ? "song" : "songs"}</h2>
        <Select label="Sort by" value={sort} options={[{ value: "title", label: "Title" }, { value: "added", label: "Recently added" }]} onChange={(e) => setSort(e.target.value as MusicSort)} className="cn-music__select" />
      </div>
      {items && <TrackList tracks={items} label="Songs" />}
      <div ref={sentinel} />
      {loading && <div className="cn-music__loading"><Spinner size="2rem" /></div>}
    </div>
  );
}

function Playlists() {
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const { changes } = useController(addToPlaylist);

  useEffect(() => {
    PlaylistsApi.list().then(setPlaylists).catch(() => setPlaylists([]));
  }, [changes]);

  async function create() {
    try {
      const playlist = await PlaylistsApi.create(`Playlist ${(playlists?.length ?? 0) + 1}`);
      router.navigate(`/playlist/${playlist.id}`);
    } catch (error) {
      toasts.error("Couldn't make the playlist", (error as Error).message);
    }
  }

  return (
    <div className="cn-music__section">
      <div className="cn-music__toolbar">
        <h2>Your playlists</h2>
        <Button variant="secondary" icon={<Plus />} onClick={create}>New playlist</Button>
      </div>
      {playlists && playlists.length === 0 && (
        <section className="cn-music__empty">
          <p>No playlists yet. Make one here, or pick "Add to playlist" in a track's menu.</p>
        </section>
      )}
      <div className="cn-music__grid">
        {playlists?.map((p) => <PlaylistCard key={p.id} playlist={p} />)}
      </div>
    </div>
  );
}
