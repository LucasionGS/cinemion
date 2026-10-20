/**
 * Types for starting playback and for the server's playback settings.
 */

/**
 * What the browser can decode, so the server can pick the cheapest way to play a file.
 * Codec names use ffprobe's spelling: h264, hevc, av1, vp9, aac, opus, ac3, eac3...
 */
export interface DeviceCapabilities {
  videoCodecs: string[];
  audioCodecs: string[];
  /**
   * Containers the browser plays straight from a file: mp4, webm.
   */
  containers: string[];
  /**
   * The screen can show HDR. Without it, HDR video is converted to SDR.
   */
  hdr: boolean;
  /**
   * Largest audio channel count worth keeping (2 for stereo, 6 for 5.1).
   */
  maxAudioChannels: number;
}

/**
 * Quality the viewer picked. `original` plays the file as-is when the device can.
 */
export type QualityPreset = "original" | "1080p" | "720p" | "480p";

export interface StartPlaybackRequest {
  /**
   * Which version of a movie. Default is the best one.
   */
  fileId?: number;
  /**
   * Audio stream index from `MediaFileInfo.audio`. Default is the file's default track.
   */
  audioIndex?: number;
  /**
   * Subtitle stream index, or `null` for none. Only image subtitles change how the video is made;
   * text subtitles are drawn by the player.
   */
  subtitleIndex?: number | null;
  /**
   * Where to start, in seconds.
   */
  startAt?: number;
  quality?: QualityPreset;
  capabilities: DeviceCapabilities;
}

export type PlaybackMode = "direct" | "remux" | "transcode";

export interface SubtitleOption {
  index: number;
  label: string;
  language: string | null;
  /**
   * Second line in the menu, like "Forced · Text".
   */
  detail: string;
  isForced: boolean;
  isDefault: boolean;
  /**
   * WebVTT for text subtitles. `null` for image subtitles, which are burned into the video instead.
   */
  url: string | null;
}

export interface AudioOption {
  index: number;
  label: string;
  language: string | null;
  /**
   * Second line in the menu, like "Dolby Digital · Portuguese".
   */
  detail: string;
  isDefault: boolean;
}

export interface PlaybackInfo {
  /**
   * `direct` plays the file; `remux` repackages it without converting; `transcode` converts some or all of it.
   */
  mode: PlaybackMode;
  /**
   * A video file for `direct`, an HLS playlist otherwise.
   */
  url: string;
  /**
   * The HLS session, to stop it when playback ends. `null` for direct play.
   */
  sessionId: string | null;
  /**
   * Where the stream really starts, in seconds. The player adds this to the video's own time.
   */
  startOffset: number;
  /**
   * Length of the whole file, in seconds.
   */
  duration: number;
  fileId: number;
  audioIndex: number | null;
  subtitleIndex: number | null;
  quality: QualityPreset;
  audio: AudioOption[];
  subtitles: SubtitleOption[];
  /**
   * Plain-language notes on why something is converted, for the Quality panel.
   */
  reasons: string[];
  video: {
    /**
     * Codec that's sent, and `source` the file's own.
     */
    codec: string;
    source: string;
    action: "copy" | "convert";
    /**
     * GPU method converting the video, `none` for the CPU, `null` when not converting.
     */
    hardware: HardwareAcceleration | null;
    height: number | null;
    hdr: string | null;
    /**
     * Unit is in bits per second.
     */
    bitrate: number | null;
  };
  audioStream: { codec: string; source: string; action: "copy" | "convert"; channels: number } | null;
  /**
   * The server sees this device as outside the home network.
   */
  isRemote: boolean;
  /**
   * Seek thumbnails, or `null` while they haven't been made yet. `{streamBase}/trickplay` answers once they're ready.
   */
  trickplay: TrickplayInfo | null;
  /**
   * Base URL of this stream's extras (subtitles, thumbnails).
   */
  streamBase: string;
  /**
   * Whether this profile may search and download subtitles.
   */
  canSearchSubtitles: boolean;
}

/**
 * Seek thumbnails: small frames every `interval` seconds, packed into grid images ("sheets").
 */
export interface TrickplayInfo {
  /**
   * Seconds between thumbnails. Thumbnail `n` shows the frame at `n * interval`.
   */
  interval: number;
  /**
   * Size of one thumbnail, in pixels.
   */
  width: number;
  height: number;
  columns: number;
  rows: number;
  count: number;
  /**
   * URL of sheet `n`, with `{n}` to replace.
   */
  sheetUrl: string;
}

export type HardwareAcceleration = "none" | "vaapi" | "qsv" | "nvenc";

export interface PlaybackSettings {
  hardwareAcceleration: HardwareAcceleration;
  /**
   * Render device for VA-API and Quick Sync, like /dev/dri/renderD128.
   */
  device: string;
  /**
   * Codecs the GPU should decode. Others are decoded on the CPU.
   */
  hardwareDecodeCodecs: string[];
  /**
   * Starting more conversions than this is refused until one stops.
   */
  maxConversions: number;
  preset: "fast" | "balanced" | "quality";
  /**
   * Convert HDR to SDR for screens that can't show HDR.
   */
  toneMapping: boolean;
  /**
   * Bitrate cap for viewers outside the local network, in bits per second. 0 = no cap.
   */
  remoteMaxBitrate: number;
  allowRemoteConversion: boolean;
  /**
   * Make seek thumbnails for new videos in the background.
   */
  seekThumbnails: boolean;
}

export interface HardwareDevice {
  kind: HardwareAcceleration;
  label: string;
  device: string | null;
  available: boolean;
  detail: string;
}

export interface HardwareTestResult {
  ok: boolean;
  /**
   * How much faster than real time the test conversion ran, e.g. 8 for 8×.
   */
  speed: number | null;
  message: string;
}

export interface PlaybackDevices {
  devices: HardwareDevice[];
  /**
   * Size of the conversion cache, in bytes.
   */
  cacheSize: number;
  cacheDir: string;
  /**
   * Size of the seek thumbnails, in bytes.
   */
  thumbnailsSize: number;
}

//#region Subtitles

export interface SubtitleSettings {
  /**
   * OpenSubtitles API key ("consumer"), from opensubtitles.com. `null` = not set up.
   */
  openSubtitlesApiKey: string | null;
  /**
   * Optional OpenSubtitles account, for a bigger daily download allowance.
   */
  openSubtitlesUsername: string | null;
  /**
   * Write-only: the server never sends it back. `null` keeps the saved one; empty clears it.
   */
  openSubtitlesPassword?: string | null;
  hasOpenSubtitlesPassword?: boolean;
  /**
   * Languages offered first when searching, as ISO 639-1 codes.
   */
  languages: string[];
  /**
   * Save downloads next to the video file. When the folder is read-only (or this is off), they go to the config folder.
   */
  saveNextToVideo: boolean;
}

export interface SubtitleSearchResult {
  provider: string;
  /**
   * Provider's id for the download.
   */
  id: string;
  name: string;
  language: string;
  isHearingImpaired: boolean;
  /**
   * Made for this exact file (same file hash), so the timing is right.
   */
  matchesFile: boolean;
  downloads: number;
  rating: number | null;
  uploadedAt: string | null;
  /**
   * Plain-language notes, like "Machine translated" or "Different frame rate".
   */
  notes: string[];
}

export interface SubtitleDownloadRequest {
  fileId: number;
  provider: string;
  id: string;
  language: string;
  isHearingImpaired: boolean;
}

//#endregion
