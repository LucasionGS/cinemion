import { useEffect, useState } from "react";
import { Search as SearchIcon, X } from "lucide-react";
import type { SearchResults } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { router } from "../../lib/Router.tsx";
import useController from "../../lib/useController.ts";
import { t } from "../../i18n/I18n.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import PosterCard from "../../components/PosterCard/PosterCard.tsx";
import WideCard from "../../components/WideCard/WideCard.tsx";
import ClipCard from "../../components/ClipCard/ClipCard.tsx";
import PhotoAlbumCard from "../../components/PhotoAlbumCard/PhotoAlbumCard.tsx";
import PersonCard from "../../components/PersonCard/PersonCard.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import TrackList from "../../components/TrackList/TrackList.tsx";
import { AlbumCard, ArtistCard } from "../../components/MusicCard/MusicCard.tsx";
import BookCard from "../../components/BookCard/BookCard.tsx";
import "./Search.scss";

/**
 * Find movies, shows, episodes, videos, people, collections and music as you type.
 */
export default function Search() {
  const { query: params } = useController(router);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);

  // Wait for a pause in typing, and keep the query in the address so Back returns to it
  useEffect(() => {
    const q = query.trim();
    const timer = setTimeout(async () => {
      router.navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search", { replace: true });
      if (q.length < 2) {
        setResults(null);
        return;
      }
      setLoading(true);
      try {
        setResults(await ItemsApi.search(q));
      } catch {
        setResults({ titles: [], episodes: [], videos: [], photoAlbums: [], games: [], people: [], collections: [], artists: [], albums: [], tracks: [], books: [] });
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const empty = results && [results.titles, results.episodes, results.videos, results.photoAlbums, results.games, results.people, results.collections, results.artists, results.albums, results.tracks, results.books].every((list) => list.length === 0);

  return (
    <AppShell>
      <div className="cn-search">
        <label className="cn-search__box">
          <SearchIcon aria-hidden="true" />
          <span className="cn-visually-hidden">{t("common.search")}</span>
          <input type="search" autoFocus data-autofocus placeholder={t("search.placeholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
          {loading && <Spinner size="1.25rem" />}
          {query && !loading && (
            <button type="button" className="cn-search__clear" aria-label={t("search.clear")} onClick={() => setQuery("")}><X /></button>
          )}
        </label>

        {empty && <p className="cn-search__none">{t("search.nothingFound", { query: query.trim() })}</p>}

        {results && results.titles.length > 0 && (
          <section className="cn-search__section">
            <h2>{t("search.titles")}</h2>
            <div className="cn-search__grid">
              {results.titles.map((item) => <PosterCard key={item.id} item={item} />)}
            </div>
          </section>
        )}

        {results && results.collections.length > 0 && (
          <section className="cn-search__section">
            <h2>{t("search.collections")}</h2>
            <div className="cn-search__grid">
              {results.collections.map((c) => <PosterCard key={c.id} item={{ ...c, type: "collection" }} />)}
            </div>
          </section>
        )}

        {results && results.episodes.length > 0 && (
          <section className="cn-search__section">
            <h2>{t("search.episodes")}</h2>
            <div className="cn-search__episodes">
              {results.episodes.map((item) => <WideCard key={item.id} item={item} />)}
            </div>
          </section>
        )}

        {results && results.videos.length > 0 && (
          <section className="cn-search__section">
            <h2>{t("search.videos")}</h2>
            <div className="cn-search__episodes">
              {results.videos.map((item) => item.clip ? <ClipCard key={item.id} item={item} /> : <WideCard key={item.id} item={item} variant="video" />)}
            </div>
          </section>
        )}

        {results && results.games.length > 0 && (
          <section className="cn-search__section">
            <h2>{t("search.games")}</h2>
            <div className="cn-search__grid">
              {results.games.map((game) => <PosterCard key={game.id} item={game} subtitle={t("search.clips", { count: game.childCount })} />)}
            </div>
          </section>
        )}

        {results && results.photoAlbums.length > 0 && (
          <section className="cn-search__section">
            <h2>{t("search.photoAlbums")}</h2>
            <div className="cn-search__episodes">
              {results.photoAlbums.map((album) => <PhotoAlbumCard key={`${album.kind}-${album.id}`} album={album} />)}
            </div>
          </section>
        )}

        {results && results.artists.length > 0 && (
          <section className="cn-search__section">
            <h2>{t("search.artists")}</h2>
            <div className="cn-search__grid">
              {results.artists.map((a) => <ArtistCard key={a.id} artist={a} />)}
            </div>
          </section>
        )}

        {results && results.albums.length > 0 && (
          <section className="cn-search__section">
            <h2>{t("search.albums")}</h2>
            <div className="cn-search__grid">
              {results.albums.map((a) => <AlbumCard key={a.id} album={a} />)}
            </div>
          </section>
        )}

        {results && results.tracks.length > 0 && (
          <section className="cn-search__section">
            <h2>{t("search.songs")}</h2>
            <TrackList tracks={results.tracks} label={t("search.songs")} />
          </section>
        )}

        {results && results.books.length > 0 && (
          <section className="cn-search__section">
            <h2>{t("search.books")}</h2>
            <div className="cn-search__grid">
              {results.books.map((b) => <BookCard key={b.id} book={b} />)}
            </div>
          </section>
        )}

        {results && results.people.length > 0 && (
          <section className="cn-search__section">
            <h2>{t("search.people")}</h2>
            <div className="cn-search__people">
              {results.people.map((p) => <PersonCard key={p.id} person={p} />)}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
