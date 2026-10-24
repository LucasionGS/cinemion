import type { DeviceCapabilities } from "@shared/playback.ts";
import { deviceMode } from "./DeviceMode.ts";
import { devicePrefs } from "./DevicePrefs.ts";

// Sample codec strings for each codec, in the spelling ffprobe uses on the server
const VIDEO: Record<string, string[]> = {
  h264: ['video/mp4; codecs="avc1.640028"'],
  hevc: ['video/mp4; codecs="hvc1.1.6.L120.90"', 'video/mp4; codecs="hev1.1.6.L120.90"'],
  av1: ['video/mp4; codecs="av01.0.08M.08"'],
  vp9: ['video/mp4; codecs="vp09.00.10.08"', 'video/webm; codecs="vp9"'],
};
const AUDIO: Record<string, string[]> = {
  aac: ['audio/mp4; codecs="mp4a.40.2"'],
  mp3: ['audio/mp4; codecs="mp4a.6B"', 'audio/mpeg'],
  ac3: ['audio/mp4; codecs="ac-3"'],
  eac3: ['audio/mp4; codecs="ec-3"'],
  opus: ['audio/mp4; codecs="opus"', 'audio/webm; codecs="opus"'],
  flac: ['audio/mp4; codecs="flac"'],
};

type MediaSourceLike = { isTypeSupported(type: string): boolean };

function mediaSource(): MediaSourceLike | null {
  const w = globalThis as unknown as { MediaSource?: MediaSourceLike; ManagedMediaSource?: MediaSourceLike };
  return w.MediaSource ?? w.ManagedMediaSource ?? null;
}

/**
 * Whether this browser plays HLS through Media Source Extensions (hls.js), or only natively (older iPhones).
 */
export function hasMediaSource() {
  return mediaSource() !== null;
}

let _cached: DeviceCapabilities | null = null;
// The speaker setting changes what's reported, so look again after it changes
devicePrefs.subscribe(() => {
  _cached = null;
});

/**
 * What this browser can decode, sent to the server when playback starts.
 */
export function detectCapabilities(): DeviceCapabilities {
  if (_cached) return _cached;
  const ms = mediaSource();
  const video = document.createElement("video");
  const supported = (types: string[]) => types.some((type) => ms ? ms.isTypeSupported(type) : video.canPlayType(type) !== "");

  const speakers = devicePrefs.speakers;
  const audioCodecs = Object.keys(AUDIO).filter((codec) => supported(AUDIO[codec]));
  // Passing Dolby Digital through lets the device (or the receiver behind it) decode it, even when the browser
  // doesn't say it can
  if (speakers === "passthrough") audioCodecs.push(...["ac3", "eac3"].filter((c) => !audioCodecs.includes(c)));

  _cached = {
    videoCodecs: Object.keys(VIDEO).filter((codec) => supported(VIDEO[codec])),
    audioCodecs,
    containers: ["mp4", "webm"].filter((c) => video.canPlayType(`video/${c}`) !== ""),
    hdr: matchMedia("(dynamic-range: high)").matches,
    // Speakers can't be detected; without a setting, a TV is usually connected to something with surround sound
    maxAudioChannels: { auto: deviceMode.isTv() ? 6 : 2, stereo: 2, surround51: 6, surround71: 8, passthrough: 8 }[speakers],
  };
  return _cached;
}
