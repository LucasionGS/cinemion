import Path from "node:path";
import type { ExternalIds } from "@shared/media.ts";

/**
 * Works out what a video file is from its path: a movie's title and year, or a show, season and episode.
 */
export namespace NameParser {
  export const VIDEO_EXTENSIONS = new Set([
    ".mkv", ".mp4", ".m4v", ".avi", ".mov", ".wmv", ".ts", ".m2ts", ".mts", ".webm", ".flv", ".mpg", ".mpeg", ".ogv", ".3gp", ".vob", ".divx", ".iso",
  ]);

  export interface ParsedTitle {
    title: string;
    year: number | null;
    ids: ExternalIds;
  }

  export interface MovieInfo extends ParsedTitle {
    /**
     * Cut or version from the name, like "Director's Cut". `null` = none given.
     */
    edition: string | null;
  }

  export interface EpisodeInfo {
    show: ParsedTitle;
    /**
     * Folder that holds the whole show. Episodes with the same folder belong to the same show.
     */
    showFolder: string;
    season: number;
    episode: number;
    /**
     * Last episode of a multi-episode file (S01E01-E02). `null` for a single episode.
     */
    episodeEnd: number | null;
    /**
     * Episode title from the file name, like "Spat" in "Show - S01E01 - Spat". `null` when there's none.
     */
    title: string | null;
  }

  // Folders that hold bonus material rather than the main feature or episodes
  const EXTRAS_FOLDERS = /^(extras?|featurettes?|behind[ ._-]the[ ._-]scenes|deleted[ ._-]scenes|interviews?|scenes|shorts|trailers?|samples?|other|bonus|@eadir|#recycle|lost\+found)$/i;
  const EXTRAS_SUFFIX = /[ ._-](trailer|sample|featurette|behindthescenes|deleted|interview|scene|short|other)$/i;
  // Words that mark where a release name stops being the title
  const JUNK = /^(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr|hdr10|hdr10plus|dv|dovi|sdr|bluray|blu-ray|bdrip|brrip|bdremux|remux|web|web-?dl|webrip|hdtv|hdrip|dvdrip|dvd|dvdscr|xvid|divx|x264|x265|h\.?264|h\.?265|hevc|avc|av1|aac\d?(\.\d)?|ac3|eac3|ddp?\d?(\.\d)?|dts(-?hd)?|truehd|atmos|flac|opus|10bit|8bit|proper|repack|extended|unrated|remastered|limited|internal|multi|dubbed|subbed|imax|criterion|hybrid|amzn|nf|dsnp|hmax|atvp|hulu)$/i;
  const YEAR = /^(19\d{2}|20\d{2})$/;
  const ID_TAG = /[{[]\s*(tmdb|tmdbid|imdb|imdbid|tvdb|tvdbid)\s*[-=:]\s*([a-z0-9]+)\s*[}\]]/gi;
  const EDITION_TAG = /\{edition-([^}]+)\}/i;
  const SEASON_FOLDER = /^(?:season|series|staffel|saison|temporada|seizoen|stagione|s)[ ._-]*(\d{1,4})$/i;
  const SPECIALS_FOLDER = /^(specials?|extras?[ ._-]?episodes?)$/i;

  export function isVideo(path: string) {
    return VIDEO_EXTENSIONS.has(Path.extname(path).toLowerCase());
  }

  /**
   * Whether a file should be left out of the library: hidden files, samples, trailers and other extras.
   * @param relativePath Path inside the library folder.
   */
  export function shouldSkip(relativePath: string) {
    const parts = relativePath.split(/[\\/]/);
    if (parts.some((p) => p.startsWith("."))) return true;
    if (parts.slice(0, -1).some((p) => EXTRAS_FOLDERS.test(p))) return true;
    const base = Path.parse(parts[parts.length - 1]).name;
    return EXTRAS_SUFFIX.test(base) || /^sample$/i.test(base);
  }

  /**
   * Pull `{tmdb-603}`, `[imdbid-tt0133093]` and similar tags out of a name.
   */
  export function extractIds(name: string): { ids: ExternalIds; rest: string } {
    const ids: ExternalIds = {};
    const rest = name.replace(ID_TAG, (_match, kind: string, value: string) => {
      const key = kind.toLowerCase().replace("id", "") as keyof ExternalIds;
      ids[key] = value;
      return " ";
    });
    return { ids, rest };
  }

  /**
   * Turn a folder or file name into a title and year.
   * Handles "Title (Year)", release names like "Title.2019.1080p.BluRay.x264-GROUP", and ID tags.
   */
  export function parseTitle(name: string): ParsedTitle {
    const { ids, rest } = extractIds(name);
    let text = rest.replace(EDITION_TAG, " ");
    // Leading "[Group]" tags
    text = text.replace(/^\s*\[[^\]]*\]\s*/, "");

    // "Title (2019)" is the clearest form, so it wins when present
    const parenthesised = /^(.*?)[\s._]*\((\d{4})\)/.exec(text);
    if (parenthesised && YEAR.test(parenthesised[2]) && parenthesised[1].trim()) {
      return { title: tidy(parenthesised[1]), year: parseInt(parenthesised[2]), ids };
    }

    // Release names: the year is the last one before the quality and codec tags
    const tokens = text.split(/[\s._]+|(?<=\S)\s*-\s*(?=\S)/).filter(Boolean).map((t) => t.replace(/^[[(]+|[\])]+$/g, ""));
    let junkAt = tokens.findIndex((t, i) => i > 0 && JUNK.test(t));
    if (junkAt === -1) junkAt = tokens.length;
    let yearAt = -1;
    for (let i = 1; i < junkAt; i++) {
      if (YEAR.test(tokens[i])) yearAt = i;
    }
    const titleTokens = tokens.slice(0, yearAt !== -1 ? yearAt : junkAt);
    return { title: tidy(titleTokens.join(" ")) || tidy(text), year: yearAt !== -1 ? parseInt(tokens[yearAt]) : null, ids };
  }

  /**
   * Work out which movie a file is, from its file name and the folder it's in.
   * @param libraryRoot The library folder, so it's never mistaken for the movie's folder.
   */
  export function parseMovie(filePath: string, libraryRoot: string): MovieInfo {
    const fileName = Path.parse(filePath).name;
    const folder = Path.dirname(filePath);
    const fromFile = parseTitle(stripVersionSuffix(fileName));
    const edition = EDITION_TAG.exec(fileName)?.[1] ?? EDITION_TAG.exec(Path.basename(folder))?.[1] ?? null;

    if (Path.resolve(folder) === Path.resolve(libraryRoot)) return { ...fromFile, edition };

    // A movie folder with a year or an ID tag is more reliable than a release-style file name
    const fromFolder = parseTitle(Path.basename(folder));
    const folderIsReliable = fromFolder.year !== null || Object.keys(fromFolder.ids).length > 0;
    const best = folderIsReliable || fromFile.year === null ? { ...fromFile, ...pick(fromFolder, fromFile) } : fromFile;
    return { ...best, ids: { ...fromFile.ids, ...fromFolder.ids }, edition };
  }

  function pick(folder: ParsedTitle, file: ParsedTitle): ParsedTitle {
    return { title: folder.title || file.title, year: folder.year ?? file.year, ids: {} };
  }

  /**
   * Work out the show, season and episode of a file. `null` when no episode number can be found.
   * @param libraryRoot The library folder. The first folder inside it is the show.
   */
  export function parseEpisode(filePath: string, libraryRoot: string): EpisodeInfo | null {
    const relative = Path.relative(libraryRoot, filePath);
    const parts = relative.split(/[\\/]/);
    const fileName = Path.parse(filePath).name;

    let season: number | null = null;
    // Season from the folder, e.g. "Season 01" or "Specials"
    for (const folder of parts.slice(1, -1)) {
      const match = SEASON_FOLDER.exec(folder.trim());
      if (match) season = parseInt(match[1]);
      else if (SPECIALS_FOLDER.test(folder.trim())) season = 0;
    }

    const numbers = parseEpisodeNumbers(fileName, season);
    if (!numbers) return null;

    // Files straight in the library folder carry the show name before the episode tag
    const showName = parts.length > 1 ? parts[0] : fileName.slice(0, numbers.index);
    const showFolder = parts.length > 1 ? Path.join(libraryRoot, parts[0]) : Path.join(libraryRoot, tidy(showName));

    return {
      show: parseTitle(showName),
      showFolder,
      season: numbers.season ?? season ?? 1,
      episode: numbers.episode,
      episodeEnd: numbers.episodeEnd,
      title: episodeTitle(fileName.slice(numbers.index + numbers.length)),
    };
  }

  /**
   * Find the episode numbers in a file name.
   * Examples: "S01E02", "s1e2", "S01E01-E02", "S01E01E02", "1x02", "Episode 2", "02 - Title".
   */
  export function parseEpisodeNumbers(name: string, folderSeason: number | null): { season: number | null; episode: number; episodeEnd: number | null; index: number; length: number } | null {
    const standard = /s(\d{1,4})[ ._-]*e(\d{1,4})(?:(?:[ ._-]*-[ ._-]*e?|[ ._-]*e)(\d{1,4}))?/i.exec(name);
    if (standard) {
      const end = standard[3] ? parseInt(standard[3]) : null;
      const episode = parseInt(standard[2]);
      return { season: parseInt(standard[1]), episode, episodeEnd: end !== null && end > episode ? end : null, index: standard.index, length: standard[0].length };
    }

    const cross = /(?:^|[ ._-])(\d{1,2})x(\d{2,3})(?=[ ._-]|$)/i.exec(name);
    if (cross) return { season: parseInt(cross[1]), episode: parseInt(cross[2]), episodeEnd: null, index: cross.index, length: cross[0].length };

    const word = /(?:^|[ ._-])(?:episode|ep|e)[ ._-]*(\d{1,4})(?=[ ._-]|$)/i.exec(name);
    if (word) return { season: folderSeason, episode: parseInt(word[1]), episodeEnd: null, index: word.index, length: word[0].length };

    // A bare leading number only counts inside a season folder, to avoid reading years as episodes
    const leading = /^(\d{1,3})(?=[ ._-]|$)/.exec(name);
    if (leading && folderSeason !== null) return { season: folderSeason, episode: parseInt(leading[1]), episodeEnd: null, index: 0, length: leading[0].length };

    return null;
  }

  /**
   * What follows the episode tag, when it reads like a title rather than release tags.
   * Example: " - Low Water" gives "Low Water"; ".1080p.WEB-DL" gives `null`.
   */
  function episodeTitle(rest: string): string | null {
    const tokens = rest.split(/[\s._]+/).filter(Boolean);
    const junkAt = tokens.findIndex((t) => JUNK.test(t.replace(/^[[(]+|[\])]+$/g, "")));
    const title = tidy((junkAt === -1 ? tokens : tokens.slice(0, junkAt)).join(" "));
    return title.length > 1 && /\p{L}/u.test(title) ? title : null;
  }

  /**
   * "Movie (2019) - 1080p" and "Movie (2019) - Director's Cut" are versions of "Movie (2019)".
   */
  function stripVersionSuffix(name: string) {
    return name.replace(/\s+-\s+(?:\d{3,4}p|4k|uhd|hdr|[^-]*cut|[^-]*edition|[^-]*version)\s*$/i, "");
  }

  /**
   * Clean up a title: dots and underscores to spaces, collapse whitespace, drop stray separators.
   */
  function tidy(text: string) {
    let result = text;
    // Dotted release names have no real spaces
    if (!/\s/.test(result.trim())) result = result.replace(/[._]+/g, " ");
    result = result.replace(/_/g, " ");
    return result.replace(/\s+/g, " ").replace(/^[\s\-–:,]+|[\s\-–:,[(]+$/g, "").trim();
  }
}

export default NameParser;
