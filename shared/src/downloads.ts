import type { DeviceCapabilities } from "./playback.ts";

/**
 * Types for offline downloads: a movie, episode or video saved in the browser to watch without a connection.
 * The server hands out the original file when this browser plays it as it is, or makes an MP4 copy at a chosen
 * size. The browser keeps it in Cache Storage and plays it through the service worker.
 */

export type DownloadQuality = "original" | "1080p" | "720p" | "480p";

export interface DownloadOption {
  quality: DownloadQuality;
  label: string;
  /**
   * Unit is in bytes. For copies, a guess from the length and bit rate.
   */
  size: number | null;
  /**
   * Plain-language note, like "Plays as it is" or "Made on the server first".
   */
  note: string;
}

export interface DownloadOptions {
  fileId: number;
  /**
   * Unit is in seconds.
   */
  duration: number | null;
  options: DownloadOption[];
}

export interface StartDownloadRequest {
  itemId: number;
  quality: DownloadQuality;
  fileId?: number;
  /**
   * Audio stream index for copies. Default is the file's default track.
   */
  audioIndex?: number;
  capabilities: DeviceCapabilities;
}

export interface DownloadSubtitle {
  index: number;
  label: string;
  language: string | null;
  isForced: boolean;
  /**
   * WebVTT, loaded with the sign-in header like the video.
   */
  url: string;
}

/**
 * A download as the server sees it. Its id says what it is (file, size, audio track), so the same request from two
 * profiles shares one copy.
 */
export interface DownloadInfo {
  id: string;
  itemId: number;
  fileId: number;
  quality: DownloadQuality;
  status: "preparing" | "ready" | "failed";
  /**
   * How far making the copy is, 0 to 1. `null` when there's nothing to make or it hasn't started.
   */
  progress: number | null;
  /**
   * Unit is in bytes, once ready.
   */
  size: number | null;
  contentType: string;
  error: string | null;
  /**
   * Text subtitles of the file, saved alongside the video.
   */
  subtitles: DownloadSubtitle[];
}
