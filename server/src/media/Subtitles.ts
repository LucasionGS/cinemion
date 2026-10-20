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
    const track = file.allSubtitles().find((s) => s.index === index);
    if (!track) return Promise.reject(new Error("That subtitle track doesn't exist."));
    if (track.isImage) return Promise.reject(new Error("Picture subtitles can't be turned into text. They are drawn into the video instead."));

    // Subtitle files are converted on their own; tracks are pulled out of the video. The modification time is part
    // of the name, so a replaced file gets fresh subtitles.
    const sidecar = file.sidecarFor(index);
    const source = sidecar?.path ?? file.path;
    const key = sidecar ? `${file.id}-file-${hash(sidecar.path)}` : `${file.id}-${index}`;
    const target = Path.join(cacheDir, `${key}-${file.mtime}.vtt`);
    const pending = _pending.get(target);
    if (pending) return pending;

    const job = (async () => {
      // A subtitle file can change without the video changing
      const sourceTime = sidecar ? (await fsp.stat(sidecar.path).catch(() => null))?.mtimeMs ?? 0 : 0;
      const cached = await fsp.stat(target).catch(() => null);
      if (cached && cached.mtimeMs >= sourceTime) return target;
      await fsp.mkdir(cacheDir, { recursive: true });
      const temp = `${target}.${crypto.randomUUID()}.tmp`;
      const encoding = sidecar ? await textEncoding(sidecar.path) : null;
      const result = await Ffmpeg.run(["-y", ...(encoding ? ["-sub_charenc", encoding] : []), "-i", source, "-map", sidecar ? "0:s:0" : `0:${index}`, "-c:s", "webvtt", "-f", "webvtt", temp]);
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

/**
 * `null` for UTF-8 files, otherwise the most likely older encoding. Subtitle files from the web are often Windows-1252.
 */
async function textEncoding(path: string) {
  const bytes = await Deno.readFile(path).catch(() => null);
  if (!bytes) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return null;
  } catch {
    return "CP1252";
  }
}

function hash(value: string) {
  // FNV-1a: short, stable names for cache files
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export default Subtitles;
