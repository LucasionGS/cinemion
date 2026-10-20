import type { SubtitleSearchResult, SubtitleSettings } from "@shared/playback.ts";

/**
 * A website or service to search and download subtitles from.
 */
export abstract class SubtitleProvider {
  /**
   * Stored with downloads, e.g. "opensubtitles".
   */
  public abstract readonly id: string;
  public abstract readonly name: string;

  /**
   * Whether the provider is set up, e.g. it has an API key.
   */
  public abstract isConfigured(settings: SubtitleSettings): boolean;

  /**
   * Find subtitles. Results are ordered best first.
   * @throws When the provider can't be reached or rejects the request, with a readable message.
   */
  public abstract search(query: SubtitleProvider.Query, settings: SubtitleSettings): Promise<SubtitleSearchResult[]>;

  /**
   * Download a search result as subtitle text.
   * @throws When the download fails or the daily limit is reached, with a readable message.
   */
  public abstract download(id: string, settings: SubtitleSettings): Promise<SubtitleProvider.Download>;
}

export namespace SubtitleProvider {
  export interface Query {
    type: "movie" | "episode";
    /**
     * ISO 639-1 codes.
     */
    languages: string[];
    /**
     * Title to search for; for episodes, the show's title.
     */
    text: string;
    year: number | null;
    imdbId: string | null;
    tmdbId: string | null;
    /**
     * The show's ids, for episodes.
     */
    parentImdbId: string | null;
    parentTmdbId: string | null;
    season: number | null;
    episode: number | null;
    /**
     * File hash for exact matches; see `SubtitleManager.fileHash`.
     */
    hash: string | null;
    byteSize: number | null;
    hearingImpaired: "include" | "exclude" | "only";
  }

  export interface Download {
    content: Uint8Array;
    /**
     * File extension: srt, vtt, ass or ssa.
     */
    format: string;
  }
}

export default SubtitleProvider;
