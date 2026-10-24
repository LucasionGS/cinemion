import type { ItemSummary } from "./media.ts";

/**
 * Types for Clips libraries: game recordings, grouped by game. Every clip is a `video` item whose parent is a `game`
 * item (or no parent while its game isn't known). Games are found from the names recorders give their files and
 * folders, set by hand, or suggested from the picture.
 */

/**
 * How a clip got its game.
 * `folder`, `file` and `tags` = read from the folder name, the file name or the tags inside the file,
 * `steam` = a Steam app id in the name, `upload` = named by the app that uploaded it (Podium), `manual` = picked by
 * hand (or a suggestion that was accepted).
 */
export type ClipGameSource = "folder" | "file" | "tags" | "steam" | "upload" | "manual";

/**
 * A game Cinemion thinks a clip without one shows, from the picture.
 */
export interface GameSuggestion {
  /**
   * The game in this library. `null` when it's a game the library doesn't have yet.
   */
  gameId: number | null;
  title: string;
  steamAppId: string | null;
  /**
   * 0 to 1.
   */
  confidence: number;
  /**
   * `similar` = looks like clips already tagged with the game, `picture` = a best guess from the picture alone.
   */
  source: "similar" | "picture";
}

/**
 * What lists need to know about a clip, on top of its `ItemSummary`.
 */
export interface ClipExtras {
  game: { id: number; title: string } | null;
  /**
   * When it was recorded, on the recording computer's clock: `YYYY-MM-DDTHH:MM:SS`.
   */
  takenAt: string | null;
  /**
   * Length. Unit is in seconds. `null` until the file has been read.
   */
  seconds: number | null;
  /**
   * Whether the title is the clip's own (from its file name, or typed in), rather than when it was recorded.
   */
  titled: boolean;
  found: ClipGameSource | null;
  suggestion: GameSuggestion | null;
}

/**
 * A game with its clips counted, for the games grid.
 */
export interface GameSummary extends ItemSummary {
  clipCount: number;
  /**
   * When its newest clip was recorded. `YYYY-MM-DDTHH:MM:SS`.
   */
  newestClipAt: string | null;
  /**
   * Length of all its clips together. Unit is in seconds.
   */
  totalSeconds: number;
}

export type GameSort = "recent" | "title" | "clips";

export type ClipSort = "newest" | "oldest" | "longest";

export interface ClipsOverview {
  clipCount: number;
  gameCount: number;
  /**
   * Clips without a game.
   */
  noGameCount: number;
  /**
   * Clips without a game that have a suggestion.
   */
  suggestedCount: number;
  games: GameSummary[];
  /**
   * The newest clips of the whole library.
   */
  recent: ItemSummary[];
}

/**
 * A game to pick in "Set game": one the library has, or one found online.
 */
export interface GameCandidate {
  /**
   * The game in this library, when it has it.
   */
  gameId: number | null;
  /**
   * Where an online result comes from (`steam` or `steamgriddb`) and its id there. `null` for library games.
   */
  provider: string | null;
  id: string | null;
  title: string;
  year: number | null;
  /**
   * Image key for library games (`/api/images/<key>`), or a full URL for online results.
   */
  cover: string | null;
  clipCount: number;
}

/**
 * Which game clips get. `null` = no game.
 */
export type GameChoice = { gameId: number } | { provider: string; id: string; title: string } | { title: string } | null;

export interface SetGameRequest {
  ids: number[];
  game: GameChoice;
}

export interface ClipsSettings {
  /**
   * Look games up on Steam (and SteamGridDB, with a key) for their names and artwork.
   */
  lookups: boolean;
  steamGridDbKey: string | null;
  /**
   * Suggest games for clips without one after each scan, when picture recognition is installed.
   */
  autoSuggest: boolean;
}

export interface RecognitionStatus {
  /**
   * `missing` = not downloaded, `downloading`, `ready`, or `failed` (see `error`).
   */
  state: "missing" | "downloading" | "ready" | "failed";
  /**
   * Download progress, 0 to 1. `null` when not downloading.
   */
  progress: number | null;
  /**
   * Size of the download. Unit is in bytes.
   */
  downloadSize: number;
  error: string | null;
  /**
   * Clips the picture recognition hasn't looked at yet.
   */
  pending: number;
}

export interface TrimRequest {
  /**
   * Unit is in seconds. The cut starts at the keyframe at or before `start`, since nothing is converted.
   */
  start: number;
  end: number;
  /**
   * Replace the original file, rather than saving the cut next to it as a new clip.
   */
  replace: boolean;
}

export interface ShareCopyRequest {
  /**
   * The part to keep, in seconds. `null` = from the start, or to the end.
   */
  start: number | null;
  end: number | null;
  /**
   * The most the copy may be. Unit is in MB (1,000,000 bytes, like chat apps count them).
   */
  sizeMb: number;
  /**
   * Which sound to keep: an audio track's index, `mix` for all tracks together (game and microphone recorded
   * separately), or `null` for the default track.
   */
  audio: number | "mix" | null;
}

export interface ShareCopyInfo {
  id: string;
  state: "working" | "done" | "failed";
  /**
   * 0 to 1, or `null` when unknown.
   */
  progress: number | null;
  /**
   * Unit is in bytes. `null` until done.
   */
  size: number | null;
  /**
   * The copy's video height in pixels, like 720.
   */
  height: number | null;
  error: string | null;
  /**
   * Where to download it from, when done. Works without signing in while it lives (a day).
   */
  url: string | null;
  fileName: string;
}

/**
 * Size limits offered for small copies, in MB.
 */
export const SHARE_COPY_SIZES = [10, 25, 50, 100, 500] as const;
