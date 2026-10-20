import { unzipSync } from "fflate";
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
   * @param episode Which episode it's for, to pick the right file out of a season pack.
   * @throws When the download fails or the daily limit is reached, with a readable message.
   */
  public abstract download(id: string, settings: SubtitleSettings, episode?: { season: number | null; number: number | null }): Promise<SubtitleProvider.Download>;
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

  const FORMATS = ["srt", "ass", "ssa", "vtt"];

  /**
   * The subtitle file inside a downloaded zip. Season packs hold one per episode; `episode` picks the one whose
   * name says S01E02 or 1x02.
   * @throws When the zip has no subtitle file, or several and none for `episode`.
   */
  export function fromZip(bytes: Uint8Array, episode?: { season: number | null; number: number | null }): Download {
    const files = unzipSync(bytes);
    const subtitles = Object.entries(files)
      .map(([name, content]) => ({ name, content, format: name.split(".").pop()?.toLowerCase() ?? "" }))
      .filter((f) => FORMATS.includes(f.format) && !f.name.startsWith("__MACOSX/") && f.content.length > 0)
      // Plain SubRip first, then the biggest, which is rarely a sample or a forced-only file
      .sort((a, b) => Number(b.format === "srt") - Number(a.format === "srt") || b.content.length - a.content.length);
    if (subtitles.length === 0) throw new Error("The download had no subtitle file in it.");
    if (episode?.number) {
      const s = episode.season ?? 1;
      const e = episode.number;
      // Example: "Show.S01E02.srt", "show 1x02.srt"
      const pattern = new RegExp(`(s0*${s}[ ._-]?e0*${e}(?!\\d))|(\\b0*${s}x0*${e}(?!\\d))`, "i");
      const match = subtitles.find((f) => pattern.test(f.name));
      if (match) return { content: match.content, format: match.format };
      // Several files and none named for this episode: another episode's would be wrong, not just badly timed
      if (subtitles.length > 1) throw new Error("The season pack has no subtitle file for this episode.");
    }
    return { content: subtitles[0].content, format: subtitles[0].format };
  }
}

export default SubtitleProvider;
