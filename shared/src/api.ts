import type { Permission, ProfileColor, ProfilePreferences } from "./profiles.ts";
import type { TaskInfo } from "./media.ts";

/**
 * Body of every error response from the API.
 */
export interface ApiError {
  message: string;
}

//#region Server

export interface ServerInfo {
  name: string;
  version: string;
  /**
   * `true` until the first-run setup has been completed.
   */
  needsSetup: boolean;
  /**
   * Whether this build comes with its own TMDB key, so TMDB works without one in Settings › Metadata.
   */
  hasBuiltInTmdbKey: boolean;
}

//#endregion

//#region Users and profiles

/**
 * What the profile picker shows about a user. Safe to show before anyone signs in.
 */
export interface ProfileSummary {
  id: number;
  name: string;
  color: ProfileColor;
  /**
   * Version of the uploaded profile picture. `null` = no picture, show initials.
   */
  avatar: string | null;
  hasPin: boolean;
  isAdmin: boolean;
  /**
   * Highest content rating this profile may watch. `null` = no limit.
   */
  maxRating: string | null;
}

/**
 * The full view of a user, for the user themselves and for admins.
 */
export interface UserInfo extends ProfileSummary {
  username: string;
  /**
   * `false` for profiles that can only be opened from the profile picker.
   */
  hasPassword: boolean;
  role: string;
  permissions: Permission[];
  showOnPicker: boolean;
  /**
   * Library ids this user can see. `null` = all libraries.
   */
  libraryAccess: number[] | null;
  preferences: ProfilePreferences;
}

export interface LoginResponse {
  token: string;
  user: UserInfo;
}

export interface CreateUserRequest {
  name: string;
  username?: string;
  password?: string;
  pin?: string | null;
  color?: ProfileColor;
  role?: string;
  showOnPicker?: boolean;
  maxRating?: string | null;
  libraryAccess?: number[] | null;
}

export type UpdateUserRequest = Partial<CreateUserRequest>;

/**
 * What a user may change about their own account.
 */
export interface UpdateSelfRequest {
  name?: string;
  color?: ProfileColor;
  /**
   * New PIN, or `null` to remove it.
   */
  pin?: string | null;
  newPassword?: string;
  /**
   * Required when changing the password.
   */
  currentPassword?: string;
  preferences?: ProfilePreferences;
}

//#endregion

//#region Libraries

export type LibraryType = "movies" | "shows" | "videos" | "music" | "audiobooks" | "books";

export interface LibraryInfo {
  id: number;
  name: string;
  type: LibraryType;
  paths: string[];
  /**
   * Movies, shows, videos, albums, audiobooks or books in the library.
   */
  itemCount: number;
  lastScannedAt: string | null;
  /**
   * Videos and Music libraries: the rating unrated videos and music get, so age-limited profiles can see them.
   * `null` = they stay hidden from those profiles.
   */
  defaultRating: string | null;
  /**
   * The running scan, or `null` when idle.
   */
  scan: TaskInfo | null;
  /**
   * Why the library's folders are a problem, when they're also in another library (possible before Cinemion checked
   * this). `null` when they're fine.
   */
  conflict: string | null;
}

export interface CreateLibraryRequest {
  name: string;
  type: LibraryType;
  paths: string[];
  /**
   * Videos and Music libraries only. See `LibraryInfo.defaultRating`.
   */
  defaultRating?: string | null;
}

export interface UpdateLibraryRequest {
  name?: string;
  paths?: string[];
  defaultRating?: string | null;
}

//#endregion

//#region Filesystem

export interface FsEntry {
  name: string;
  path: string;
}

export interface FsListing {
  /**
   * The folder being listed. `null` = the list of allowed roots.
   */
  path: string | null;
  /**
   * The media root `path` is inside. `null` when listing the roots.
   */
  root: string | null;
  /**
   * Folder one level up, or `null` when `path` is a root.
   */
  parent: string | null;
  entries: FsEntry[];
}

//#endregion

//#region Setup

export interface MetadataSettings {
  tmdbApiKey: string | null;
  /**
   * TheTVDB project API key, and the subscriber PIN that goes with user-supported keys.
   */
  tvdbApiKey: string | null;
  tvdbPin: string | null;
  /**
   * OMDb key, for IMDb, Rotten Tomatoes and Metacritic ratings.
   */
  omdbApiKey: string | null;
  language: string;
  country: string;
  /**
   * Provider ids in priority order, highest first.
   */
  providers: string[];
}

export interface SetupRequest {
  serverName: string;
  admin: {
    name: string;
    username: string;
    password: string;
    pin?: string | null;
  };
  libraries: CreateLibraryRequest[];
  metadata: MetadataSettings;
}

//#endregion
