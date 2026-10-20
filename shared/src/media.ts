/**
 * Types for movies, shows, seasons and episodes, and the files behind them.
 */

export type ItemType = "movie" | "show" | "season" | "episode";

/**
 * How an item got its details.
 * `matched` = found automatically, `manual` = picked with "Fix match", `unmatched` = only the file name is known.
 */
export type MatchStatus = "matched" | "manual" | "unmatched";

/**
 * Colours taken from a title's artwork, used by the ambient theme.
 */
export interface Palette {
  accent: string;
  onAccent: string;
  base: string;
}

/**
 * Cached artwork, as image keys for `/api/images/<key>`. `null` = none.
 */
export interface Artwork {
  poster: string | null;
  backdrop: string | null;
  logo: string | null;
  /**
   * Episode still or movie thumbnail.
   */
  thumb: string | null;
}

export interface ExternalIds {
  tmdb?: string;
  imdb?: string;
  tvdb?: string;
}

/**
 * What lists and rows need to show an item.
 */
export interface ItemSummary {
  id: number;
  libraryId: number;
  type: ItemType;
  title: string;
  year: number | null;
  artwork: Artwork;
  palette: Palette | null;
  matchStatus: MatchStatus;
  contentRating: string | null;
  /**
   * Seasons of a show, or episodes of a season.
   */
  childCount: number;
  seasonNumber: number | null;
  episodeNumber: number | null;
  addedAt: string;
}

export interface CreditInfo {
  personId: number;
  name: string;
  /**
   * `cast`, `director`, `writer`, `producer` or `composer`.
   */
  kind: string;
  character: string | null;
  photo: string | null;
}

export interface AudioTrack {
  index: number;
  codec: string;
  channels: number;
  language: string | null;
  title: string | null;
  isDefault: boolean;
}

export interface SubtitleTrack {
  index: number;
  codec: string;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
  /**
   * Image-based subtitles (PGS, VobSub) have to be burned into the video.
   */
  isImage: boolean;
}

export interface MediaFileInfo {
  id: number;
  path: string;
  size: number;
  container: string | null;
  /**
   * Length in seconds.
   */
  duration: number | null;
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  /**
   * `hdr10`, `hlg`, `dolby-vision`, or `null` for SDR.
   */
  hdr: string | null;
  bitrate: number | null;
  audio: AudioTrack[];
  subtitles: SubtitleTrack[];
}

/**
 * Everything the detail page shows.
 */
export interface ItemDetail extends ItemSummary {
  originalTitle: string | null;
  overview: string | null;
  tagline: string | null;
  /**
   * Length in minutes.
   */
  runtime: number | null;
  releaseDate: string | null;
  rating: number | null;
  genres: string[];
  studios: string[];
  externalIds: ExternalIds;
  parentId: number | null;
  credits: CreditInfo[];
  files: MediaFileInfo[];
  children: ItemSummary[];
}

/**
 * A search result in the "Fix match" dialog.
 */
export interface MatchCandidate {
  provider: string;
  id: string;
  title: string;
  year: number | null;
  overview: string | null;
  /**
   * Full image URL from the provider, shown directly in the dialog.
   */
  posterUrl: string | null;
}

export interface TaskInfo {
  id: string;
  label: string;
  /**
   * What it's doing right now, like "Reading files".
   */
  status: string;
  /**
   * 0 to 1, or `null` when unknown.
   */
  progress: number | null;
  libraryId: number | null;
  startedAt: string;
}

export type SortOrder = "title" | "added" | "year" | "rating";

export interface ItemPage {
  items: ItemSummary[];
  total: number;
}
