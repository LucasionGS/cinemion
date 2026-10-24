import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import Path from "node:path";
import { encodeHex } from "@std/encoding/hex";
import type { ShareCopyInfo, ShareCopyRequest, TrimRequest } from "@shared/clips.ts";
import AppSystem from "../AppSystem.ts";
import { Library, MediaFile, MediaItem } from "../models/index.ts";
import Scanner from "../library/Scanner.ts";
import Tasks from "../lib/Tasks.ts";
import Ffmpeg from "../lib/Ffmpeg.ts";
import { errorMessage } from "../lib/http.ts";
import ClipLibrary from "./ClipLibrary.ts";
import log from "../lib/Logger.ts";

/**
 * Working with clip files: cutting them down without converting, and making small copies that fit a chat app's
 * upload limit.
 */
export namespace ClipTools {
  export const sharesDir = Path.join(AppSystem.config.CACHE_DIR, "shares");

  // Small copies are kept this long, so the link can be passed on for a while
  const SHARE_LIFETIME_MS = 24 * 60 * 60 * 1000;
  // Containers keep some bytes for themselves; this much of the limit goes to the video and sound
  const SIZE_USE = 0.96;
  const MIN_VIDEO_KBPS = 150;
  // Highest copy for a bitrate: below these, fewer pixels look better than blocky ones
  const HEIGHT_STEPS: [kbps: number, height: number][] = [[4500, 1080], [2200, 720], [1100, 540], [600, 480], [0, 360]];

  const _keyframes = new Map<string, number[]>();

  export class Problem extends Error {
    constructor(message: string, public readonly status: 400 | 403 | 404 | 500 = 400) {
      super(message);
    }
  }

  /**
   * Remove small copies left from before a restart; their jobs are gone with it.
   */
  export async function init() {
    await fsp.rm(sharesDir, { recursive: true, force: true }).catch(() => { });
  }

  //#region Keyframes

  /**
   * Where a clip's keyframes are, in seconds. A cut without converting can only start at one of them.
   */
  export async function keyframes(file: MediaFile): Promise<number[]> {
    const id = `${file.id}:${file.mtime}`;
    const known = _keyframes.get(id);
    if (known) return known;
    // Packets are read without decoding anything, so this is quick even for long recordings.
    // Example output: 0.000000,K__
    const result = await new Deno.Command(AppSystem.config.FFPROBE_PATH, {
      args: ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", file.path],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!result.success) throw new Problem("Cinemion couldn't read the clip's keyframes. The server log may have more.", 500);
    const times = new TextDecoder().decode(result.stdout).split("\n")
      .filter((line) => line.split(",")[1]?.includes("K"))
      .map((line) => parseFloat(line.split(",")[0]))
      .filter((t) => !isNaN(t))
      .sort((a, b) => a - b);
    // The first packet's time can be a little above zero; a cut "from the start" means from the start
    const list = times.length ? [0, ...times.filter((t) => t > 0.05)] : [0];
    if (_keyframes.size > 200) _keyframes.clear();
    _keyframes.set(id, list);
    return list;
  }
  //#endregion

  //#region Trimming

  /**
   * Refuse when Cinemion can't write in `folder`, saying how to allow it.
   */
  async function checkWritable(folder: string) {
    const writable = await fsp.access(folder, fs.constants.W_OK).then(() => true).catch(() => false);
    if (writable) return;
    // The packaged systemd service runs as the "cinemion" user, with the system mounted read-only
    const hint = AppSystem.isDocker
      ? " In Docker, mount the media folder without :ro."
      : os.userInfo().username === "cinemion" ? ` As a system service, allow it with "systemctl edit cinemion": [Service] ReadWritePaths=${folder}` : "";
    throw new Problem(`Cinemion isn't allowed to write in "${folder}", so it can't save the cut. Give the user it runs as write access to that folder.${hint}`, 403);
  }

  /**
   * The ffmpeg format for a file's extension, so a temporary name can keep the right one.
   */
  function formatFor(path: string) {
    const ext = Path.extname(path).toLowerCase();
    if (ext === ".mkv") return "matroska";
    if (ext === ".webm") return "webm";
    if (ext === ".mov") return "mov";
    if (ext === ".ts" || ext === ".m2ts") return "mpegts";
    if (ext === ".avi") return "avi";
    if (ext === ".flv") return "flv";
    return "mp4";
  }

  async function freeName(dir: string, name: string, ext: string) {
    for (let n = 1; n < 1000; n++) {
      const candidate = Path.join(dir, `${name}${n === 1 ? "" : ` ${n}`}${ext}`);
      if (!await fsp.stat(candidate).then(() => true).catch(() => false)) return candidate;
    }
    throw new Problem("There are too many cut versions of this clip already. Rename or remove some first.");
  }

  /**
   * Cut a clip down to `start`–`end` without converting it. The cut starts at the keyframe at or before `start`.
   * Either the original file is replaced, or the cut is saved next to it as a new clip, with the same game and
   * details.
   * @returns The clip that holds the cut.
   * @throws `Problem` when the times don't work or the file can't be written.
   */
  export async function trim(clip: MediaItem, file: MediaFile, request: TrimRequest): Promise<MediaItem> {
    const library = await Library.findByPk(clip.libraryId);
    if (!library) throw new Problem("That library doesn't exist.", 404);
    const duration = file.duration ?? 0;
    const end = Math.min(Number(request.end), duration || Infinity);
    const frames = await keyframes(file);
    const start = [...frames].reverse().find((t) => t <= Math.max(0, Number(request.start)) + 0.001) ?? 0;
    if (!(end > start + 0.5)) throw new Problem("Keep at least half a second of the clip.");
    if (start < 0.05 && duration && end >= duration - 0.05) throw new Problem("That's the whole clip. Move the start or the end to cut something off.");

    const { dir, name, ext } = Path.parse(file.path);
    await checkWritable(dir);
    const temp = Path.join(dir, `.${name}.cinemion-trim${ext}`);
    const target = request.replace ? file.path : await freeName(dir, `${name} (cut)`, ext);

    return await Tasks.run(`trim:${clip.id}`, "Cutting a clip", { libraryId: library.id, queue: "clips" }, async (task) => {
      task.update("Cutting");
      try {
        const args = [
          "-y", "-ss", start.toFixed(3), "-i", file.path, "-t", (end - start).toFixed(3),
          "-map", "0:v:0", "-map", "0:a?", "-map", "0:s?", "-c", "copy", "-ignore_unknown",
          "-avoid_negative_ts", "make_zero", "-map_metadata", "0",
          ...(formatFor(file.path) === "mp4" || formatFor(file.path) === "mov" ? ["-movflags", "+faststart"] : []),
          "-f", formatFor(file.path), temp,
        ];
        const result = await Ffmpeg.run(args);
        if (result.code !== 0 || !await fsp.stat(temp).then((s) => s.size > 0).catch(() => false)) {
          log.warn(`Could not cut ${file.path}`, { error: result.stderr.trim().split("\n").slice(-3).join(" ") });
          throw new Problem("The clip couldn't be cut. The server log has ffmpeg's reason.", 500);
        }
        await fsp.rename(temp, target);
      } catch (error) {
        await fsp.rm(temp, { force: true });
        if (error instanceof Problem) throw error;
        throw new Problem(`The cut couldn't be saved: ${errorMessage(error)}`, 500);
      }

      task.update("Adding to the library");
      if (request.replace) {
        // The same clip, with a shorter file: its length, thumbnail and seek thumbnails are made again
        clip.metadataUpdatedAt = null;
        await clip.save();
        await Scanner.scanFoldersNow(library, [dir]);
        await clip.reload();
        return clip;
      }

      await Scanner.scanFoldersNow(library, [dir]);
      const cutFile = await MediaFile.findOne({ where: { path: target } });
      const cut = cutFile?.itemId ? await MediaItem.findByPk(cutFile.itemId) : null;
      if (!cut) throw new Problem("The cut was saved, but didn't show up in the library. Try scanning it.", 500);
      // The cut is the same moment of the same game
      cut.parentId = clip.parentId;
      cut.clip = { hint: null, steamAppId: null, titled: false, suggestion: null, ...cut.clip, found: clip.parentId ? "manual" : null };
      cut.genres = clip.genres;
      cut.overview = clip.overview;
      cut.contentRating = clip.contentRating;
      cut.ageRating = clip.ageRating;
      cut.takenAt = clip.takenAt;
      cut.releaseDate = clip.releaseDate;
      cut.year = clip.year;
      cut.setTitle(`${clip.title} (cut)`);
      cut.editedAt = new Date();
      await cut.save();
      await ClipLibrary.removeEmptyGames(library);
      return cut;
    });
  }
  //#endregion

  //#region Small copies

  interface ShareJob {
    info: ShareCopyInfo;
    userId: number;
    path: string;
    createdAt: number;
  }

  const _shares = new Map<string, ShareJob>();

  function cleanupShares() {
    for (const [id, job] of _shares) {
      if (Date.now() - job.createdAt < SHARE_LIFETIME_MS || job.info.state === "working") continue;
      _shares.delete(id);
      fsp.rm(job.path, { force: true }).catch(() => { });
    }
  }

  /**
   * A small copy's progress, for the one who asked for it.
   */
  export function share(id: string, userId: number) {
    const job = _shares.get(id);
    return job && job.userId === userId ? job.info : null;
  }

  /**
   * The finished file of a small copy, by its id (which works like a password, so download links need no sign-in).
   */
  export function shareFile(id: string) {
    const job = _shares.get(id);
    return job?.info.state === "done" ? { path: job.path, fileName: job.info.fileName } : null;
  }

  function fileNameFor(clip: MediaItem, gameTitle: string | null) {
    const base = [gameTitle, clip.title].filter(Boolean).join(" - ").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
    return `${base || "Clip"}.mp4`;
  }

  /**
   * Run ffmpeg, reporting how far it is through `seconds` of output.
   */
  async function runWithProgress(args: string[], seconds: number, onProgress: (share: number) => void) {
    const child = new Deno.Command(AppSystem.config.FFMPEG_PATH, {
      args: ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", ...args],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const stderr = new Response(child.stderr).text();
    // Example output: out_time_us=12345678
    let buffer = "";
    for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const match = line.match(/^out_time_us=(\d+)/);
        if (match && seconds > 0) onProgress(Math.min(1, Number(match[1]) / 1e6 / seconds));
      }
    }
    const status = await child.status;
    return { code: status.code, stderr: await stderr };
  }

  /**
   * The bitrates and size a copy of `seconds` gets to stay under `sizeMb`.
   * @throws `Problem` when even the smallest copy wouldn't fit.
   */
  export function plan(seconds: number, sizeMb: number, sourceHeight: number, hasAudio: boolean) {
    const totalKbps = sizeMb * 1e6 * 8 * SIZE_USE / seconds / 1000;
    const audioKbps = !hasAudio ? 0 : totalKbps >= 2000 ? 128 : totalKbps >= 700 ? 96 : 64;
    const videoKbps = Math.floor(totalKbps - audioKbps);
    if (videoKbps < MIN_VIDEO_KBPS) {
      const longest = Math.floor(sizeMb * 1e6 * 8 * SIZE_USE / 1000 / (MIN_VIDEO_KBPS + audioKbps));
      throw new Problem(`${Math.round(seconds)} seconds don't fit in ${sizeMb} MB. Keep at most ${longest} seconds, or pick a bigger size.`);
    }
    const height = Math.min(sourceHeight || 1080, HEIGHT_STEPS.find(([kbps]) => videoKbps >= kbps)![1]);
    // Fast games look smoother at 60 frames per second, but only with bits to spare
    const fps = videoKbps >= 3000 ? 60 : 30;
    return { videoKbps, audioKbps, height, fps };
  }

  /**
   * Start making a copy of (part of) a clip that fits `sizeMb`, converted to H.264 and AAC in an MP4 that every chat
   * app plays. It runs in the background; `share()` tells how it goes.
   * @throws `Problem` when the request doesn't work.
   */
  export async function startShare(clip: MediaItem, file: MediaFile, userId: number, request: Partial<ShareCopyRequest>): Promise<ShareCopyInfo> {
    cleanupShares();
    const duration = file.duration ?? 0;
    if (!duration) throw new Problem("Cinemion doesn't know how long this clip is yet. Try again after the library has been scanned.");
    const sizeMb = Number(request.sizeMb);
    if (!Number.isFinite(sizeMb) || sizeMb < 1 || sizeMb > 4000) throw new Problem("Pick a size between 1 MB and 4,000 MB.");
    const start = Math.max(0, Number(request.start ?? 0) || 0);
    const end = Math.min(duration, Number(request.end ?? duration) || duration);
    if (!(end > start + 0.5)) throw new Problem("Keep at least half a second of the clip.");

    const audio = request.audio === "mix" ? "mix" : typeof request.audio === "number" ? file.audio.find((a) => a.index === request.audio) ?? null : file.audio.find((a) => a.isDefault) ?? file.audio[0] ?? null;
    if (typeof request.audio === "number" && !audio) throw new Problem("That sound track isn't in the clip.");
    const mixing = audio === "mix" && file.audio.length > 1;
    const budget = plan(end - start, sizeMb, file.height ?? 1080, file.audio.length > 0);

    const game = clip.parentId ? await MediaItem.findByPk(clip.parentId, { attributes: ["title"] }) : null;
    const id = encodeHex(crypto.getRandomValues(new Uint8Array(16)));
    const path = Path.join(sharesDir, `${id}.mp4`);
    const info: ShareCopyInfo = { id, state: "working", progress: 0, size: null, height: budget.height, error: null, url: null, fileName: fileNameFor(clip, game?.title ?? null) };
    _shares.set(id, { info, userId, path, createdAt: Date.now() });

    const seconds = end - start;
    const filters = [
      // HDR recordings look washed out once they're plain H.264
      ...(file.hdr ? ["zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709", "tonemap=tonemap=hable:desat=0", "zscale=t=bt709:m=bt709:r=tv"] : []),
      `scale=-2:'min(${budget.height},ih)'`,
      "format=yuv420p",
    ].join(",");
    const input = ["-ss", start.toFixed(3), "-t", seconds.toFixed(3), "-i", file.path];
    const passlog = Path.join(AppSystem.tempDir, `share-${id}`);
    const video = (kbps: number) => ["-c:v", "libx264", "-preset", "veryfast", "-b:v", `${kbps}k`, "-maxrate", `${Math.round(kbps * 1.5)}k`, "-bufsize", `${kbps * 2}k`, "-fpsmax", String(budget.fps), "-passlogfile", passlog];
    const sound = !budget.audioKbps ? ["-an"]
      : mixing ? ["-filter_complex", `${file.audio.map((a) => `[0:${a.index}]`).join("")}amix=inputs=${file.audio.length}:normalize=0[mix]`, "-map", "[mix]", "-c:a", "aac", "-b:a", `${budget.audioKbps}k`, "-ac", "2"]
      : ["-map", `0:${(audio as { index: number } | null)?.index ?? "a:0"}`, "-c:a", "aac", "-b:a", `${budget.audioKbps}k`, "-ac", "2"];

    Tasks.run(`share:${id}`, "Making a small copy of a clip", { libraryId: clip.libraryId, queue: "clips-encode" }, async (task) => {
      await fsp.mkdir(sharesDir, { recursive: true });
      await fsp.mkdir(AppSystem.tempDir, { recursive: true });
      try {
        let kbps = budget.videoKbps;
        // Two passes land close to the size; a copy that still comes out too big gets one more try with less
        for (let attempt = 0; attempt < 2; attempt++) {
          const report = (from: number, span: number) => (share: number) => {
            info.progress = from + span * share;
            task.update("Converting", info.progress);
          };
          const first = await runWithProgress([...input, "-map", "0:v:0", "-vf", filters, ...video(kbps), "-pass", "1", "-an", "-f", "null", "-y", "/dev/null"], seconds, report(0, 0.4));
          if (first.code !== 0) throw new Error(first.stderr.trim().split("\n").pop() || `ffmpeg exited with ${first.code}`);
          const second = await runWithProgress([...input, "-map", "0:v:0", "-vf", filters, ...video(kbps), "-pass", "2", ...sound, "-movflags", "+faststart", "-y", path], seconds, report(0.4, 0.6));
          if (second.code !== 0) throw new Error(second.stderr.trim().split("\n").pop() || `ffmpeg exited with ${second.code}`);
          const size = (await fsp.stat(path)).size;
          if (size <= sizeMb * 1e6 || attempt === 1) {
            info.size = size;
            break;
          }
          kbps = Math.floor(kbps * (sizeMb * 1e6 / size) * 0.95);
        }
        info.state = "done";
        info.progress = 1;
        info.url = `/api/clips/shares/${id}/file`;
      } catch (error) {
        info.state = "failed";
        info.error = "The copy couldn't be made. The server log has ffmpeg's reason.";
        log.warn(`Could not make a small copy of ${file.path}`, { error });
        await fsp.rm(path, { force: true });
      } finally {
        for (const suffix of ["-0.log", "-0.log.mbtree"]) await fsp.rm(`${passlog}${suffix}`, { force: true });
      }
    }).catch(() => { });
    return info;
  }
  //#endregion
}

export default ClipTools;
