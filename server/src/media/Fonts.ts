import fsp from "node:fs/promises";
import Path from "node:path";
import AppSystem from "../AppSystem.ts";
import type MediaFile from "../models/MediaFile.ts";

/**
 * Fonts attached to video files (MKV attachments), which styled ASS subtitles are usually written for.
 */
export namespace Fonts {
  export const cacheDir = Path.join(AppSystem.config.CACHE_DIR, "fonts");
  const FONT_FILE = /\.(ttf|otf|ttc|woff2?)$/i;

  const _pending = new Map<string, Promise<string[]>>();

  function dirFor(file: MediaFile) {
    return Path.join(cacheDir, `${file.id}-${file.mtime}`);
  }

  async function attachmentCount(path: string) {
    // Example output: one "attachment" line per attached file
    const result = await new Deno.Command(AppSystem.config.FFPROBE_PATH, {
      args: ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", path],
      stdout: "piped",
      stderr: "null",
    }).output().catch(() => null);
    if (!result?.success) return 0;
    return new TextDecoder().decode(result.stdout).split("\n").filter((l) => l.trim() === "attachment").length;
  }

  /**
   * File names of the fonts attached to `file`, extracting them the first time.
   */
  export function list(file: MediaFile): Promise<string[]> {
    const dir = dirFor(file);
    const pending = _pending.get(dir);
    if (pending) return pending;
    const job = (async () => {
      const existing = await fsp.readdir(dir).catch(() => null);
      if (existing) return existing.filter((n) => FONT_FILE.test(n)).sort();
      if (await attachmentCount(file.path) === 0) {
        await fsp.mkdir(dir, { recursive: true });
        return [];
      }
      const temp = `${dir}.${crypto.randomUUID()}.tmp`;
      await fsp.mkdir(temp, { recursive: true });
      // ffmpeg writes every attachment into the working folder under its own name. It wants an output too, so a
      // null output with no streams ends right away (and exits with an error, which doesn't matter here).
      await new Deno.Command(AppSystem.config.FFMPEG_PATH, {
        args: ["-hide_banner", "-loglevel", "error", "-y", "-dump_attachment:t", "", "-i", file.path, "-t", "0", "-f", "null", "-"],
        cwd: temp,
        stdin: "null",
        stdout: "null",
        stderr: "null",
      }).output().catch(() => null);
      for (const name of await fsp.readdir(temp)) {
        if (!FONT_FILE.test(name)) await fsp.rm(Path.join(temp, name), { force: true });
      }
      await fsp.rm(dir, { recursive: true, force: true });
      await fsp.rename(temp, dir);
      return (await fsp.readdir(dir)).sort();
    })().finally(() => _pending.delete(dir));
    _pending.set(dir, job);
    return job;
  }

  /**
   * Path of one attached font, or `null` when there's no such font.
   */
  export async function path(file: MediaFile, name: string) {
    const names = await list(file);
    return names.includes(name) ? Path.join(dirFor(file), name) : null;
  }
}

export default Fonts;
