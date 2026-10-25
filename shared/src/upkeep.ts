/**
 * Types for library upkeep: space used, duplicates, broken files and missing episodes.
 */

export interface UpkeepFile {
  id: number;
  path: string;
  /**
   * Unit is in bytes.
   */
  size: number;
  /**
   * "1080p", "4K"…, or `null` for audio and unknown.
   */
  resolution: string | null;
  videoCodec: string | null;
  hdr: string | null;
  /**
   * Unit is in bits per second.
   */
  bitrate: number | null;
  /**
   * Unit is in seconds.
   */
  duration: number | null;
  /**
   * When the file was changed on disk.
   */
  modifiedAt: string;
  /**
   * Why it's broken, or `null`.
   */
  problem: string | null;
}

export interface UpkeepItemRef {
  id: number;
  /**
   * Like "Saltwater Kings · S1 E3".
   */
  title: string;
  type: string;
  image: string | null;
  libraryName: string;
}

export interface SpaceUsage {
  total: number;
  libraries: { id: number; name: string; type: string; size: number; files: number; free: number | null }[];
  /**
   * By file extension, biggest first.
   */
  types: { type: string; size: number; files: number }[];
  /**
   * Shows by the size of all their episodes, biggest first.
   */
  shows: { item: UpkeepItemRef; size: number; files: number }[];
  /**
   * The biggest single files.
   */
  biggest: { item: UpkeepItemRef | null; file: UpkeepFile }[];
}

/**
 * The same movie or episode more than once: several files for one title, or several titles with the same ids.
 */
export interface DuplicateGroup {
  key: string;
  title: string;
  /**
   * Every copy, each with the title it belongs to.
   */
  copies: { item: UpkeepItemRef; file: UpkeepFile }[];
  /**
   * What the extra copies take up. Unit is in bytes.
   */
  extra: number;
}

export interface BrokenFile {
  item: UpkeepItemRef | null;
  file: UpkeepFile;
}

export interface UpkeepOverview {
  duplicates: DuplicateGroup[];
  broken: BrokenFile[];
  /**
   * Files not checked by playing them through yet.
   */
  unchecked: number;
  /**
   * The check running now, if any.
   */
  checking: { status: string; progress: number | null } | null;
  /**
   * Whether files can be deleted from here: needs write access to the library folders.
   */
  canDelete: boolean;
}

/**
 * An episode a show has that isn't here.
 */
export interface MissingEpisode {
  season: number;
  episode: number;
  title: string | null;
  airDate: string | null;
}

export interface MissingSeason {
  number: number;
  /**
   * Episodes of the season that have aired.
   */
  aired: number;
  missing: MissingEpisode[];
}

export interface MissingForShow {
  seasons: MissingSeason[];
  source: "tmdb" | "tvdb" | null;
  checkedAt: string | null;
}

export interface MissingOverview {
  shows: { id: number; title: string; image: string | null; missing: number; aired: number }[];
  /**
   * Shows whose episode lists were looked up, of all shows.
   */
  lookedUp: number;
  total: number;
  lookingUp: { status: string; progress: number | null } | null;
}
