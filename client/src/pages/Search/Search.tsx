import { useEffect, useState } from "react";
import { Search as SearchIcon, X } from "lucide-react";
import type { SearchResults } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { router } from "../../lib/Router.tsx";
import useController from "../../lib/useController.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import PosterCard from "../../components/PosterCard/PosterCard.tsx";
import WideCard from "../../components/WideCard/WideCard.tsx";
import PersonCard from "../../components/PersonCard/PersonCard.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import "./Search.scss";

/**
 * Find movies, shows, episodes, people and collections as you type.
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
        setResults({ titles: [], episodes: [], videos: [], people: [], collections: [] });
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const empty = results && !results.titles.length && !results.episodes.length && !results.videos.length && !results.people.length && !results.collections.length;

  return (
    <AppShell>
      <div className="cn-search">
        <label className="cn-search__box">
          <SearchIcon aria-hidden="true" />
          <span className="cn-visually-hidden">Search</span>
          <input type="search" autoFocus data-autofocus placeholder="Movies, shows, episodes, videos and people" value={query} onChange={(e) => setQuery(e.target.value)} />
          {loading && <Spinner size="1.25rem" />}
          {query && !loading && (
            <button type="button" className="cn-search__clear" aria-label="Clear" onClick={() => setQuery("")}><X /></button>
          )}
        </label>

        {empty && <p className="cn-search__none">Nothing found for "{query.trim()}".</p>}

        {results && results.titles.length > 0 && (
          <section className="cn-search__section">
            <h2>Movies &amp; shows</h2>
            <div className="cn-search__grid">
              {results.titles.map((item) => <PosterCard key={item.id} item={item} />)}
            </div>
          </section>
        )}

        {results && results.collections.length > 0 && (
          <section className="cn-search__section">
            <h2>Collections</h2>
            <div className="cn-search__grid">
              {results.collections.map((c) => <PosterCard key={c.id} item={{ ...c, type: "collection" }} />)}
            </div>
          </section>
        )}

        {results && results.episodes.length > 0 && (
          <section className="cn-search__section">
            <h2>Episodes</h2>
            <div className="cn-search__episodes">
              {results.episodes.map((item) => <WideCard key={item.id} item={item} />)}
            </div>
          </section>
        )}

        {results && results.videos.length > 0 && (
          <section className="cn-search__section">
            <h2>Videos</h2>
            <div className="cn-search__episodes">
              {results.videos.map((item) => <WideCard key={item.id} item={item} variant="video" />)}
            </div>
          </section>
        )}

        {results && results.people.length > 0 && (
          <section className="cn-search__section">
            <h2>People</h2>
            <div className="cn-search__people">
              {results.people.map((p) => <PersonCard key={p.id} person={p} />)}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
