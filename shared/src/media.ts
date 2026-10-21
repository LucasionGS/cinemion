import type { LibraryType } from "./api.ts";
import type { AlbumSummary, ArtistSummary, TrackInfo } from "./music.ts";
import type { BookSummary } from "./books.ts";
import type { PhotoAlbumSummary } from "./photos.ts";

/**
 * Types for movies, shows, seasons, episodes, videos and their folders, and the files behind them.
 */

/**
 * `video` and `folder` live in Videos libraries: every file is a video, and the folders holding them are groups.
 * `artist`, `album` and `track` live in Music libraries (see `music.ts`), `audiobook` and `book` in Audiobooks and
 * Books libraries (see `books.ts`). Photos libraries hold `photo` and `video` items in `folder`s (see `photos.ts`).
 */
export type ItemType = "movie" | "show" | "season" | "episode" | "video" | "folder" | "artist" | "album" | "track" | "audiobook" | "book" | "photo";

/**
 * Whether items of this type play in the video player by themselves (rather than holding things that play).
 * Tracks play in the music player instead, and photos are only looked at.
 */
export function isPlayable(type: ItemType) {
  return type === "movie" || type === "episode" || type === "video";
}

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

/**
 * Ratings from other sites, through OMDb. `null` fields are unknown.
 */
export interface ExternalRatings {
  /**
   * 0 to 10.
   */
  imdb: number | null;
  imdbVotes: number | null;
  /**
   * The Tomatometer, 0 to 100.
   */
  rottenTomatoes: number | null;
  /**
   * 0 to 100.
   */
  metacritic: number | null;
}

export interface ExternalIds {
  tmdb?: string;
  imdb?: string;
  tvdb?: string;
}

/**
 * The signed-in profile's progress on an item.
 */
export interface UserData {
  /**
   * For shows and seasons: every episode has been watched.
   */
  watched: boolean;
  /**
   * Where playback stopped, in seconds. 0 = not started (or finished).
   */
  position: number;
  /**
   * `position` as 0 to 1 of the length, or `null` when the length isn't known.
   */
  progress: number | null;
  /**
   * Episodes still to watch, for shows and seasons. `null` for movies and episodes.
   */
  unwatchedCount: number | null;
  lastWatchedAt: string | null;
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
  overview: string | null;
  /**
   * Length in minutes.
   */
  runtime: number | null;
  genres: string[];
  rating: number | null;
  artwork: Artwork;
  palette: Palette | null;
  matchStatus: MatchStatus;
  contentRating: string | null;
  /**
   * `YYYY-MM-DD`. For videos, the day it was recorded.
   */
  releaseDate: string | null;
  /**
   * Seasons of a show, episodes of a season, or every video inside a folder (subfolders included).
   */
  childCount: number;
  seasonNumber: number | null;
  episodeNumber: number | null;
  /**
   * The show a season or episode belongs to. `null` for movies and shows.
   */
  showId: number | null;
  showTitle: string | null;
  collectionId: number | null;
  addedAt: string;
  userData: UserData | null;
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
  /**
   * A separate file next to the video (or downloaded), rather than a track inside it.
   */
  external: boolean;
  isHearingImpaired: boolean;
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
  collection: CollectionSummary | null;
  /**
   * Titles from the same library that share genres.
   */
  similar: ItemSummary[];
  originalTitle: string | null;
  overview: string | null;
  tagline: string | null;
  /**
   * Length in minutes.
   */
  runtime: number | null;
  rating: number | null;
  /**
   * IMDb, Rotten Tomatoes and Metacritic, when OMDb is set up. `null` = not looked up.
   */
  ratings: ExternalRatings | null;
  genres: string[];
  studios: string[];
  externalIds: ExternalIds;
  parentId: number | null;
  credits: CreditInfo[];
  files: MediaFileInfo[];
  children: ItemSummary[];
  /**
   * The folders above a video or folder, outermost first. Empty for everything else.
   */
  folders: { id: number; title: string }[];
  /**
   * For videos and folders: whether details or the thumbnail were set by hand, so refreshing keeps them.
   */
  edited: { details: boolean; thumbnail: boolean };
}

/**
 * Hand-made details for a video or folder. Folders only use `title` and `overview`.
 */
export interface EditDetailsRequest {
  title: string;
  /**
   * `YYYY-MM-DD`, or `null` for none.
   */
  releaseDate: string | null;
  overview: string | null;
  /**
   * Shown and filtered like genres.
   */
  tags: string[];
  /**
   * Like "PG" or "12". `null` = use the library's rating for unrated videos.
   */
  contentRating: string | null;
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

export interface CollectionSummary {
  id: number;
  libraryId: number;
  name: string;
  overview: string | null;
  artwork: Artwork;
  palette: Palette | null;
  itemCount: number;
}

export interface CollectionDetail extends CollectionSummary {
  items: ItemSummary[];
}

export interface PersonSummary {
  id: number;
  name: string;
  photo: string | null;
}

export interface PersonDetail extends PersonSummary {
  credits: { item: ItemSummary; kind: string; character: string | null }[];
}

export interface SearchResults {
  /**
   * Movies and shows.
   */
  titles: ItemSummary[];
  episodes: ItemSummary[];
  /**
   * Videos and folders from Videos libraries, and videos from Photos libraries.
   */
  videos: ItemSummary[];
  /**
   * Folders and hand-made albums from Photos libraries.
   */
  photoAlbums: PhotoAlbumSummary[];
  people: PersonSummary[];
  collections: CollectionSummary[];
  artists: ArtistSummary[];
  albums: AlbumSummary[];
  tracks: TrackInfo[];
  books: BookSummary[];
}

export interface HomeData {
  /**
   * Movies and episodes started but not finished, most recent first.
   */
  continueWatching: ItemSummary[];
  /**
   * The next episode of shows you're in the middle of.
   */
  nextUp: ItemSummary[];
  recentlyAdded: { libraryId: number; libraryName: string; libraryType: LibraryType; items: ItemSummary[] }[];
  /**
   * New albums in Music libraries.
   */
  recentlyAddedMusic: { libraryId: number; libraryName: string; albums: AlbumSummary[] }[];
  /**
   * Newest folders in Photos libraries.
   */
  recentlyAddedPhotos: { libraryId: number; libraryName: string; albums: PhotoAlbumSummary[] }[];
  /**
   * Audiobooks being listened to and books being read.
   */
  continueBooks: BookSummary[];
  /**
   * Titles like the one you watched last. `null` until something has been watched.
   */
  becauseYouWatched: { title: string; items: ItemSummary[] } | null;
}
