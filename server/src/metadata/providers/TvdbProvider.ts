import type { ExternalIds, ItemType, MatchCandidate } from "@shared/media.ts";
import type { MetadataSettings } from "@shared/api.ts";
import { findLanguage } from "@shared/languages.ts";
import MetadataProvider from "../MetadataProvider.ts";
import { Setting } from "../../models/index.ts";
import type MediaItem from "../../models/MediaItem.ts";

const API = Deno.env.get("TVDB_API_URL") || "https://api4.thetvdb.com/v4";
const MAX_CAST = 20;
// A login token lasts a month; log in again well before that
const TOKEN_LIFETIME = 20 * 24 * 60 * 60 * 1000;

// Artwork type ids for series
const POSTER = 2;
const BACKGROUND = 3;
const CLEAR_LOGO = 23;

// ISO 639-2 bibliographic codes, which TVDB doesn't use; it wants the terminology ones (deu, not ger)
const BIBLIOGRAPHIC = new Set(["ger", "fre", "dut", "chi", "cze", "gre", "per", "ice", "rum", "slo", "alb", "arm", "baq", "bur", "geo", "mac", "mao", "may", "tib", "wel"]);
// Countries as TVDB writes them in age ratings
const COUNTRIES: Record<string, string> = { US: "usa", GB: "gbr", NL: "nld", DE: "deu", FR: "fra", ES: "esp", IT: "ita", SE: "swe", DK: "dnk", NO: "nor", JP: "jpn", BE: "bel", CA: "can", AU: "aus" };

interface TvdbArtwork {
  image: string;
  language: string | null;
  type: number;
  score: number;
}

interface TvdbSeries {
  id: number;
  name: string;
  overview: string | null;
  firstAired: string | null;
  year: string | null;
  originalLanguage: string | null;
  averageRuntime: number | null;
  genres: { name: string }[] | null;
  artworks: TvdbArtwork[] | null;
  characters: { name: string | null; personName: string; personImgURL: string | null; image: string | null; peopleType: string; sort: number }[] | null;
  seasons: { number: number; type: { type: string }; image: string | null }[] | null;
  remoteIds: { id: string; sourceName: string }[] | null;
  contentRatings: { name: string; country: string }[] | null;
  originalNetwork: { name: string } | null;
  latestNetwork: { name: string } | null;
}

interface TvdbEpisode {
  seasonNumber: number;
  number: number;
  name: string | null;
  overview: string | null;
  aired: string | null;
  runtime: number | null;
  image: string | null;
}

interface TvdbSearchResult {
  tvdb_id: string;
  name: string;
  year?: string;
  overview?: string;
  image_url?: string;
  translations?: Record<string, string>;
  overviews?: Record<string, string>;
  aliases?: string[];
}

/**
 * TheTVDB: details, episodes and artwork for shows, especially good for anime and episode orders. Needs a project
 * API key; user-supported keys also need the subscriber's PIN. Movies are left to TMDB.
 */
export class TvdbProvider extends MetadataProvider {
  public readonly id = "tvdb";
  public readonly name = "TheTVDB";

  private _token: { value: string; key: string; expires: number } | null = null;

  private async settings(): Promise<MetadataSettings> {
    const stored = await Setting.get<Partial<MetadataSettings> | null>(Setting.Keys.METADATA, null);
    return { tmdbApiKey: null, tvdbApiKey: null, tvdbPin: null, omdbApiKey: null, language: "en", country: "US", providers: [], ...stored };
  }

  private async credentials() {
    const settings = await this.settings();
    const key = settings.tvdbApiKey || Deno.env.get("TVDB_API_KEY") || null;
    const pin = settings.tvdbPin || Deno.env.get("TVDB_PIN") || null;
    return key ? { key, pin } : null;
  }

  public override async isAvailable() {
    return !!(await this.credentials());
  }

  /**
   * A login token for the API, logging in when there's none or the key changed.
   * @throws When the key is missing or TVDB refuses it.
   */
  private async token(fresh = false) {
    const credentials = await this.credentials();
    if (!credentials) throw new Error("TheTVDB needs an API key. Add one in Settings › Metadata.");
    const cacheKey = `${credentials.key}:${credentials.pin ?? ""}`;
    if (!fresh && this._token && this._token.key === cacheKey && this._token.expires > Date.now()) return this._token.value;
    const res = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(credentials.pin ? { apikey: credentials.key, pin: credentials.pin } : { apikey: credentials.key }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401) throw new Error("TheTVDB rejected the API key (or the PIN). Check them in Settings › Metadata.");
    if (!res.ok) throw new Error(`TheTVDB sign-in failed: ${res.status} ${res.statusText}`);
    const body = await res.json() as { data?: { token?: string } };
    if (!body.data?.token) throw new Error("TheTVDB didn't send a sign-in token back.");
    this._token = { value: body.data.token, key: cacheKey, expires: Date.now() + TOKEN_LIFETIME };
    return this._token.value;
  }

  /**
   * Call the API and return its `data`. `null` for things that don't exist (404).
   * @throws When the request fails.
   */
  private async request<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T | null> {
    const url = new URL(API + path);
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(name, String(value));
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${await this.token(attempt > 0)}` }, signal: AbortSignal.timeout(20_000) });
      // An expired token: log in again once
      if (res.status === 401 && attempt === 0) continue;
      if (res.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(Number(res.headers.get("Retry-After") ?? 2) * 1000, 10_000)));
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`TheTVDB request failed: ${res.status} ${res.statusText}`);
      return (await res.json() as { data: T }).data;
    }
    throw new Error("TheTVDB kept refusing requests. Try again in a minute.");
  }

  /**
   * TVDB's three-letter code for a language setting like "en".
   */
  public static languageCode(language: string) {
    const aliases = findLanguage(language)?.aliases ?? [];
    return aliases.find((a) => /^[a-z]{3}$/.test(a) && !BIBLIOGRAPHIC.has(a)) ?? "eng";
  }

  private normalise(title: string) {
    return title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  }

  /**
   * The result that matches the parsed title and year, or `null` when none is convincing.
   */
  private bestMatch(results: TvdbSearchResult[], title: string, year: number | null) {
    const wanted = this.normalise(title);
    let best: TvdbSearchResult | null = null;
    let bestScore = 0;
    results.slice(0, 10).forEach((r, i) => {
      const titles = [r.name, ...Object.values(r.translations ?? {}), ...(r.aliases ?? [])].filter(Boolean).map((t) => this.normalise(t));
      const resultYear = Number(r.year) || null;
      let score = titles.includes(wanted) ? 3 : titles.some((t) => t.startsWith(wanted) || wanted.startsWith(t)) ? 1 : 0;
      if (year && resultYear) score += resultYear === year ? 2 : Math.abs(resultYear - year) === 1 ? 1 : -2;
      score -= i * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    });
    return bestScore >= 2.9 ? best as TvdbSearchResult | null : null;
  }

  private async findSeries(query: MetadataProvider.ShowQuery) {
    if (query.ids.tvdb) return query.ids.tvdb;
    if (query.ids.imdb) {
      const found = await this.request<{ series?: { id: number } }[]>(`/search/remoteid/${query.ids.imdb}`);
      const hit = found?.find((f) => f.series)?.series;
      if (hit) return String(hit.id);
    }
    const results = await this.request<TvdbSearchResult[]>("/search", { query: query.title, type: "series", year: query.year ?? undefined }) ?? [];
    let match = this.bestMatch(results, query.title, query.year);
    // The year in a folder name is sometimes off; try once without it
    if (!match && query.year) match = this.bestMatch(await this.request<TvdbSearchResult[]>("/search", { query: query.title, type: "series" }) ?? [], query.title, query.year);
    return match ? match.tvdb_id : null;
  }

  /**
   * The best picture of a type: in the chosen language, then without text, then English, then any; highest score first.
   */
  private pickArtwork(artworks: TvdbArtwork[] | null, type: number, language: string) {
    const ofType = (artworks ?? []).filter((a) => a.type === type && a.image).sort((a, b) => b.score - a.score);
    const best = ofType.find((a) => a.language === language) ?? ofType.find((a) => !a.language) ?? ofType.find((a) => a.language === "eng") ?? ofType[0];
    return best ? { url: best.image } : undefined;
  }

  public override movie(): Promise<MetadataProvider.ItemMetadata | null> {
    return Promise.resolve(null);
  }

  public override async show(query: MetadataProvider.ShowQuery): Promise<MetadataProvider.ShowMetadata | null> {
    const settings = await this.settings();
    const language = TvdbProvider.languageCode(settings.language);
    const id = await this.findSeries(query);
    if (!id) return null;

    const series = await this.request<TvdbSeries>(`/series/${id}/extended`);
    if (!series) return null;
    // Names and plots in the chosen language, when TVDB has them
    const translation = series.originalLanguage === language ? null : await this.request<{ name?: string; overview?: string }>(`/series/${id}/translations/${language}`).catch(() => null);

    // Every episode in aired order, in the chosen language when there's a translation
    const episodes: TvdbEpisode[] = [];
    for (let page = 0; page < 40; page++) {
      const result = await this.request<{ episodes: TvdbEpisode[] }>(`/series/${id}/episodes/default/${language}`, { page })
        ?? (page === 0 ? await this.request<{ episodes: TvdbEpisode[] }>(`/series/${id}/episodes/default`, { page }) : null);
      if (!result?.episodes?.length) break;
      episodes.push(...result.episodes);
      // Pages hold 500 episodes; a short one is the last
      if (result.episodes.length < 500) break;
    }

    const country = COUNTRIES[settings.country] ?? "usa";
    const rating = series.contentRatings?.find((r) => r.country === country) ?? series.contentRatings?.find((r) => r.country === "usa");
    const remote = (source: RegExp) => series.remoteIds?.find((r) => source.test(r.sourceName))?.id;

    const seasons = new Map<number, MetadataProvider.SeasonMetadata>();
    for (const season of series.seasons ?? []) {
      if (season.type?.type !== "official" || seasons.has(season.number)) continue;
      seasons.set(season.number, { artwork: season.image ? { poster: { url: season.image } } : undefined, episodes: new Map() });
    }
    for (const episode of episodes) {
      let season = seasons.get(episode.seasonNumber);
      if (!season) {
        season = { episodes: new Map() };
        seasons.set(episode.seasonNumber, season);
      }
      season.episodes.set(episode.number, {
        title: episode.name || null,
        overview: episode.overview || null,
        releaseDate: episode.aired || null,
        year: Number(episode.aired?.slice(0, 4)) || null,
        runtime: episode.runtime || null,
        artwork: episode.image ? { thumb: { url: episode.image } } : undefined,
      });
    }

    return {
      title: translation?.name || series.name,
      originalTitle: translation?.name && translation.name !== series.name ? series.name : null,
      year: Number(series.year ?? series.firstAired?.slice(0, 4)) || null,
      overview: translation?.overview || series.overview || null,
      releaseDate: series.firstAired || null,
      runtime: series.averageRuntime || null,
      contentRating: rating?.name ?? null,
      genres: (series.genres ?? []).map((g) => g.name),
      studios: [series.originalNetwork?.name ?? series.latestNetwork?.name].filter((n): n is string => !!n),
      ids: { tvdb: String(series.id), ...(remote(/^imdb/i) ? { imdb: remote(/^imdb/i) } : {}), ...(remote(/themoviedb/i) ? { tmdb: remote(/themoviedb/i) } : {}) },
      artwork: {
        poster: this.pickArtwork(series.artworks, POSTER, language),
        backdrop: this.pickArtwork(series.artworks, BACKGROUND, language),
        logo: this.pickArtwork(series.artworks, CLEAR_LOGO, language),
      },
      credits: (series.characters ?? [])
        .filter((c) => c.peopleType === "Actor" && c.personName)
        .sort((a, b) => a.sort - b.sort)
        .slice(0, MAX_CAST)
        .map((c, i) => ({ name: c.personName, kind: "cast" as const, character: c.name || null, order: i, photo: c.personImgURL ? { url: c.personImgURL } : null })),
      seasons,
    };
  }

  /**
   * Every season and episode of a show in aired order, for showing the episodes that aren't in the library. Specials
   * are left out.
   * @returns `null` when TheTVDB doesn't know the show.
   */
  public async episodeGuide(ids: ExternalIds): Promise<MediaItem.EpisodeGuide | null> {
    const language = TvdbProvider.languageCode((await this.settings()).language);
    // Only by id: a guess by name could list another show's episodes as missing
    let id = ids.tvdb ?? null;
    if (!id && ids.imdb) id = (await this.request<{ series?: { id: number } }[]>(`/search/remoteid/${ids.imdb}`))?.find((f) => f.series)?.series?.id.toString() ?? null;
    if (!id) return null;
    const bySeason = new Map<number, MediaItem.EpisodeGuide["seasons"][number]["episodes"]>();
    for (let page = 0; page < 40; page++) {
      const result = await this.request<{ episodes: TvdbEpisode[] }>(`/series/${id}/episodes/default/${language}`, { page })
        ?? (page === 0 ? await this.request<{ episodes: TvdbEpisode[] }>(`/series/${id}/episodes/default`, { page }) : null);
      if (!result?.episodes?.length) break;
      for (const episode of result.episodes) {
        if (episode.seasonNumber <= 0) continue;
        bySeason.set(episode.seasonNumber, [...bySeason.get(episode.seasonNumber) ?? [], { number: episode.number, title: episode.name || null, airDate: episode.aired || null }]);
      }
      if (result.episodes.length < 500) break;
    }
    return { source: "tvdb", fetchedAt: new Date().toISOString(), seasons: [...bySeason].sort((a, b) => a[0] - b[0]).map(([number, episodes]) => ({ number, episodes })) };
  }

  public override async search(type: Extract<ItemType, "movie" | "show">, query: string, year: number | null): Promise<MatchCandidate[]> {
    if (type !== "show") return [];
    const language = TvdbProvider.languageCode((await this.settings()).language);
    const results = await this.request<TvdbSearchResult[]>("/search", { query, type: "series", year: year ?? undefined }) ?? [];
    return results.slice(0, 12).map((r) => ({
      provider: this.id,
      id: r.tvdb_id,
      title: r.translations?.[language] ?? r.name,
      year: Number(r.year) || null,
      overview: r.overviews?.[language] ?? r.overview ?? null,
      posterUrl: r.image_url ?? null,
    }));
  }
}

export default TvdbProvider;
