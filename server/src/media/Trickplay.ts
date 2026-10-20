import fsp from "node:fs/promises";
import Path from "node:path";
import AppSystem from "../AppSystem.ts";
import { MediaFile } from "../models/index.ts";
import HardwareAcceleration from "./HardwareAcceleration.ts";
import Tasks from "../lib/Tasks.ts";
import log from "../lib/Logger.ts";

/**
 * Seek thumbnails: a small frame every few seconds, packed into grid images ("sheets") so the player
 * loads a handful of images instead of hundreds.
 */
export namespace Trickplay {
  export interface Manifest {
    /**
     * Seconds between thumbnails.
     */
    interval: number;
    width: number;
    height: number;
    columns: number;
    rows: number;
    count: number;
    sheets: number;
  }

  export const rootDir = Path.join(AppSystem.config.CACHE_DIR, "trickplay");
  const WIDTH = 320;
  const COLUMNS = 10;
  const ROWS = 10;

  /**
   * A thumbnail every 2 to 10 seconds: dense for short videos, about 300 frames for an hour.
   */
  export function intervalFor(duration: number) {
    return Math.min(10, Math.max(2, Math.round(duration / 300)));
  }

  /**
   * Folder for a file's sheets. The modification time is part of the name, so a replaced file gets new thumbnails.
   */
  function dirFor(file: Pick<MediaFile, "id" | "mtime">) {
    return Path.join(rootDir, `${file.id}-${file.mtime}`);
  }

  /**
   * The thumbnails of a file, or `null` when they haven't been made.
   */
  export async function manifest(file: Pick<MediaFile, "id" | "mtime">): Promise<Manifest | null> {
    const text = await fsp.readFile(Path.join(dirFor(file), "manifest.json"), "utf8").catch(() => null);
    return text ? JSON.parse(text) as Manifest : null;
  }

  /**
   * Path of sheet `n`, or `null` when it doesn't exist.
   */
  export async function sheetPath(file: Pick<MediaFile, "id" | "mtime">, n: number) {
    const path = Path.join(dirFor(file), `sheet${String(n).padStart(3, "0")}.jpg`);
    return await fsp.stat(path).then(() => path).catch(() => null);
  }

  export function taskId(fileId: number) {
    return `trickplay:${fileId}`;
  }

  /**
   * Make thumbnails for one file now, next to whatever background work is running. Used when someone starts watching.
   */
  export function queueNow(file: MediaFile) {
    return Tasks.run(taskId(file.id), "Making seek thumbnails", { queue: "trickplay-now" }, (task) => generate(file, task)).catch(() => { });
  }

  /**
   * Make missing thumbnails for a library, one file after another.
   */
  export function queueLibrary(libraryId: number) {
    return Tasks.run(`trickplay-library:${libraryId}`, "Making seek thumbnails", { libraryId, queue: "trickplay" }, async (task) => {
      if (!(await HardwareAcceleration.settings()).seekThumbnails) return;
      const files = await MediaFile.findAll({ where: { libraryId }, order: [["id", "ASC"]] });
      const missing: MediaFile[] = [];
      for (const file of files) {
        if (file.duration && !await manifest(file)) missing.push(file);
      }
      for (const [i, file] of missing.entries()) {
        task.update(`${i + 1} of ${missing.length}: ${Path.basename(file.path)}`, i / missing.length);
        // Someone may have started watching it in the meantime
        if (Tasks.get(taskId(file.id))) continue;
        try {
          await generate(file, null);
        } catch (error) {
          log.warn(`Could not make seek thumbnails for ${file.path}`, { error });
        }
      }
    }).catch(() => { });
  }

  /**
   * Whether keyframes are close enough together to make thumbnails from keyframes alone, which is much faster
   * than decoding every frame.
   */
  async function keyframesSuffice(input: string, interval: number) {
    const result = await new Deno.Command(AppSystem.config.FFPROBE_PATH, {
      args: ["-v", "error", "-select_streams", "V:0", "-skip_frame", "nokey", "-show_entries", "frame=pts_time", "-of", "csv=p=0", "-read_intervals", "%+120", input],
      stdout: "piped",
      stderr: "null",
    }).output().catch(() => null);
    if (!result?.success) return false;
    const times = new TextDecoder().decode(result.stdout).split("\n").map(parseFloat).filter(Number.isFinite);
    if (times.length < 3) return false;
    const gap = (times[times.length - 1] - times[0]) / (times.length - 1);
    return gap <= interval * 1.5;
  }

  /**
   * Make the sheets and manifest for a file.
   * @throws When ffmpeg can't read the video.
   */
  export async function generate(file: MediaFile, task: Tasks.Handle | null) {
    if (await manifest(file)) return;
    const duration = file.duration ?? 0;
    if (!duration) throw new Error("The video's length isn't known, so thumbnails can't be spaced out.");

    const interval = intervalFor(duration);
    const height = Math.round((WIDTH * (file.height ?? 9)) / (file.width ?? 16) / 2) * 2;
    const dir = dirFor(file);
    const temp = `${dir}.tmp`;
    await fsp.rm(temp, { recursive: true, force: true });
    await fsp.mkdir(temp, { recursive: true });

    const expected = Math.floor(duration / interval) + 1;
    // Short videos fit on a smaller sheet
    const rows = Math.min(ROWS, Math.ceil(expected / COLUMNS));
    const fast = await keyframesSuffice(file.path, interval);
    const filters = [`fps=1/${interval}`, `scale=${WIDTH}:${height}:flags=bilinear`];
    // HDR frames look washed out on ordinary screens
    if (file.hdr) filters.push("zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709", "tonemap=tonemap=hable:desat=0", "zscale=t=bt709:m=bt709:r=tv");
    filters.push("format=yuvj420p", `tile=${COLUMNS}x${rows}`);

    const args = [
      "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1",
      ...(fast ? ["-skip_frame", "nokey"] : []),
      "-threads", "2", "-i", file.path,
      "-map", "0:V:0", "-an", "-sn", "-vf", filters.join(","),
      "-fps_mode", "passthrough", "-c:v", "mjpeg", "-q:v", "5",
      "-f", "image2", "-start_number", "0", Path.join(temp, "sheet%03d.jpg"),
    ];
    const child = new Deno.Command(AppSystem.config.FFMPEG_PATH, { args, stdin: "null", stdout: "piped", stderr: "piped" }).spawn();

    // Example progress line: out_time_us=12345678
    const progress = (async () => {
      const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const match = value.match(/out_time_us=(\d+)/g)?.pop()?.match(/\d+/);
        if (match && task) task.update("Making thumbnails", Math.min(1, Number(match[0]) / 1e6 / duration));
      }
    })();
    const [status, stderr] = await Promise.all([child.status, new Response(child.stderr).text(), progress]);
    if (!status.success) {
      await fsp.rm(temp, { recursive: true, force: true });
      throw new Error(`ffmpeg couldn't make thumbnails: ${stderr.trim().split("\n").pop()}`);
    }

    const sheets = (await fsp.readdir(temp)).filter((n) => n.endsWith(".jpg")).length;
    const count = Math.min(expected, sheets * COLUMNS * rows);
    const result: Manifest = { interval, width: WIDTH, height, columns: COLUMNS, rows, count, sheets };
    await fsp.writeFile(Path.join(temp, "manifest.json"), JSON.stringify(result));
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rename(temp, dir);
    log.debug("Made seek thumbnails", { file: file.path, count, fast });
  }

  /**
   * Delete thumbnails of files that are gone or changed.
   */
  export async function cleanup() {
    const names = await fsp.readdir(rootDir).catch(() => [] as string[]);
    if (names.length === 0) return;
    const current = new Set((await MediaFile.findAll({ attributes: ["id", "mtime"] })).map((f) => `${f.id}-${f.mtime}`));
    for (const name of names) {
      if (!current.has(name)) await fsp.rm(Path.join(rootDir, name), { recursive: true, force: true });
    }
  }

  /**
   * Bytes used by thumbnails.
   */
  export async function size() {
    let total = 0;
    for (const dir of await fsp.readdir(rootDir).catch(() => [] as string[])) {
      for (const name of await fsp.readdir(Path.join(rootDir, dir)).catch(() => [] as string[])) {
        total += (await fsp.stat(Path.join(rootDir, dir, name)).catch(() => null))?.size ?? 0;
      }
    }
    return total;
  }
}

export default Trickplay;
