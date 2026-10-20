import fsp from "node:fs/promises";
import Path from "node:path";
import type { AudioFormat } from "@shared/music.ts";
import AppSystem from "../AppSystem.ts";
import Ffmpeg from "../lib/Ffmpeg.ts";
import log from "../lib/Logger.ts";
import type MediaFile from "../models/MediaFile.ts";

/**
 * Music plays straight from the file when the browser can play it. Anything else (ALAC on Chrome, WMA, APE…) is
 * converted to AAC once and kept in the cache, so seeking works like in any file.
 */
export namespace AudioStream {
  export const cacheDir = Path.join(AppSystem.config.CACHE_DIR, "audio");
  /**
   * Converted tracks nobody played for this long are deleted.
   */
  const KEEP_FOR = 30 * 24 * 60 * 60 * 1000;
  const CONVERTED_BITRATE = "256k";

  // What each codec is called in `AudioFormat`
  const FORMATS: Record<string, AudioFormat> = {
    mp3: "mp3",
    aac: "aac",
    flac: "flac",
    opus: "opus",
    vorbis: "vorbis",
    alac: "alac",
    pcm_s16le: "wav",
    pcm_s24le: "wav",
    pcm_u8: "wav",
  };

  // Containers browsers open, and their media types
  const CONTENT_TYPES: Record<string, string> = {
    mp3: "audio/mpeg",
    mp4: "audio/mp4",
    m4a: "audio/mp4",
    m4b: "audio/mp4",
    flac: "audio/flac",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    wav: "audio/wav",
  };

  const _pending = new Map<string, Promise<string>>();
  let _lastPrune = 0;

  function codecOf(file: MediaFile) {
    return file.audio[0]?.codec ?? null;
  }

  /**
   * The container of `file`, from its extension when ffprobe's name is a family ("mov,mp4,m4a…").
   */
  function containerOf(file: MediaFile) {
    const ext = Path.extname(file.path).slice(1).toLowerCase();
    return CONTENT_TYPES[ext] ? ext : file.container ?? ext;
  }

  /**
   * Whether a browser that plays `formats` can play `file` as it is.
   */
  export function canPlayDirect(file: MediaFile, formats: AudioFormat[]) {
    const format = FORMATS[codecOf(file) ?? ""];
    return !!format && formats.includes(format) && !!CONTENT_TYPES[containerOf(file)];
  }

  export function contentType(file: MediaFile) {
    return CONTENT_TYPES[containerOf(file)] ?? "application/octet-stream";
  }

  /**
   * The cached AAC version of `file`, converting it the first time.
   * @throws When ffmpeg can't read the file.
   */
  export function converted(file: MediaFile): Promise<string> {
    const target = Path.join(cacheDir, `${file.id}-${file.mtime}.m4a`);
    const pending = _pending.get(target);
    if (pending) return pending;
    const job = (async () => {
      if (await fsp.stat(target).then((s) => s.size > 0).catch(() => false)) {
        // Touched, so pruning keeps what's still played
        const now = new Date();
        await fsp.utimes(target, now, now).catch(() => { });
        return target;
      }
      await fsp.mkdir(cacheDir, { recursive: true });
      prune();
      const temp = `${target}.${crypto.randomUUID()}.tmp.m4a`;
      try {
        const result = await Ffmpeg.run(["-y", "-i", file.path, "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", CONVERTED_BITRATE, "-movflags", "+faststart", temp]);
        if (result.code !== 0) {
          log.warn(`Could not convert ${file.path}`, { error: result.stderr.trim().split("\n").pop() });
          throw new Error("This track can't be converted for this browser. The server log has the details.");
        }
        await fsp.rename(temp, target);
        return target;
      } finally {
        await fsp.rm(temp, { force: true });
      }
    })().finally(() => _pending.delete(target));
    _pending.set(target, job);
    return job;
  }

  /**
   * Delete converted tracks nobody played lately. Runs at most once an hour, in the background.
   */
  function prune() {
    if (Date.now() - _lastPrune < 60 * 60 * 1000) return;
    _lastPrune = Date.now();
    (async () => {
      for (const name of await fsp.readdir(cacheDir)) {
        const path = Path.join(cacheDir, name);
        const stat = await fsp.stat(path).catch(() => null);
        if (stat && Date.now() - (stat.mtime?.getTime() ?? 0) > KEEP_FOR) await fsp.rm(path, { force: true });
      }
    })().catch((error) => log.warn("Could not clean up converted music", { error }));
  }
}

export default AudioStream;
