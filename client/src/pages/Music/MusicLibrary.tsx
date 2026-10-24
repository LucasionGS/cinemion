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
import { t, type TranslationKey } from "../../i18n/I18n.ts";
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

const SORTS: { value: MusicSort; label: TranslationKey }[] = [
  { value: "title", label: "music.library.sorts.title" },
  { value: "artist", label: "music.library.sorts.artist" },
  { value: "added", label: "music.library.sorts.added" },
  { value: "year", label: "music.library.sorts.year" },
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
      toasts.error(t("music.library.shuffleFailed"), (error as Error).message);
    }
  }

  return (
    <div className="cn-music">
      <header className="cn-library__header">
        <div>
          <h1>{library.name}</h1>
          <p>{t("music.albumCount", { count: library.itemCount })}{library.scan && `${t("common.dotSeparator")}${t("music.library.scanning")}`}</p>
        </div>
        <div className="cn-music__filters">
          <SegmentedControl<Tab>
            label={t("music.library.show")}
            value={tab}
            onChange={(value) => router.navigate(`/library/${library.id}${value === "albums" ? "" : `?tab=${value}`}`, { replace: true })}
            options={[
              { value: "albums", label: t("music.library.tabs.albums") },
              { value: "artists", label: t("music.library.tabs.artists") },
              { value: "songs", label: t("music.library.tabs.songs") },
              { value: "playlists", label: t("music.library.tabs.playlists") },
            ]}
          />
          <Button variant="secondary" icon={<Shuffle />} onClick={shuffleAll} disabled={library.itemCount === 0}>{t("music.library.shuffleAll")}</Button>
        </div>
      </header>

      {library.itemCount === 0 && tab !== "playlists" && (
        <section className="cn-music__empty">
          <h2>{t("music.library.emptyTitle")}</h2>
          <p>{library.scan ? t("music.library.scanningText") : t("music.library.emptyText", { paths: library.paths.join(t("common.listSeparator")) })}</p>
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
        <Row title={t("music.library.playedLately")} kind="square">
          {overview.recentlyPlayed.map((a) => <AlbumCard key={a.id} album={a} />)}
        </Row>
      )}
      <div className="cn-music__section">
        <div className="cn-music__toolbar">
          <h2>{t("music.library.allAlbums")}</h2>
          <div className="cn-music__filters">
            {genres.length > 0 && (
              <Select
                label={t("music.library.genre")}
                value={genre ?? ""}
                options={[{ value: "", label: t("music.library.allGenres") }, ...genres.map((g) => ({ value: g, label: g }))]}
                onChange={(e) => setGenre(e.target.value || null)}
                className="cn-music__select"
              />
            )}
            <Select label={t("music.library.sortBy")} value={sort} options={SORTS.map((s) => ({ value: s.value, label: t(s.label) }))} onChange={(e) => setSort(e.target.value as MusicSort)} className="cn-music__select" />
          </div>
        </div>
        <div className="cn-music__grid">
          {items?.map((a) => <AlbumCard key={a.id} album={a} subtitle={sort === "year" ? [a.year, a.artistName].filter(Boolean).join(t("common.dotSeparator")) : undefined} />)}
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
        <h2>{total !== null && t("music.library.songCount", { count: total })}</h2>
        <Select label={t("music.library.sortBy")} value={sort} options={[{ value: "title", label: t("music.library.sorts.title") }, { value: "added", label: t("music.library.sorts.added") }]} onChange={(e) => setSort(e.target.value as MusicSort)} className="cn-music__select" />
      </div>
      {items && <TrackList tracks={items} label={t("music.library.songs")} />}
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
      const playlist = await PlaylistsApi.create(t("music.library.newPlaylistName", { number: (playlists?.length ?? 0) + 1 }));
      router.navigate(`/playlist/${playlist.id}`);
    } catch (error) {
      toasts.error(t("music.library.makeFailed"), (error as Error).message);
    }
  }

  return (
    <div className="cn-music__section">
      <div className="cn-music__toolbar">
        <h2>{t("music.library.yourPlaylists")}</h2>
        <Button variant="secondary" icon={<Plus />} onClick={create}>{t("music.library.newPlaylist")}</Button>
      </div>
      {playlists && playlists.length === 0 && (
        <section className="cn-music__empty">
          <p>{t("music.library.noPlaylists")}</p>
        </section>
      )}
      <div className="cn-music__grid">
        {playlists?.map((p) => <PlaylistCard key={p.id} playlist={p} />)}
      </div>
    </div>
  );
}
