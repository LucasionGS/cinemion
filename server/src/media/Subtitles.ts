import fsp from "node:fs/promises";
import Path from "node:path";
import AppSystem from "../AppSystem.ts";
import type MediaFile from "../models/MediaFile.ts";
import Ffmpeg from "../lib/Ffmpeg.ts";

/**
 * Text subtitles pulled out of video files as WebVTT, which the player draws itself.
 */
export namespace Subtitles {
  export const cacheDir = Path.join(AppSystem.config.CACHE_DIR, "subtitles");

  const _pending = new Map<string, Promise<string>>();

  /**
   * Path of a WebVTT copy of the subtitle stream `index`, extracting it the first time.
   * @throws When the stream isn't a text subtitle or ffmpeg can't read it.
   */
  export function toWebVtt(file: MediaFile, index: number): Promise<string> {
    const track = file.subtitles.find((s) => s.index === index);
    if (!track) return Promise.reject(new Error("That subtitle track doesn't exist."));
    if (track.isImage) return Promise.reject(new Error("Picture subtitles can't be turned into text. They are drawn into the video instead."));

    // The file's modification time is part of the name, so a replaced file gets fresh subtitles
    const target = Path.join(cacheDir, `${file.id}-${index}-${file.mtime}.vtt`);
    const pending = _pending.get(target);
    if (pending) return pending;

    const job = (async () => {
      if (await fsp.stat(target).then(() => true).catch(() => false)) return target;
      await fsp.mkdir(cacheDir, { recursive: true });
      const temp = `${target}.${crypto.randomUUID()}.tmp`;
      const result = await Ffmpeg.run(["-y", "-i", file.path, "-map", `0:${index}`, "-c:s", "webvtt", "-f", "webvtt", temp]);
      if (result.code !== 0) {
        await fsp.rm(temp, { force: true });
        throw new Error(`Could not read the subtitles: ${result.stderr.trim().split("\n").pop()}`);
      }
      await fsp.rename(temp, target);
      return target;
    })().finally(() => _pending.delete(target));
    _pending.set(target, job);
    return job;
  }
}

export default Subtitles;
