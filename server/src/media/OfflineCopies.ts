import fsp from "node:fs/promises";
import Path from "node:path";
import type { DownloadQuality } from "@shared/downloads.ts";
import AppSystem from "../AppSystem.ts";
import Tasks from "../lib/Tasks.ts";
import log from "../lib/Logger.ts";
import type MediaFile from "../models/MediaFile.ts";

/**
 * MP4 copies of videos for offline viewing: H.264 and stereo AAC, which every browser plays, at a chosen size.
 * Made once in the background and shared by everyone who asks for the same file, size and audio track; copies
 * nobody fetched for a week are deleted.
 */
export namespace OfflineCopies {
  export const cacheDir = Path.join(AppSystem.config.CACHE_DIR, "downloads");
  const KEEP_FOR = 7 * 24 * 60 * 60 * 1000;

  export const SIZES: Record<Exclude<DownloadQuality, "original">, { height: number; bitrate: number }> = {
    "1080p": { height: 1080, bitrate: 6_000_000 },
    "720p": { height: 720, bitrate: 3_000_000 },
    "480p": { height: 480, bitrate: 1_200_000 },
  };
  export const AUDIO_BITRATE = 160_000;

  interface Job {
    progress: number;
    error: string | null;
  }

  const _jobs = new Map<string, Job>();

  export function pathFor(key: string) {
    return Path.join(cacheDir, `${key}.mp4`);
  }

  /**
   * How the copy of `file` at `quality` with `audioIndex` is going: ready (with its size), being made (with
   * progress), or failed.
   */
  export async function status(key: string): Promise<{ status: "preparing" | "ready" | "failed"; progress: number | null; size: number | null; error: string | null }> {
    const job = _jobs.get(key);
    if (job?.error) return { status: "failed", progress: null, size: null, error: job.error };
    if (job) return { status: "preparing", progress: job.progress, size: null, error: null };
    const stat = await fsp.stat(pathFor(key)).catch(() => null);
    return stat ? { status: "ready", progress: 1, size: stat.size, error: null } : { status: "preparing", progress: null, size: null, error: null };
  }

  /**
   * Start making a copy unless it exists or is being made.
   * @param label What the dashboard's task list calls it, like "Northbound (720p)".
   */
  export async function prepare(key: string, file: MediaFile, quality: Exclude<DownloadQuality, "original">, audioIndex: number | null, label: string) {
    const existing = _jobs.get(key);
    if (existing && !existing.error) return;
    if (await fsp.stat(pathFor(key)).then(() => true).catch(() => false)) return;
    const job: Job = { progress: 0, error: null };
    _jobs.set(key, job);
    Tasks.run(`download:${key}`, `Preparing a download: ${label}`, { queue: "downloads" }, (task) => make(key, file, quality, audioIndex, job, task))
      .then(() => _jobs.delete(key))
      .catch((error) => {
        job.error = (error as Error).message;
        log.warn(`Could not make an offline copy of ${file.path}`, { error });
        // A failed copy can be asked for again later
        setTimeout(() => _jobs.get(key) === job && _jobs.delete(key), 10 * 60 * 1000);
      });
    prune();
  }

  async function make(key: string, file: MediaFile, quality: Exclude<DownloadQuality, "original">, audioIndex: number | null, job: Job, task: Tasks.Handle) {
    await fsp.mkdir(cacheDir, { recursive: true });
    const size = SIZES[quality];
    const temp = `${pathFor(key)}.${crypto.randomUUID()}.tmp.mp4`;
    const filters: string[] = [];
    // HDR looks washed out on ordinary screens, which is most screens these copies end up on
    if (file.hdr) filters.push("zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709", "tonemap=tonemap=hable:desat=0", "zscale=t=bt709:m=bt709:r=tv");
    if ((file.height ?? 0) > size.height) filters.push(`scale=-2:${size.height}`);
    filters.push("format=yuv420p");
    const audio = audioIndex ?? file.audio.find((a) => a.isDefault)?.index ?? file.audio[0]?.index ?? null;
    const args = [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", file.path,
      "-map", "0:V:0", ...(audio !== null ? ["-map", `0:${audio}`] : []),
      "-vf", filters.join(","),
      "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high",
      "-b:v", String(size.bitrate), "-maxrate", String(Math.round(size.bitrate * 1.5)), "-bufsize", String(size.bitrate * 2),
      ...(audio !== null ? ["-c:a", "aac", "-b:a", String(AUDIO_BITRATE), "-ac", "2"] : []),
      "-sn", "-dn", "-map_chapters", "-1",
      "-movflags", "+faststart",
      "-progress", "pipe:1", "-nostats",
      temp,
    ];
    const child = new Deno.Command(AppSystem.config.FFMPEG_PATH, { args, stdin: "null", stdout: "piped", stderr: "piped" }).spawn();
    const stderr = new Response(child.stderr).text();

    // Example progress line: out_time_us=12345678
    const duration = file.duration ?? 0;
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const match = line.match(/^out_time_us=(\d+)/);
        if (match && duration > 0) {
          job.progress = Math.min(0.99, Number(match[1]) / 1_000_000 / duration);
          task.update(`${Math.round(job.progress * 100)}%`, job.progress);
        }
      }
    }
    const result = await child.status;
    if (!result.success) {
      await fsp.rm(temp, { force: true });
      throw new Error(`The copy couldn't be made: ${(await stderr).trim().split("\n").pop() || `ffmpeg exited with ${result.code}`}`);
    }
    await fsp.rename(temp, pathFor(key));
  }

  /**
   * Mark a copy as used, so cleaning up keeps it.
   */
  export async function touch(key: string) {
    const now = new Date();
    await fsp.utimes(pathFor(key), now, now).catch(() => { });
  }

  let _lastPrune = 0;

  /**
   * Delete copies nobody fetched for a week, and half-made ones left by a restart. At most once an hour.
   */
  export function prune() {
    if (Date.now() - _lastPrune < 60 * 60 * 1000) return;
    _lastPrune = Date.now();
    (async () => {
      for (const name of await fsp.readdir(cacheDir).catch(() => [] as string[])) {
        const path = Path.join(cacheDir, name);
        const stat = await fsp.stat(path).catch(() => null);
        const stale = name.endsWith(".tmp.mp4") ? ![..._jobs.keys()].some((k) => name.startsWith(k)) : Date.now() - (stat?.mtime?.getTime() ?? 0) > KEEP_FOR;
        if (stat && stale) await fsp.rm(path, { force: true });
      }
    })().catch((error) => log.warn("Could not clean up offline copies", { error }));
  }
}

export default OfflineCopies;
