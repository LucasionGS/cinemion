import type { Palette } from "./media.ts";

/**
 * Types for Music libraries: artists, albums, tracks and playlists.
 * Artists, albums and tracks are media items (`artist`, `album`, `track`); a track's file is played as audio,
 * straight from the file or converted once for browsers that can't play it.
 */

export interface ArtistSummary {
  id: number;
  libraryId: number;
  name: string;
  /**
   * Picture from the artist's folder, as an image key. `null` = none, so the client draws initials.
   */
  image: string | null;
  palette: Palette | null;
  albumCount: number;
}

export interface AlbumSummary {
  id: number;
  libraryId: number;
  title: string;
  artistId: number | null;
  artistName: string;
  year: number | null;
  genres: string[];
  /**
   * Cover as an image key. `null` = none.
   */
  cover: string | null;
  palette: Palette | null;
  trackCount: number;
  addedAt: string;
}

export interface TrackInfo {
  id: number;
  title: string;
  albumId: number | null;
  albumTitle: string;
  /**
   * The album's artist.
   */
  artistId: number | null;
  artistName: string;
  /**
   * Who performs this track, when it's not the album's artist (compilations, guests). `null` = the album's artist.
   */
  trackArtist: string | null;
  disc: number | null;
  number: number | null;
  /**
   * Unit is in seconds.
   */
  duration: number;
  cover: string | null;
  palette: Palette | null;
  /**
   * How often the signed-in profile played it.
   */
  playCount: number;
}

export interface AlbumDetail extends AlbumSummary {
  tracks: TrackInfo[];
  /**
   * Unit is in seconds.
   */
  duration: number;
  /**
   * Other albums by the same artist.
   */
  moreByArtist: AlbumSummary[];
}

export interface ArtistDetail extends ArtistSummary {
  albums: AlbumSummary[];
  /**
   * Compilations and other artists' albums with tracks by this artist.
   */
  appearsOn: AlbumSummary[];
  /**
   * The signed-in profile's most played tracks by this artist.
   */
  topTracks: TrackInfo[];
}

export interface PlaylistSummary {
  id: number;
  name: string;
  trackCount: number;
  /**
   * Unit is in seconds.
   */
  duration: number;
  /**
   * Up to four album covers, for the playlist's tile.
   */
  covers: string[];
  updatedAt: string;
}

/**
 * A track in a playlist. `entryId` tells apart the same track added twice.
 */
export interface PlaylistEntry extends TrackInfo {
  entryId: number;
}

export interface PlaylistDetail extends PlaylistSummary {
  tracks: PlaylistEntry[];
}

export type MusicSort = "title" | "artist" | "added" | "year";

/**
 * One page of a long list, and how many there are in all.
 */
export interface MusicPage<T> {
  items: T[];
  total: number;
}

/**
 * Audio formats a browser can play, sent when asking for a track so the server knows whether to convert it.
 */
export type AudioFormat = "mp3" | "aac" | "flac" | "opus" | "vorbis" | "alac" | "wav";

export interface TrackStreamRequest {
  formats: AudioFormat[];
}

export interface TrackStream {
  url: string;
  /**
   * `false` when the file is converted for this browser.
   */
  direct: boolean;
  /**
   * Unit is in seconds.
   */
  duration: number;
}

export interface LyricLine {
  /**
   * Unit is in seconds.
   */
  time: number;
  text: string;
}

/**
 * Words to a track: timed lines from an LRC file or tag, or plain text. Both `null` = none found.
 */
export interface Lyrics {
  synced: LyricLine[] | null;
  plain: string | null;
}

/**
 * The music a profile listened to lately, and what's new, for the top of a Music library.
 */
export interface MusicOverview {
  recentlyPlayed: AlbumSummary[];
  recentlyAdded: AlbumSummary[];
}

/**
 * Parse LRC lyrics: `[mm:ss.xx]` stamps before each line, several stamps for a repeated line.
 * Returns `null` when the text has no stamps.
 */
export function parseLrc(text: string): LyricLine[] | null {
  const lines: LyricLine[] = [];
  // Example:
  // [01:12.40][02:30.10]I've been here before
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (stamps.length === 0) continue;
    const words = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const stamp of stamps) lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2].replace(":", ".")), text: words });
  }
  if (lines.length === 0) return null;
  return lines.sort((a, b) => a.time - b.time);
}
