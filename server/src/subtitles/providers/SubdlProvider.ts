import type { SubtitleSearchResult, SubtitleSettings } from "@shared/playback.ts";
import { findLanguage } from "@shared/languages.ts";
import SubtitleProvider from "../SubtitleProvider.ts";

/**
 * SubDL (subdl.com): a free subtitle site with an API. Needs an API key, free with an account. Searched by IMDb or
 * TMDB id when there is one, by title otherwise. Downloads come as zip files.
 */
export class SubdlProvider extends SubtitleProvider {
  public readonly id = "subdl";
  public readonly name = "SubDL";

  private static readonly API = Deno.env.get("SUBDL_API_URL") || "https://api.subdl.com/api/v1";
  private static readonly DOWNLOADS = Deno.env.get("SUBDL_DOWNLOAD_URL") || "https://dl.subdl.com";

  public isConfigured(settings: SubtitleSettings) {
    return !!settings.subdlApiKey;
  }

  /**
   * SubDL writes languages in capitals, with Brazilian Portuguese as BR_PT.
   */
  private static languageCode(code: string) {
    return code === "pt-br" ? "BR_PT" : code.toUpperCase();
  }

  public async search(query: SubtitleProvider.Query, settings: SubtitleSettings): Promise<SubtitleSearchResult[]> {
    const url = new URL(`${SubdlProvider.API}/subtitles`);
    url.searchParams.set("api_key", settings.subdlApiKey ?? "");
    url.searchParams.set("languages", query.languages.map(SubdlProvider.languageCode).join(","));
    url.searchParams.set("subs_per_page", "30");
    url.searchParams.set("type", query.type === "episode" ? "tv" : "movie");
    const imdb = query.type === "episode" ? query.parentImdbId : query.imdbId;
    const tmdb = query.type === "episode" ? query.parentTmdbId : query.tmdbId;
    if (imdb) url.searchParams.set("imdb_id", imdb);
    else if (tmdb) url.searchParams.set("tmdb_id", tmdb);
    else {
      url.searchParams.set("film_name", query.text);
      if (query.year) url.searchParams.set("year", String(query.year));
    }
    if (query.type === "episode" && query.season !== null) url.searchParams.set("season_number", String(query.season));
    if (query.type === "episode" && query.episode !== null) url.searchParams.set("episode_number", String(query.episode));
    if (query.hearingImpaired !== "include") url.searchParams.set("hi", query.hearingImpaired === "only" ? "1" : "0");

    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    const body = await res.json().catch(() => null) as SubdlProvider.SearchResponse | null;
    if (res.status === 401 || res.status === 403 || /api.?key/i.test(body?.error ?? "")) throw new Error("SubDL didn't accept the API key. Check it in Settings › Subtitles.");
    if (res.status === 429) throw new Error("SubDL is getting too many requests. Wait a minute and try again.");
    if (!res.ok) throw new Error(`Couldn't search on SubDL: ${res.status} ${body?.error ?? res.statusText}`);
    // No results come back as status false with an explanation
    if (!body?.status) return [];

    const results: SubtitleSearchResult[] = [];
    for (const sub of body.subtitles ?? []) {
      if (!sub.url) continue;
      // Episode searches include season packs; one episode's file is picked from them on download
      if (query.type === "episode" && sub.season && query.season !== null && sub.season !== query.season) continue;
      if (query.type === "episode" && sub.episode && query.episode !== null && sub.episode !== query.episode && !sub.full_season) continue;
      const notes = ["Timing may differ from your file"];
      if (sub.full_season) notes.push("Whole-season pack");
      results.push({
        provider: this.id,
        id: sub.url,
        name: sub.release_name || sub.name || query.text,
        language: findLanguage(sub.language === "BR_PT" ? "pt-br" : sub.language?.toLowerCase())?.code ?? query.languages[0],
        isHearingImpaired: !!sub.hi,
        matchesFile: false,
        downloads: 0,
        rating: null,
        uploadedAt: null,
        notes,
      });
    }
    // Single episodes before season packs
    return results.sort((a, b) => a.notes.length - b.notes.length);
  }

  public async download(id: string, _settings: SubtitleSettings, episode?: { season: number | null; number: number | null }): Promise<SubtitleProvider.Download> {
    // The id is the download path, like "/subtitle/3197651-3213944.zip"
    if (!/^\/subtitle\/[\w.-]+$/.test(id)) throw new Error("That isn't a SubDL download.");
    const res = await fetch(SubdlProvider.DOWNLOADS + id, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Couldn't download from SubDL: ${res.status} ${res.statusText}`);
    return SubtitleProvider.fromZip(new Uint8Array(await res.arrayBuffer()), episode);
  }
}

export namespace SubdlProvider {
  export interface SearchResponse {
    status?: boolean;
    error?: string;
    subtitles?: {
      release_name?: string;
      name?: string;
      language?: string;
      url?: string;
      season?: number | null;
      episode?: number | null;
      full_season?: boolean;
      hi?: boolean;
    }[];
  }
}

export default SubdlProvider;
