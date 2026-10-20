import type { SubtitleSearchResult, SubtitleSettings } from "@shared/playback.ts";
import AppSystem from "../../AppSystem.ts";
import SubtitleProvider from "../SubtitleProvider.ts";
import log from "../../lib/Logger.ts";

/**
 * opensubtitles.com, through its REST API. Needs an API key (free, from the site's "API consumers" page).
 * Downloads work without an account but are limited per day; signing in raises the limit.
 */
export class OpenSubtitlesProvider extends SubtitleProvider {
  public readonly id = "opensubtitles";
  public readonly name = "OpenSubtitles";

  // VIP members can use their own endpoint
  private static readonly API = Deno.env.get("OPENSUBTITLES_API_URL") || "https://api.opensubtitles.com/api/v1";
  private _token: { value: string; user: string; expires: number } | null = null;

  public isConfigured(settings: SubtitleSettings) {
    return !!settings.openSubtitlesApiKey;
  }

  private headers(settings: SubtitleSettings, token?: string | null): Record<string, string> {
    return {
      "Api-Key": settings.openSubtitlesApiKey ?? "",
      "User-Agent": `${AppSystem.APP_NAME} v${AppSystem.VERSION}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    };
  }

  /**
   * Readable error for a failed request.
   */
  private async failure(res: Response, action: string) {
    const body = await res.json().catch(() => null) as { message?: string; errors?: string[] } | null;
    const detail = body?.message ?? body?.errors?.join(" ") ?? res.statusText;
    if (res.status === 401 || res.status === 403) return new Error(`OpenSubtitles didn't accept the API key or sign-in (${detail}). Check them in Settings › Subtitles.`);
    if (res.status === 406 || res.status === 407) return new Error(`The OpenSubtitles download limit for today is reached. ${detail}`);
    if (res.status === 429) return new Error("OpenSubtitles is getting too many requests. Wait a few seconds and try again.");
    return new Error(`Couldn't ${action} on OpenSubtitles: ${res.status} ${detail}`);
  }

  /**
   * A sign-in token when an account is set, or `null` to download as a guest.
   */
  private async token(settings: SubtitleSettings): Promise<string | null> {
    const username = settings.openSubtitlesUsername;
    const password = settings.openSubtitlesPassword;
    if (!username || !password) return null;
    if (this._token && this._token.user === username && this._token.expires > Date.now()) return this._token.value;

    const res = await fetch(`${OpenSubtitlesProvider.API}/login`, {
      method: "POST",
      headers: this.headers(settings),
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw await this.failure(res, "sign in");
    const body = await res.json() as { token?: string };
    if (!body.token) return null;
    // Tokens last a day; renew a little early
    this._token = { value: body.token, user: username, expires: Date.now() + 23 * 60 * 60 * 1000 };
    return body.token;
  }

  /**
   * OpenSubtitles spells a few languages differently.
   */
  private static languageCode(code: string) {
    return code === "pt" ? "pt-pt" : code;
  }

  private static ourLanguage(code: string) {
    return code === "pt-pt" ? "pt" : code;
  }

  private static numericId(id: string | null) {
    const digits = id?.replace(/^tt/i, "");
    return digits && /^\d+$/.test(digits) ? String(Number(digits)) : null;
  }

  public async search(query: SubtitleProvider.Query, settings: SubtitleSettings): Promise<SubtitleSearchResult[]> {
    const params: Record<string, string> = {
      languages: query.languages.map(OpenSubtitlesProvider.languageCode).sort().join(","),
      hearing_impaired: query.hearingImpaired,
      machine_translated: "exclude",
    };
    if (query.hash) params.moviehash = query.hash;
    if (query.type === "episode") {
      params.type = "episode";
      const parentImdb = OpenSubtitlesProvider.numericId(query.parentImdbId);
      const parentTmdb = OpenSubtitlesProvider.numericId(query.parentTmdbId);
      if (parentTmdb) params.parent_tmdb_id = parentTmdb;
      else if (parentImdb) params.parent_imdb_id = parentImdb;
      else params.query = query.text;
      if (query.season !== null) params.season_number = String(query.season);
      if (query.episode !== null) params.episode_number = String(query.episode);
    }
    else {
      params.type = "movie";
      const imdb = OpenSubtitlesProvider.numericId(query.imdbId);
      const tmdb = OpenSubtitlesProvider.numericId(query.tmdbId);
      if (tmdb) params.tmdb_id = tmdb;
      else if (imdb) params.imdb_id = imdb;
      else {
        params.query = query.text;
        if (query.year) params.year = String(query.year);
      }
    }

    // The API wants parameters sorted and lowercased, or it redirects
    const search = Object.keys(params).sort().map((k) => `${k}=${encodeURIComponent(params[k].toLowerCase())}`).join("&");
    const res = await fetch(`${OpenSubtitlesProvider.API}/subtitles?${search}`, { headers: this.headers(settings) });
    if (!res.ok) throw await this.failure(res, "search");
    const body = await res.json() as OpenSubtitlesProvider.SearchResponse;

    const results: SubtitleSearchResult[] = [];
    for (const entry of body.data ?? []) {
      const a = entry.attributes;
      const file = a.files?.[0];
      if (!file) continue;
      const notes: string[] = [];
      if (!a.moviehash_match) notes.push("Timing may differ from your file");
      if (a.foreign_parts_only) notes.push("Only the foreign-language parts");
      if (a.ai_translated) notes.push("Translated by AI");
      results.push({
        provider: this.id,
        id: String(file.file_id),
        name: a.release || file.file_name || a.feature_details?.movie_name || query.text,
        language: OpenSubtitlesProvider.ourLanguage(a.language ?? query.languages[0] ?? "en"),
        isHearingImpaired: !!a.hearing_impaired,
        matchesFile: !!a.moviehash_match,
        downloads: a.download_count ?? 0,
        rating: a.ratings ? Math.round(a.ratings * 10) / 10 : null,
        uploadedAt: a.upload_date ?? null,
        notes,
      });
    }
    // Exact file matches first, then the most downloaded
    return results.sort((x, y) => Number(y.matchesFile) - Number(x.matchesFile) || y.downloads - x.downloads);
  }

  public async download(id: string, settings: SubtitleSettings): Promise<SubtitleProvider.Download> {
    const token = await this.token(settings).catch((error) => {
      // A broken account shouldn't stop guest downloads
      log.warn("Signing in to OpenSubtitles failed; downloading as a guest", { error });
      return null;
    });
    const res = await fetch(`${OpenSubtitlesProvider.API}/download`, {
      method: "POST",
      headers: this.headers(settings, token),
      body: JSON.stringify({ file_id: Number(id), sub_format: "srt" }),
    });
    if (!res.ok) throw await this.failure(res, "download");
    const body = await res.json() as { link?: string; remaining?: number; reset_time?: string };
    if (!body.link) throw new Error(`OpenSubtitles didn't send a download link. ${body.remaining === 0 ? `The daily limit is reached; it resets ${body.reset_time ?? "tomorrow"}.` : ""}`.trim());

    const file = await fetch(body.link);
    if (!file.ok) throw new Error(`Couldn't download the subtitle file: ${file.status} ${file.statusText}`);
    return { content: new Uint8Array(await file.arrayBuffer()), format: "srt" };
  }
}

export namespace OpenSubtitlesProvider {
  export interface SearchResponse {
    total_count?: number;
    data?: {
      id: string;
      attributes: {
        language?: string;
        hearing_impaired?: boolean;
        foreign_parts_only?: boolean;
        ai_translated?: boolean;
        machine_translated?: boolean;
        moviehash_match?: boolean;
        download_count?: number;
        ratings?: number;
        release?: string;
        upload_date?: string;
        feature_details?: { movie_name?: string; title?: string; year?: number };
        files?: { file_id: number; file_name?: string }[];
      };
    }[];
  }
}

export default OpenSubtitlesProvider;
