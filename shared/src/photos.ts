import type { Palette } from "./media.ts";

/**
 * Types for Photos libraries. Every picture is a `photo` item and every video a `video` item; the folders holding
 * them are `folder` items, shown as albums. People can also make their own albums from photos anywhere in a
 * library, without moving any files.
 */

/**
 * What a photo's file says about it (EXIF), as far as Cinemion reads it. Fields are `null` when the photo doesn't say.
 */
export interface PhotoMeta {
  /**
   * Size as shown, after turning the photo upright. Unit is in pixels.
   */
  width: number | null;
  height: number | null;
  /**
   * EXIF orientation, 1 to 8. 1 = stored upright.
   */
  orientation: number;
  /**
   * When it was taken, on the camera's clock: `YYYY-MM-DDTHH:MM:SS`.
   */
  takenAt: string | null;
  /**
   * The camera's time zone, like `+02:00`, when it wrote one.
   */
  offset: string | null;
  /**
   * Make and model, like "Google Pixel 8 Pro".
   */
  camera: string | null;
  lens: string | null;
  fNumber: number | null;
  /**
   * Unit is in seconds.
   */
  exposureTime: number | null;
  iso: number | null;
  /**
   * Unit is in millimetres.
   */
  focalLength: number | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * A photo or video as grids and the viewer list it.
 */
export interface PhotoSummary {
  id: number;
  libraryId: number;
  type: "photo" | "video";
  title: string;
  /**
   * The picture as an image key (for videos, their thumbnail). `null` while it's being made.
   */
  image: string | null;
  /**
   * Width divided by height, for laying out rows.
   */
  aspect: number;
  /**
   * When it was taken or recorded: `YYYY-MM-DDTHH:MM:SS`. `null` = unknown.
   */
  takenAt: string | null;
  /**
   * Videos: the length. Unit is in seconds. `null` for photos.
   */
  duration: number | null;
  /**
   * The folder it's in. `null` = a library folder itself.
   */
  folderId: number | null;
}

/**
 * Everything the viewer's details panel shows.
 */
export interface PhotoDetail extends PhotoSummary {
  caption: string | null;
  tags: string[];
  /**
   * Like "PG". `null` = the library's rating for unrated photos.
   */
  contentRating: string | null;
  fileName: string;
  /**
   * Unit is in bytes.
   */
  size: number;
  meta: PhotoMeta | null;
  /**
   * The folders above it, outermost first.
   */
  folders: { id: number; title: string }[];
  /**
   * Hand-made albums it's in.
   */
  albums: { id: number; title: string }[];
  /**
   * The full-size picture: the original when browsers show that format, otherwise a converted copy. Works without
   * a sign-in header for a few hours.
   */
  viewUrl: string;
  /**
   * The original file, as a download.
   */
  downloadUrl: string;
  palette: Palette | null;
  /**
   * Whether its details were set by hand, so refreshing keeps them.
   */
  edited: boolean;
}

/**
 * A folder holding photos (`folder`), or an album someone made (`album`).
 */
export type PhotoAlbumKind = "folder" | "album";

export interface PhotoAlbumSummary {
  kind: PhotoAlbumKind;
  id: number;
  libraryId: number;
  title: string;
  /**
   * Cover picture as an image key. `null` = empty.
   */
  cover: string | null;
  palette: Palette | null;
  /**
   * Everything inside, subfolders included, that the profile may see.
   */
  photoCount: number;
  videoCount: number;
  /**
   * The oldest and newest day inside: `YYYY-MM-DD`. `null` when nothing has a date.
   */
  from: string | null;
  to: string | null;
  /**
   * Hand-made albums: who made it. `null` for folders.
   */
  owner: { id: number; name: string } | null;
}

export interface PhotoAlbumDetail extends PhotoAlbumSummary {
  description: string | null;
  /**
   * Folders: the folders above it, outermost first. Empty for hand-made albums.
   */
  folders: { id: number; title: string }[];
  /**
   * Folders: the folders inside it. Empty for hand-made albums.
   */
  albums: PhotoAlbumSummary[];
  /**
   * Whether the profile may rename it, change its cover, or (hand-made albums) add and remove photos.
   */
  canEdit: boolean;
}

export interface PhotoPage {
  items: PhotoSummary[];
  total: number;
}

/**
 * The top of a Photos library: its albums and how much is in it.
 */
export interface PhotosOverview {
  photoCount: number;
  videoCount: number;
  /**
   * Folders in the library folders themselves, and hand-made albums, newest first.
   */
  albums: PhotoAlbumSummary[];
  /**
   * Photos and videos outside every folder.
   */
  looseCount: number;
}

export type PhotoAlbumSort = "newest" | "oldest" | "title";

export interface CreatePhotoAlbumRequest {
  libraryId: number;
  title: string;
  /**
   * Photos and videos to start with.
   */
  itemIds?: number[];
}

export interface UpdatePhotoAlbumRequest {
  title?: string;
  description?: string | null;
  /**
   * The photo to use as the cover. `null` = the newest one inside.
   */
  coverItemId?: number | null;
}

/**
 * Seconds each photo shows in a slideshow.
 */
export const SLIDESHOW_SECONDS = 5;
