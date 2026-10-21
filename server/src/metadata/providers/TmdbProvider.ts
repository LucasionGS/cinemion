import type { ItemType, MatchCandidate } from "@shared/media.ts";
import type { MetadataSettings } from "@shared/api.ts";
import MetadataProvider from "../MetadataProvider.ts";
import { Setting } from "../../models/index.ts";
import BuiltInKeys from "../BuiltInKeys.ts";
import log from "../../lib/Logger.ts";

const API = "https://api.themoviedb.org/3";
const IMAGES = "https://image.tmdb.org/t/p";
const MAX_CAST = 20;

interface TmdbSearchResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  popularity?: number;
}

interface TmdbCredit {
  id: number;
  name: string;
  character?: string;
  job?: string;
  order?: number;
  profile_path?: string | null;
}

interface TmdbImage {
  file_path: string;
  iso_639_1: string | null;
  vote_average: number;
}

/**
 * TheMovieDB: details, artwork and cast for movies and shows. Uses the API key (v3 key or v4 read token) from Settings,
 * then `TMDB_API_KEY`, then the key built into Cinemion.
 */
export class TmdbProvider extends MetadataProvider {
  public readonly id = "tmdb";
  public readonly name = "TMDB";

  // Collections are shared by several movies; fetch each one once per run of the server
  private _collections = new Map<string, Promise<MetadataProvider.CollectionMetadata | null>>();

  private async settings(): Promise<MetadataSettings> {
    // Settings saved by older versions miss the newer keys
    const stored = await Setting.get<Partial<MetadataSettings> | null>(Setting.Keys.METADATA, null);
    return { tmdbApiKey: null, tvdbApiKey: null, tvdbPin: null, omdbApiKey: null, language: "en", country: "US", providers: [], ...stored };
  }

  /**
   * The key to use, and whether it's the built-in one. `null` when there's none at all.
   */
  private async apiKey(): Promise<{ key: string; isBuiltIn: boolean } | null> {
    const own = (await this.settings()).tmdbApiKey || Deno.env.get("TMDB_API_KEY");
    if (own) return { key: own, isBuiltIn: false };
    return BuiltInKeys.TMDB ? { key: BuiltInKeys.TMDB, isBuiltIn: true } : null;
  }

  public override async isAvailable() {
    return !!(await this.apiKey());
  }

  /**
   * Call the TMDB API, waiting and retrying when rate limited.
   * @throws When the request fails for another reason.
   */
  private async request<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const found = await this.apiKey();
    if (!found) throw new Error("TMDB needs an API key. Add one in Settings › Metadata.");
    const { key, isBuiltIn } = found;
    const url = new URL(API + path);
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(name, String(value));
    }
    // v4 read tokens are JWTs and go in the header; v3 keys go in the query
    const headers: Record<string, string> = { Accept: "application/json" };
    if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
    else url.searchParams.set("api_key", key);

    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (res.status === 429) {
        const wait = Number(res.headers.get("Retry-After") ?? 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 10_000)));
        continue;
      }
      if (res.status === 401) {
        throw new Error(isBuiltIn
          ? "TMDB rejected the key built into Cinemion. Update Cinemion, or add your own key in Settings › Metadata."
          : "TMDB rejected the API key. Check it in Settings › Metadata.");
      }
      if (!res.ok) throw new Error(`TMDB request failed: ${res.status} ${res.statusText}`);
      return await res.json() as T;
    }
    throw new Error("TMDB kept saying there were too many requests. Try again in a minute.");
  }

  private image(path: string | null | undefined, size: string) {
    return path ? { url: `${IMAGES}/${size}${path}` } : undefined;
  }

  private pickLogo(logos: TmdbImage[] | undefined, language: string) {
    // SVG logos can't be read by ffmpeg, so PNG only
    const usable = (logos ?? []).filter((l) => l.file_path.endsWith(".png"));
    const best = usable.find((l) => l.iso_639_1 === language) ?? usable.find((l) => l.iso_639_1 === "en") ?? usable.find((l) => !l.iso_639_1) ?? usable[0];
    return best ? this.image(best.file_path, "original") : undefined;
  }

  private credits(credits: { cast?: TmdbCredit[]; crew?: TmdbCredit[] } | undefined): MetadataProvider.CreditMetadata[] {
    const result: MetadataProvider.CreditMetadata[] = [];
    (credits?.cast ?? []).slice(0, MAX_CAST).forEach((c, i) => {
      result.push({ name: c.name, kind: "cast", character: c.character || null, order: c.order ?? i, tmdbId: String(c.id), photo: this.image(c.profile_path, "w185") ?? null });
    });
    const jobs: Record<string, MetadataProvider.CreditMetadata["kind"]> = {
      "Director": "director",
      "Screenplay": "writer",
      "Writer": "writer",
      "Creator": "writer",
      "Original Music Composer": "composer",
      "Producer": "producer",
    };
    const seen = new Set<string>();
    for (const c of credits?.crew ?? []) {
      const kind = c.job ? jobs[c.job] : undefined;
      if (!kind || seen.has(`${kind}:${c.id}`)) continue;
      seen.add(`${kind}:${c.id}`);
      result.push({ name: c.name, kind, order: result.length, tmdbId: String(c.id), photo: this.image(c.profile_path, "w185") ?? null });
    }
    return result;
  }

  //#region Matching

  private normalise(title: string) {
    return title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  }

  /**
   * Pick the result that matches the parsed title and year, or `null` when none is convincing.
   */
  private bestMatch(results: TmdbSearchResult[], title: string, year: number | null) {
    const wanted = this.normalise(title);
    let best: TmdbSearchResult | null = null;
    let bestScore = 0;
    results.slice(0, 10).forEach((r, i) => {
      const titles = [r.title, r.name, r.original_title, r.original_name].filter(Boolean).map((t) => this.normalise(t!));
      const resultYear = parseInt((r.release_date || r.first_air_date || "").slice(0, 4)) || null;
      let score = 0;
      if (titles.includes(wanted)) score += 3;
      else if (titles.some((t) => t.startsWith(wanted) || wanted.startsWith(t))) score += 1;
      if (year && resultYear) score += resultYear === year ? 2 : Math.abs(resultYear - year) === 1 ? 1 : -2;
      // Earlier (more popular) results break ties
      score -= i * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    });
    return bestScore >= 2.9 ? best : null;
  }

  private async findByExternalId(ids: MetadataProvider.MovieQuery["ids"], kind: "movie" | "tv") {
    const source = ids.imdb ? ["imdb_id", ids.imdb] : ids.tvdb ? ["tvdb_id", ids.tvdb] : null;
    if (!source) return null;
    const found = await this.request<{ movie_results: { id: number }[]; tv_results: { id: number }[] }>(`/find/${source[1]}`, { external_source: source[0] });
    const hit = kind === "movie" ? found.movie_results[0] : found.tv_results[0];
    return hit ? String(hit.id) : null;
  }

  //#endregion

  public override async movie(query: MetadataProvider.MovieQuery): Promise<MetadataProvider.ItemMetadata | null> {
    const { language, country } = await this.settings();
    let id = query.ids.tmdb ?? await this.findByExternalId(query.ids, "movie");
    if (!id) {
      const search = await this.request<{ results: TmdbSearchResult[] }>("/search/movie", { query: query.title, year: query.year ?? undefined, language });
      let match = this.bestMatch(search.results, query.title, query.year);
      // The year in a file name is sometimes off; try once without it
      if (!match && query.year) {
        const retry = await this.request<{ results: TmdbSearchResult[] }>("/search/movie", { query: query.title, language });
        match = this.bestMatch(retry.results, query.title, query.year);
      }
      if (!match) return null;
      id = String((match as TmdbSearchResult).id);
    }

    const movie = await this.request<{
      id: number;
      title: string;
      original_title: string;
      release_date: string;
      overview: string;
      tagline: string;
      runtime: number;
      vote_average: number;
      genres: { name: string }[];
      production_companies: { name: string }[];
      poster_path: string | null;
      backdrop_path: string | null;
      imdb_id: string | null;
      belongs_to_collection: { id: number; name: string } | null;
      credits: { cast: TmdbCredit[]; crew: TmdbCredit[] };
      release_dates: { results: { iso_3166_1: string; release_dates: { certification: string; type: number }[] }[] };
      images: { logos: TmdbImage[] };
    }>(`/movie/${id}`, { language, append_to_response: "credits,release_dates,images", include_image_language: `${language},en,null` });

    const certification = (code: string) => {
      const dates = movie.release_dates.results.find((r) => r.iso_3166_1 === code)?.release_dates ?? [];
      // Prefer the theatrical rating (type 3), then any
      return dates.find((d) => d.type === 3 && d.certification)?.certification ?? dates.find((d) => d.certification)?.certification ?? null;
    };

    return {
      title: movie.title,
      originalTitle: movie.original_title !== movie.title ? movie.original_title : null,
      year: movie.release_date ? parseInt(movie.release_date.slice(0, 4)) : null,
      overview: movie.overview || null,
      tagline: movie.tagline || null,
      runtime: movie.runtime || null,
      releaseDate: movie.release_date || null,
      rating: movie.vote_average ? Math.round(movie.vote_average * 10) / 10 : null,
      contentRating: certification(country) ?? certification("US"),
      genres: movie.genres.map((g) => g.name),
      studios: movie.production_companies.slice(0, 3).map((c) => c.name),
      ids: { tmdb: String(movie.id), ...(movie.imdb_id ? { imdb: movie.imdb_id } : {}) },
      artwork: {
        poster: this.image(movie.poster_path, "w780"),
        backdrop: this.image(movie.backdrop_path, "original"),
        logo: this.pickLogo(movie.images?.logos, language),
      },
      credits: this.credits(movie.credits),
      collection: movie.belongs_to_collection ? await this.collection(String(movie.belongs_to_collection.id), language) : null,
    };
  }

  private collection(id: string, language: string) {
    let pending = this._collections.get(id);
    if (!pending) {
      pending = this.request<{ id: number; name: string; overview: string; poster_path: string | null; backdrop_path: string | null }>(`/collection/${id}`, { language })
        .then((c) => ({
          name: c.name,
          tmdbId: String(c.id),
          overview: c.overview || null,
          artwork: { poster: this.image(c.poster_path, "w780"), backdrop: this.image(c.backdrop_path, "original") },
        }))
        .catch(() => null);
      this._collections.set(id, pending);
    }
    return pending;
  }

  public override async show(query: MetadataProvider.ShowQuery): Promise<MetadataProvider.ShowMetadata | null> {
    const { language, country } = await this.settings();
    let id = query.ids.tmdb ?? await this.findByExternalId(query.ids, "tv");
    if (!id) {
      const search = await this.request<{ results: TmdbSearchResult[] }>("/search/tv", { query: query.title, first_air_date_year: query.year ?? undefined, language });
      const match = this.bestMatch(search.results, query.title, query.year)
        ?? (query.year ? this.bestMatch((await this.request<{ results: TmdbSearchResult[] }>("/search/tv", { query: query.title, language })).results, query.title, query.year) : null);
      if (!match) return null;
      id = String((match as TmdbSearchResult).id);
    }

    const show = await this.request<{
      id: number;
      name: string;
      original_name: string;
      first_air_date: string;
      overview: string;
      tagline: string;
      episode_run_time: number[];
      vote_average: number;
      genres: { name: string }[];
      networks: { name: string }[];
      poster_path: string | null;
      backdrop_path: string | null;
      credits: { cast: TmdbCredit[]; crew: TmdbCredit[] };
      created_by: { id: number; name: string; profile_path: string | null }[];
      content_ratings: { results: { iso_3166_1: string; rating: string }[] };
      external_ids: { imdb_id: string | null; tvdb_id: number | null };
      images: { logos: TmdbImage[] };
    }>(`/tv/${id}`, { language, append_to_response: "credits,content_ratings,external_ids,images", include_image_language: `${language},en,null` });

    const seasons = new Map<number, MetadataProvider.SeasonMetadata>();
    for (const number of query.seasons.keys()) {
      try {
        const season = await this.request<{
          name: string;
          overview: string;
          air_date: string | null;
          poster_path: string | null;
          episodes: { episode_number: number; name: string; overview: string; air_date: string | null; runtime: number | null; vote_average: number; still_path: string | null }[];
        }>(`/tv/${id}/season/${number}`, { language });
        seasons.set(number, {
          title: season.name || null,
          overview: season.overview || null,
          releaseDate: season.air_date,
          year: season.air_date ? parseInt(season.air_date.slice(0, 4)) : null,
          artwork: { poster: this.image(season.poster_path, "w780") },
          episodes: new Map(season.episodes.map((e) => [e.episode_number, {
            title: e.name || null,
            overview: e.overview || null,
            releaseDate: e.air_date,
            year: e.air_date ? parseInt(e.air_date.slice(0, 4)) : null,
            runtime: e.runtime,
            rating: e.vote_average ? Math.round(e.vote_average * 10) / 10 : null,
            artwork: { thumb: this.image(e.still_path, "w780") },
          }])),
        });
      } catch (error) {
        // A season TMDB doesn't know (often specials) shouldn't stop the rest
        log.debug("TMDB has no data for a season", { show: show.name, season: number, error });
      }
    }

    const rating = (code: string) => show.content_ratings.results.find((r) => r.iso_3166_1 === code)?.rating || null;
    const credits = this.credits(show.credits);
    show.created_by.forEach((c) => credits.push({ name: c.name, kind: "writer", order: credits.length, tmdbId: String(c.id), photo: this.image(c.profile_path, "w185") ?? null }));

    return {
      title: show.name,
      originalTitle: show.original_name !== show.name ? show.original_name : null,
      year: show.first_air_date ? parseInt(show.first_air_date.slice(0, 4)) : null,
      overview: show.overview || null,
      tagline: show.tagline || null,
      runtime: show.episode_run_time[0] ?? null,
      releaseDate: show.first_air_date || null,
      rating: show.vote_average ? Math.round(show.vote_average * 10) / 10 : null,
      contentRating: rating(country) ?? rating("US"),
      genres: show.genres.map((g) => g.name),
      studios: show.networks.slice(0, 3).map((n) => n.name),
      ids: {
        tmdb: String(show.id),
        ...(show.external_ids.imdb_id ? { imdb: show.external_ids.imdb_id } : {}),
        ...(show.external_ids.tvdb_id ? { tvdb: String(show.external_ids.tvdb_id) } : {}),
      },
      artwork: {
        poster: this.image(show.poster_path, "w780"),
        backdrop: this.image(show.backdrop_path, "original"),
        logo: this.pickLogo(show.images?.logos, language),
      },
      credits,
      seasons,
    };
  }

  public override async search(type: Extract<ItemType, "movie" | "show">, query: string, year: number | null): Promise<MatchCandidate[]> {
    const { language } = await this.settings();
    const results = type === "movie"
      ? (await this.request<{ results: TmdbSearchResult[] }>("/search/movie", { query, year: year ?? undefined, language })).results
      : (await this.request<{ results: TmdbSearchResult[] }>("/search/tv", { query, first_air_date_year: year ?? undefined, language })).results;
    return results.slice(0, 12).map((r) => {
      const date = r.release_date || r.first_air_date || "";
      return {
        provider: this.id,
        id: String(r.id),
        title: (r.title ?? r.name)!,
        year: date ? parseInt(date.slice(0, 4)) : null,
        overview: r.overview || null,
        posterUrl: r.poster_path ? `${IMAGES}/w342${r.poster_path}` : null,
      };
    });
  }
}

export default TmdbProvider;
