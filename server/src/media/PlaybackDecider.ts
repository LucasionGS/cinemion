import type { MediaFileInfo } from "@shared/media.ts";
import type { DeviceCapabilities, PlaybackMode, PlaybackSettings, QualityPreset, QualityRung } from "@shared/playback.ts";

/**
 * Picks the cheapest way to play a file on a device: the file as-is, repackaged, or converted.
 */
export namespace PlaybackDecider {
  export interface Request {
    capabilities: DeviceCapabilities;
    quality: QualityPreset;
    /**
     * Audio stream index, or `null` for the file's default track.
     */
    audioIndex: number | null;
    subtitleIndex: number | null;
    /**
     * The viewer is outside the local network.
     */
    isRemote: boolean;
  }

  export interface Decision {
    mode: PlaybackMode;
    video: {
      /**
       * Codec of the source video.
       */
      source: string;
      /**
       * Codec of the video that's sent.
       */
      codec: string;
      action: "copy" | "convert";
      /**
       * Output height when converting, `null` to keep the source size.
       */
      height: number | null;
      /**
       * Target bitrate when converting, in bits per second.
       */
      bitrate: number | null;
      toneMap: boolean;
      /**
       * Image subtitle stream to draw into the video.
       */
      burnSubtitle: number | null;
      /**
       * Automatic quality: every quality to make at once, best first. `null` for a single quality.
       */
      ladder: QualityRung[] | null;
    };
    audio: { index: number; codec: string; action: "copy" | "convert"; channels: number } | null;
    reasons: string[];
  }

  export const QUALITY: Record<Exclude<QualityPreset, "original" | "auto">, { height: number; bitrate: number }> = {
    "1080p": { height: 1080, bitrate: 8_000_000 },
    "720p": { height: 720, bitrate: 4_000_000 },
    "480p": { height: 480, bitrate: 1_500_000 },
  };

  // Rungs automatic quality picks from, best first. Three at most, since every rung is a conversion of its own.
  const LADDER: QualityRung[] = [
    { height: 1080, bitrate: 8_000_000 },
    { height: 720, bitrate: 4_000_000 },
    { height: 480, bitrate: 1_500_000 },
    { height: 360, bitrate: 800_000 },
  ];
  const LADDER_RUNGS = 3;

  /**
   * The qualities automatic quality makes for a video `sourceHeight` lines high: the source size (up to 1080p) and
   * the steps below it, leaving out rungs over `maxBitrate` but always keeping the smallest.
   */
  export function ladderFor(sourceHeight: number, maxBitrate: number | null): QualityRung[] {
    const fits = LADDER.filter((r) => r.height <= sourceHeight * 1.05);
    const rungs = (fits.length ? fits : [LADDER[LADDER.length - 1]]).slice(0, LADDER_RUNGS);
    const allowed = maxBitrate === null ? rungs : rungs.filter((r) => r.bitrate <= maxBitrate);
    return allowed.length ? allowed : [rungs[rungs.length - 1]];
  }

  // What fMP4 HLS segments can carry without converting
  const HLS_VIDEO = new Set(["h264", "hevc", "av1", "vp9"]);
  const HLS_AUDIO = new Set(["aac", "mp3", "ac3", "eac3", "opus", "flac"]);
  // Containers a browser plays straight from the file, and the codecs each one may hold
  const DIRECT_CONTAINERS: Record<string, string> = { mp4: "mp4", m4v: "mp4", mov: "mp4", webm: "webm" };

  const CODEC_NAMES: Record<string, string> = {
    h264: "H.264", hevc: "HEVC", av1: "AV1", vp9: "VP9", vp8: "VP8", mpeg2video: "MPEG-2", mpeg4: "MPEG-4", vc1: "VC-1",
    aac: "AAC", mp3: "MP3", ac3: "Dolby Digital", eac3: "Dolby Digital Plus", truehd: "Dolby TrueHD", dts: "DTS", opus: "Opus", flac: "FLAC", vorbis: "Vorbis",
    pcm_s16le: "PCM", pcm_s24le: "PCM",
  };

  /**
   * Readable name of a codec, like "Dolby Digital" for ac3.
   */
  export function codecName(codec: string) {
    return CODEC_NAMES[codec] ?? codec.toUpperCase();
  }

  /**
   * A sensible bitrate for H.264 at `height` lines.
   */
  function bitrateFor(height: number) {
    if (height >= 2000) return 20_000_000;
    if (height >= 1400) return 14_000_000;
    if (height >= 1000) return 10_000_000;
    if (height >= 700) return 5_000_000;
    return 2_500_000;
  }

  /**
   * The largest preset height that fits within `bitrate`.
   */
  function heightForBitrate(bitrate: number) {
    if (bitrate >= QUALITY["1080p"].bitrate) return 1080;
    if (bitrate >= QUALITY["720p"].bitrate) return 720;
    return 480;
  }

  function mbps(bitrate: number) {
    return `${Math.round(bitrate / 100_000) / 10} Mbps`;
  }

  export function decide(file: MediaFileInfo, request: Request, settings: PlaybackSettings): Decision {
    const caps = request.capabilities;
    const reasons: string[] = [];
    const sourceCodec = file.videoCodec ?? "unknown";
    const sourceHeight = file.height ?? 1080;
    const sourceBitrate = file.bitrate ?? null;

    //#region Audio
    const track = (request.audioIndex !== null ? file.audio.find((a) => a.index === request.audioIndex) : null)
      ?? file.audio.find((a) => a.isDefault) ?? file.audio[0] ?? null;
    let audio: Decision["audio"] = null;
    if (track) {
      const playable = caps.audioCodecs.includes(track.codec) && HLS_AUDIO.has(track.codec);
      if (playable) {
        audio = { index: track.index, codec: track.codec, action: "copy", channels: track.channels };
      }
      else {
        const channels = Math.min(track.channels, caps.maxAudioChannels, 6);
        audio = { index: track.index, codec: "aac", action: "convert", channels };
        reasons.push(`This device can't play ${codecName(track.codec)} audio, so it's converted to AAC${channels > 2 ? ` ${channels === 6 ? "5.1" : `${channels} channel`}` : " stereo"}.`);
      }
    }
    //#endregion

    //#region Video
    const subtitle = request.subtitleIndex !== null ? file.subtitles.find((s) => s.index === request.subtitleIndex) : null;
    const burnSubtitle = subtitle?.isImage ? subtitle.index : null;
    const toneMap = !!file.hdr && !caps.hdr && settings.toneMapping;

    let maxHeight: number | null = null;
    let maxBitrate: number | null = null;
    if (request.quality !== "original" && request.quality !== "auto") {
      maxHeight = QUALITY[request.quality].height;
      maxBitrate = QUALITY[request.quality].bitrate;
    }
    const remoteCap = request.isRemote && settings.remoteMaxBitrate > 0 ? settings.remoteMaxBitrate : null;
    if (remoteCap && (maxBitrate === null || remoteCap < maxBitrate)) {
      maxBitrate = remoteCap;
      maxHeight = Math.min(maxHeight ?? Infinity, heightForBitrate(remoteCap));
    }

    const auto = request.quality === "auto";
    const convertReasons: string[] = [];
    if (auto) convertReasons.push("Automatic quality: converted to several qualities at once, so the player can switch as the connection changes.");
    if (!caps.videoCodecs.includes(sourceCodec) || !HLS_VIDEO.has(sourceCodec)) convertReasons.push(`This device can't play ${codecName(sourceCodec)} video, so it's converted to H.264.`);
    if (burnSubtitle !== null) convertReasons.push(`${subtitle!.codec === "hdmv_pgs_subtitle" ? "PGS" : "Picture"} subtitles are drawn into the video.`);
    if (toneMap) convertReasons.push("HDR is converted to SDR for this screen.");
    // With automatic quality, the ladder takes care of size and bitrate
    if (!auto && maxHeight !== null && sourceHeight > maxHeight * 1.05) convertReasons.push(`Scaled down to ${maxHeight}p.`);
    else if (!auto && maxBitrate !== null && sourceBitrate !== null && sourceBitrate > maxBitrate * 1.1) {
      convertReasons.push(remoteCap !== null && remoteCap === maxBitrate
        ? `Limited to ${mbps(maxBitrate)} for viewers outside the home network.`
        : `Limited to ${mbps(maxBitrate)}.`);
    }

    const convert = convertReasons.length > 0;
    let height: number | null = null;
    let bitrate: number | null = null;
    const ladder = auto ? ladderFor(sourceHeight, remoteCap) : null;
    if (ladder) {
      height = ladder[0].height;
      bitrate = ladder[0].bitrate;
      reasons.unshift(...convertReasons);
    }
    else if (convert) {
      height = maxHeight !== null && sourceHeight > maxHeight ? maxHeight : null;
      const outHeight = height ?? sourceHeight;
      // Newer codecs pack the same picture into fewer bits than H.264
      const efficiency = ["hevc", "av1", "vp9"].includes(sourceCodec) ? 1.6 : 1.1;
      bitrate = Math.min(bitrateFor(outHeight), sourceBitrate ? Math.max(sourceBitrate * efficiency, 1_000_000) : Infinity);
      if (maxBitrate !== null) bitrate = Math.min(bitrate, maxBitrate);
      bitrate = Math.round(bitrate);
      reasons.unshift(...convertReasons);
    }
    //#endregion

    const video: Decision["video"] = { source: sourceCodec, codec: convert ? "h264" : sourceCodec, action: convert ? "convert" : "copy", height, bitrate, toneMap: convert && toneMap, burnSubtitle, ladder };

    // Browsers only play the first audio track of a file, so another track needs HLS
    const firstAudio = file.audio.find((a) => a.isDefault) ?? file.audio[0] ?? null;
    const container = DIRECT_CONTAINERS[file.container ?? ""];
    const direct = !convert && audio?.action !== "convert" && !!container && caps.containers.includes(container)
      && (audio === null || audio.index === firstAudio?.index);

    let mode: PlaybackMode = "direct";
    if (convert || audio?.action === "convert") mode = "transcode";
    else if (!direct) {
      mode = "remux";
      if (!container || !caps.containers.includes(container)) reasons.push(`The ${(file.container ?? "file").toUpperCase()} file is repackaged for this device. The picture and sound aren't changed.`);
      else reasons.push("Another audio track is picked, so the file is repackaged. The picture and sound aren't changed.");
    }
    if (mode === "direct") reasons.push("Plays the original file. Nothing is converted.");

    return { mode, video, audio, reasons };
  }
}

export default PlaybackDecider;
