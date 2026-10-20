import type { AudioTrack, SubtitleTrack } from "@shared/media.ts";
import Ffmpeg from "../lib/Ffmpeg.ts";

/**
 * Turns ffprobe output into what Cinemion stores about a video file.
 */
export namespace Probe {
  export interface FileDetails {
    container: string | null;
    duration: number | null;
    bitrate: number | null;
    videoCodec: string | null;
    width: number | null;
    height: number | null;
    hdr: string | null;
    audio: AudioTrack[];
    subtitles: SubtitleTrack[];
  }

  const IMAGE_SUBTITLES = new Set(["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub"]);

  /**
   * Read a video file's container, streams and length.
   * @throws When ffprobe can't read the file.
   */
  export async function read(path: string): Promise<FileDetails> {
    const probe = await Ffmpeg.probe(path);
    // Cover art in MKV/MP4 shows up as a video stream; skip it
    const video = probe.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
    const duration = probe.format.duration ? parseFloat(probe.format.duration) : null;

    return {
      container: containerName(probe.format.format_name, path),
      duration: duration && Number.isFinite(duration) ? duration : null,
      bitrate: probe.format.bit_rate ? parseInt(probe.format.bit_rate) : null,
      videoCodec: video?.codec_name ?? null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      hdr: video ? hdrKind(video) : null,
      audio: probe.streams.filter((s) => s.codec_type === "audio").map((s) => ({
        index: s.index,
        codec: s.codec_name ?? "unknown",
        channels: s.channels ?? 2,
        language: language(s.tags?.language),
        title: s.tags?.title ?? null,
        isDefault: !!s.disposition?.default,
      })),
      subtitles: probe.streams.filter((s) => s.codec_type === "subtitle").map((s) => ({
        index: s.index,
        codec: s.codec_name ?? "unknown",
        language: language(s.tags?.language),
        title: s.tags?.title ?? null,
        isDefault: !!s.disposition?.default,
        isForced: !!s.disposition?.forced,
        isImage: IMAGE_SUBTITLES.has(s.codec_name ?? ""),
        external: false,
        isHearingImpaired: !!s.disposition?.hearing_impaired || /\b(sdh|cc|hearing)/i.test(s.tags?.title ?? ""),
      })),
    };
  }

  /**
   * ffprobe names containers by family ("matroska,webm", "mov,mp4,m4a,..."); pick the one this file really is.
   */
  function containerName(formatName: string, path: string) {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const names = formatName.split(",");
    if (names.includes(ext)) return ext;
    if (names.includes("matroska")) return ext === "webm" ? "webm" : "mkv";
    if (names.includes("mp4") || names.includes("mov")) return ext === "mov" ? "mov" : "mp4";
    return names[0] || null;
  }

  function hdrKind(video: Ffmpeg.ProbeStream) {
    if (video.side_data_list?.some((d) => d.side_data_type?.toLowerCase().includes("dovi"))) return "dolby-vision";
    if (video.color_transfer === "smpte2084") return "hdr10";
    if (video.color_transfer === "arib-std-b67") return "hlg";
    return null;
  }

  function language(code: string | undefined) {
    return code && code !== "und" ? code : null;
  }
}

export default Probe;
