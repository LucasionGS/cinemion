import { Op } from "sequelize";
import AppSystem from "../AppSystem.ts";
import { Library, MediaFile } from "../models/index.ts";
import Tasks from "../lib/Tasks.ts";
import log from "../lib/Logger.ts";

/**
 * Keeps track of broken files: ones that can't be read, are cut short or damaged, or stopped converting partway. The
 * reason is kept on the file for the upkeep page, and cleared once the file reads fine again.
 */
export namespace FileHealth {
  /**
   * Library types whose files ffmpeg can play through. Photos and books are left out.
   */
  const PLAYABLE = ["movies", "shows", "videos", "clips", "music", "audiobooks"];

  /**
   * The line of an ffmpeg or ffprobe complaint that says most, without the decoder tags and the file's path.
   */
  export function readable(message: string, path?: string) {
    // Example: [matroska,webm @ 0x5608dd64fc00] File ended prematurely
    const lines = message.replace(/^Could not read the file as media:\s*/, "").split("\n")
      .map((l) => l.replace(/^\[[^\]]+\]\s*/, "").replace(path ? `${path}: ` : "\u0000", "").trim())
      .filter(Boolean);
    // The most telling kinds of complaint first
    const patterns = [/invalid data|moov atom not found|header parsing failed/i, /ended prematurely|corrupt|truncat/i, /no such file|permission denied/i];
    const telling = patterns.map((p) => lines.find((l) => p.test(l))).find(Boolean);
    const line = telling ?? lines.at(-1) ?? message;
    return line.charAt(0).toUpperCase() + line.slice(1).replace(/\.?$/, ".");
  }

  export async function report(fileId: number, problem: string) {
    await MediaFile.update({ problem: problem.slice(0, 512) }, { where: { id: fileId } });
  }

  export async function clear(fileId: number) {
    await MediaFile.update({ problem: null }, { where: { id: fileId, problem: { [Op.ne]: null } } });
  }

  /**
   * The first useful line ffmpeg complained with.
   */
  function firstError(stderr: string) {
    return stderr.split("\n").map((l) => l.trim()).find((l) => l && !/^(Last message repeated|frame=|size=)/.test(l)) ?? null;
  }

  /**
   * Decode part of a file and throw the result away.
   * @param input Options for reading the input, like where to start.
   */
  async function decode(path: string, input: string[]) {
    const { code, stderr } = await new Deno.Command(AppSystem.config.FFMPEG_PATH, {
      args: ["-v", "error", "-nostdin", ...input, "-i", path, "-f", "null", "-"],
      stdout: "null",
      stderr: "piped",
    }).output();
    const text = new TextDecoder().decode(stderr);
    return { ok: code === 0, error: firstError(text) ? readable(text, path) : null };
  }

  /**
   * Play the start and the end of a file through ffmpeg, which finds files that are cut short or damaged.
   * @returns What's wrong, or `null`.
   */
  export async function check(file: MediaFile): Promise<string | null> {
    if (await Deno.stat(file.path).then(() => false).catch(() => true)) return "The file isn't there any more.";
    // What reading the file said is more telling than this
    if (!file.duration && file.probedAt) return file.problem ?? "Cinemion can't read how long it is. It's probably damaged or not a media file.";
    const start = await decode(file.path, ["-t", "10"]);
    if (!start.ok) return `It won't play from the start: ${start.error ?? "ffmpeg gave up"}`;
    if (file.duration && file.duration > 60) {
      const end = await decode(file.path, ["-ss", String(Math.max(0, file.duration - 20))]);
      if (!end.ok || (end.error && /ended prematurely|invalid data|truncat|end of file|corrupt|error while decoding/i.test(end.error))) {
        return `It's cut short or damaged near the end: ${end.error ?? "ffmpeg gave up"}`;
      }
    }
    return null;
  }

  /**
   * Check every playable file (of one library, or all), as a background task.
   * @param onlyNew Only files never checked, or changed since.
   */
  export function checkAll(libraryId: number | null, onlyNew = false) {
    return Tasks.run(`check-files-${libraryId ?? "all"}`, "Checking files", { libraryId: libraryId ?? undefined, queue: "upkeep" }, async (task) => {
      const libraries = await Library.findAll({ where: { ...(libraryId ? { id: libraryId } : {}), type: PLAYABLE } });
      const files = await MediaFile.findAll({ where: { libraryId: libraries.map((l) => l.id), ...(onlyNew ? { checkedAt: null } : {}) }, order: [["path", "ASC"]] });
      let found = 0;
      for (const [i, file] of files.entries()) {
        task.update(`Checking files (${i + 1} of ${files.length})`, files.length ? i / files.length : null);
        const problem = await check(file).catch((error) => `It couldn't be checked: ${(error as Error).message}`);
        await file.update({ problem, checkedAt: new Date() });
        if (problem) found++;
      }
      log.info("Checked files", { files: files.length, broken: found });
      return { files: files.length, broken: found };
    });
  }
}

export default FileHealth;
