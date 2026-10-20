import fsp from "node:fs/promises";
import Path from "node:path";
import { encodeHex } from "@std/encoding/hex";
import type { HardwareAcceleration as Kind, PlaybackSettings } from "@shared/playback.ts";
import AppSystem from "../AppSystem.ts";
import HardwareAcceleration from "./HardwareAcceleration.ts";
import type PlaybackDecider from "./PlaybackDecider.ts";
import log from "../lib/Logger.ts";

/**
 * One ffmpeg process writing an HLS stream (fMP4 segments) for one viewer, starting at a given time.
 * Seeking past what's been made starts a new session at the new time.
 */
export class TranscodeSession {
  public readonly id = encodeHex(crypto.getRandomValues(new Uint8Array(16)));
  public readonly dir: string;
  /**
   * When the last request for this session came in, in milliseconds since the epoch.
   */
  public lastAccess = Date.now();
  public status: "starting" | "running" | "finished" | "failed" | "stopped" = "starting";
  /**
   * The GPU method in use, or `none`. Can drop to `none` when the GPU fails to start.
   */
  public hardware: Kind = "none";

  private _child: Deno.ChildProcess | null = null;
  private _stderr: string[] = [];

  constructor(
    public readonly userId: number,
    public readonly itemId: number,
    public readonly fileId: number,
    /** Path of the source video. */
    public readonly input: string,
    public readonly decision: PlaybackDecider.Decision,
    /** Where the stream starts in the source, in seconds. */
    public readonly startOffset: number,
    /** The `-ss` value that makes ffmpeg start at `startOffset`. */
    public readonly seekTo = startOffset,
  ) {
    this.dir = Path.join(TranscodeSession.rootDir, this.id);
  }

  /**
   * Whether this session converts video, which is what counts against the conversion limit.
   */
  public isConverting() {
    return this.decision.video.action === "convert";
  }

  /**
   * How many video conversions this session runs at once: one per quality with automatic quality.
   */
  public weight() {
    return this.isConverting() ? this.decision.video.ladder?.length ?? 1 : 0;
  }

  /**
   * The playlist whose first segment means the stream can start: the best quality's, with automatic quality.
   */
  public get firstPlaylist() {
    return Path.join(this.dir, this.decision.video.ladder ? "v0/stream.m3u8" : "index.m3u8");
  }

  public touch() {
    this.lastAccess = Date.now();
  }

  /**
   * Start ffmpeg and wait for the first segment. Falls back to the CPU when the GPU fails.
   * @throws When ffmpeg can't make the stream.
   */
  public async start(settings: PlaybackSettings) {
    await fsp.mkdir(this.dir, { recursive: true });
    const wanted = this.decision.video.action === "convert" ? settings.hardwareAcceleration : "none";
    // Try the whole pipeline on the GPU, then only the encoder, then the CPU
    const attempts: { kind: Kind; gpuDecode: boolean }[] = [{ kind: "none", gpuDecode: false }];
    if (wanted !== "none") {
      attempts.unshift({ kind: wanted, gpuDecode: false });
      if (TranscodeSession.canDecodeOnGpu(this.decision, wanted, settings)) attempts.unshift({ kind: wanted, gpuDecode: true });
    }

    for (const [i, attempt] of attempts.entries()) {
      try {
        await this._run(attempt.kind, attempt.gpuDecode, settings);
        return;
      } catch (error) {
        if (i === attempts.length - 1 || this.status === "stopped") throw error;
        const next = attempts[i + 1];
        log.warn(next.kind === "none" ? `Converting on the GPU (${attempt.kind}) failed, so the CPU is used instead` : `Decoding on the GPU (${attempt.kind}) failed, so only the encoding uses it`, { error });
        await fsp.rm(this.dir, { recursive: true, force: true });
        await fsp.mkdir(this.dir, { recursive: true });
      }
    }
  }

  private async _run(kind: Kind, gpuDecode: boolean, settings: PlaybackSettings) {
    this.hardware = kind;
    this._stderr = [];
    const args = TranscodeSession.buildArgs(this, kind, gpuDecode, settings);
    log.debug("Starting ffmpeg", { session: this.id, args: args.join(" ") });

    const child = new Deno.Command(AppSystem.config.FFMPEG_PATH, { args, stdin: "null", stdout: "null", stderr: "piped" }).spawn();
    this._child = child;
    this.status = "running";
    this._collectStderr(child.stderr);
    child.status.then((status) => {
      if (this._child !== child) return;
      this._child = null;
      if (this.status !== "running") return;
      this.status = status.success ? "finished" : "failed";
      if (!status.success) log.warn("ffmpeg stopped with an error", { session: this.id, code: status.code, error: this._stderr.join("\n") });
    });

    // Wait for the first segment, or for ffmpeg to give up
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      // Read through a method; the process can change the status while this waits
      const status = this._currentStatus();
      if (status === "stopped") throw new Error("Playback was stopped.");
      const playlist = await fsp.readFile(this.firstPlaylist, "utf8").catch(() => "");
      if (playlist.includes("#EXTINF")) return;
      if (status === "failed" || (status === "finished" && !playlist)) {
        throw new Error(`ffmpeg couldn't convert the video: ${this._stderr.at(-1) ?? "no details"}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("Converting the video took too long to start.");
  }

  private _currentStatus() {
    return this.status;
  }

  private async _collectStderr(stream: ReadableStream<Uint8Array>) {
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) this._stderr.push(line.trim());
        if (this._stderr.length > 20) this._stderr.splice(0, this._stderr.length - 20);
      }
    } catch {
      // The process went away
    }
  }

  /**
   * Stop ffmpeg and delete the stream's files.
   */
  public async stop() {
    this.status = "stopped";
    const child = this._child;
    this._child = null;
    if (child) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already exited
      }
      await child.status.catch(() => { });
    }
    await fsp.rm(this.dir, { recursive: true, force: true }).catch(() => { });
  }

  /**
   * Path of a stream file, or `null` for names that aren't part of an HLS stream. With automatic quality, each
   * quality's files are in a folder of its own: `v0/stream.m3u8`, `v0/init_0.mp4`, `v0/seg00000.m4s`.
   */
  public filePath(name: string) {
    if (!/^(index\.m3u8|init\.mp4|seg\d{5}\.m4s|v\d\/(stream\.m3u8|init_\d\.mp4|seg\d{5}\.m4s))$/.test(name)) return null;
    return Path.join(this.dir, name);
  }
}

export namespace TranscodeSession {
  /**
   * Where streams are written while they play.
   */
  export const rootDir = Path.join(AppSystem.config.CACHE_DIR, "transcodes");
  /**
   * Sessions with no requests for this long are stopped. The player pings every 30 seconds while open.
   */
  export const IDLE_TIMEOUT = 90_000;
  const SEGMENT_SECONDS = 4;

  const _sessions = new Map<string, TranscodeSession>();
  let _reaper: ReturnType<typeof setInterval> | null = null;

  export function get(id: string) {
    return _sessions.get(id) ?? null;
  }

  export function list() {
    return [..._sessions.values()];
  }

  /**
   * Number of video conversions running. An automatic quality session counts once per quality.
   * @param except A session left out, like one that's about to be replaced.
   */
  export function conversions(except?: string | null) {
    return list().reduce((sum, s) => s.id === except ? sum : sum + s.weight(), 0);
  }

  /**
   * Create and start a session.
   * @throws When ffmpeg can't make the stream.
   */
  export async function create(opts: { userId: number; itemId: number; fileId: number; input: string; decision: PlaybackDecider.Decision; startAt: number; settings: PlaybackSettings }) {
    const start = opts.decision.video.action === "copy" && opts.startAt > 0 ? await copyStart(opts.input, opts.startAt) : { offset: opts.startAt, seek: opts.startAt };
    const session = new TranscodeSession(opts.userId, opts.itemId, opts.fileId, opts.input, opts.decision, start.offset, start.seek);
    _sessions.set(session.id, session);
    try {
      await session.start(opts.settings);
    } catch (error) {
      await stop(session.id);
      throw error;
    }
    return session;
  }

  export async function stop(id: string) {
    const session = _sessions.get(id);
    if (!session) return;
    _sessions.delete(id);
    await session.stop();
  }

  export async function stopAll() {
    await Promise.all(list().map((s) => stop(s.id)));
  }

  /**
   * Delete streams left over from a previous run and start stopping idle sessions. Call once at startup.
   */
  export async function init() {
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.mkdir(rootDir, { recursive: true });
    _reaper ??= setInterval(() => {
      for (const session of list()) {
        if (Date.now() - session.lastAccess > IDLE_TIMEOUT) {
          log.debug("Stopping idle playback session", { session: session.id });
          stop(session.id);
        }
      }
    }, 15_000);
  }

  export function shutdown() {
    if (_reaper) clearInterval(_reaper);
    _reaper = null;
    return stopAll();
  }

  /**
   * When copying video, a stream can only start on a keyframe. Find the last one at or before `time`, so the
   * player knows exactly where the stream starts, and the `-ss` value that lands ffmpeg on it.
   * Asking for the keyframe's exact time can land on the one before it (MKV seeks by decode time, which runs
   * a little ahead of display time with B-frames), so the seek aims a bit past it.
   */
  export async function copyStart(input: string, time: number): Promise<{ offset: number; seek: number }> {
    const from = Math.max(0, time - 30);
    const result = await new Deno.Command(AppSystem.config.FFPROBE_PATH, {
      args: ["-v", "error", "-select_streams", "V:0", "-skip_frame", "nokey", "-show_entries", "frame=pts_time,best_effort_timestamp_time", "-of", "csv=p=0", "-read_intervals", `${from}%${time + 15}`, input],
      stdout: "piped",
      stderr: "null",
    }).output().catch(() => null);
    if (!result?.success) return { offset: time, seek: time };

    const keyframes = new TextDecoder().decode(result.stdout).split("\n")
      .map((line) => line.split(",").map(parseFloat).find((v) => Number.isFinite(v)))
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);
    const before = keyframes.filter((k) => k <= time + 0.05).pop();
    if (before === undefined) return { offset: time, seek: time };
    const after = keyframes.find((k) => k > before);
    const margin = Math.min(0.5, after !== undefined ? (after - before) / 2 : 0.5);
    return { offset: before, seek: before + margin };
  }

  function presetArgs(kind: Kind, preset: PlaybackSettings["preset"]): string[] {
    switch (kind) {
      case "none":
        return ["-preset", { fast: "superfast", balanced: "veryfast", quality: "faster" }[preset], "-profile:v", "high"];
      case "qsv":
        // Without IDR frames, Quick Sync ignores the forced keyframes and segments come out 10 seconds long
        return ["-preset", { fast: "veryfast", balanced: "medium", quality: "slower" }[preset], "-forced_idr", "1"];
      case "nvenc":
        return ["-preset", { fast: "p1", balanced: "p4", quality: "p6" }[preset], "-forced-idr", "1"];
      default:
        return [];
    }
  }

  /**
   * Whether `kind` can decode and resize the whole video on the GPU. Not with picture subtitles (drawn on the CPU)
   * or HDR to SDR: the GPU tone mappers need HDR metadata many files lack, or pass HDR through untouched.
   */
  export function canDecodeOnGpu(decision: PlaybackDecider.Decision, kind: Kind, settings: PlaybackSettings) {
    const { video } = decision;
    return kind !== "none" && video.action === "convert" && video.burnSubtitle === null && !video.toneMap && settings.hardwareDecodeCodecs.includes(video.source);
  }

  /**
   * GPU filters that resize frames already on the GPU and make them 8-bit for the H.264 encoder.
   */
  function gpuFilters(kind: Kind, height: number | null): string[] {
    const size = height ? `w=-2:h=${height}:` : "";
    switch (kind) {
      case "vaapi":
        return [`scale_vaapi=${size}format=nv12`];
      case "qsv":
        return [`vpp_qsv=${size}format=nv12`];
      case "nvenc":
        return [`scale_cuda=${size}format=yuv420p`];
      default:
        return [];
    }
  }

  /**
   * ffmpeg arguments for a session, using `kind` to convert video, and to decode it too when `gpuDecode` is set.
   */
  export function buildArgs(session: TranscodeSession, kind: Kind, gpuDecode: boolean, settings: PlaybackSettings): string[] {
    const { video, audio } = session.decision;
    const args = ["-hide_banner", "-loglevel", "error", "-nostats"];
    const output: string[] = [];
    // One output per quality with automatic quality; one otherwise
    const rungs = video.ladder ?? [{ height: video.height ?? 0, bitrate: video.bitrate ?? 8_000_000 }];
    const ladder = !!video.ladder;

    if (video.action === "copy") {
      args.push("-ss", String(session.seekTo), "-i", session.input);
      output.push("-map", "0:V:0", "-c:v", "copy");
      if (video.codec === "hevc") output.push("-tag:v", "hvc1");
    }
    else {
      const gpu = gpuDecode && canDecodeOnGpu(session.decision, kind, settings);

      args.push(...HardwareAcceleration.deviceArgs(kind, settings.device));
      if (gpu) {
        const hwaccel = { vaapi: "vaapi", qsv: "qsv", nvenc: "cuda", none: "" }[kind];
        args.push("-hwaccel", hwaccel, "-hwaccel_device", "hw", "-hwaccel_output_format", hwaccel);
      }
      args.push("-ss", String(session.startOffset), "-i", session.input);

      // Filters for the whole picture first (subtitles drawn in, HDR to SDR), then per quality: the size and the
      // upload to the GPU encoder
      const shared: string[] = [];
      if (!gpu && video.toneMap) {
        shared.push("zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709", "tonemap=tonemap=hable:desat=0", "zscale=t=bt709:m=bt709:r=tv");
      }
      const sizeFilters = (height: number | null) => gpu
        ? gpuFilters(kind, height)
        : [...(height ? [`scale=-2:${height}`] : []), ...HardwareAcceleration.uploadFilters(kind)];
      // An empty chain isn't allowed between labels; "null" passes frames through untouched
      const chain = (filters: string[]) => filters.join(",") || "null";

      if (!ladder && video.burnSubtitle === null) {
        output.push("-map", "0:V:0", "-vf", chain([...shared, ...sizeFilters(video.height)]));
      }
      else {
        // Picture subtitles are drawn over the full-size frame, before any resizing
        const whole = [video.burnSubtitle !== null ? `[0:V:0][0:${video.burnSubtitle}]overlay=eof_action=pass` : "[0:V:0]null", ...shared].join(",");
        const graph = ladder
          ? `${whole},split=${rungs.length}${rungs.map((_, i) => `[s${i}]`).join("")};${rungs.map((r, i) => `[s${i}]${chain(sizeFilters(r.height))}[v${i}]`).join(";")}`
          : `${whole},${chain(sizeFilters(video.height))}[v0]`;
        output.push("-filter_complex", graph);
        rungs.forEach((_, i) => output.push("-map", `[v${i}]`));
      }

      output.push(
        "-c:v", HardwareAcceleration.encoder(kind), ...presetArgs(kind, settings.preset),
        // A keyframe at every segment boundary keeps segments the same length, and lines the qualities up for switching
        "-force_key_frames", `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
      );
      rungs.forEach((r, i) => {
        const suffix = ladder ? `:v:${i}` : "";
        output.push(`-b${suffix || ":v"}`, String(r.bitrate), `-maxrate${suffix}`, String(r.bitrate), `-bufsize${suffix}`, String(r.bitrate * 2));
      });
    }

    if (audio) {
      // Every quality carries its own copy of the sound
      for (let i = 0; i < (ladder ? rungs.length : 1); i++) output.push("-map", `0:${audio.index}`);
      if (audio.action === "copy") output.push("-c:a", "copy");
      else output.push("-c:a", "aac", "-ac", String(audio.channels), "-b:a", audio.channels > 2 ? "384k" : "192k");
    }

    output.push(
      "-map_metadata", "-1", "-map_chapters", "-1", "-max_muxing_queue_size", "4096",
      "-f", "hls", "-hls_time", String(SEGMENT_SECONDS), "-hls_playlist_type", "event", "-hls_list_size", "0",
      "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4",
      "-hls_flags", "temp_file+independent_segments",
    );
    if (ladder) {
      const map = rungs.map((_, i) => audio ? `v:${i},a:${i}` : `v:${i}`).join(" ");
      output.push(
        "-var_stream_map", map, "-master_pl_name", "index.m3u8",
        "-hls_segment_filename", Path.join(session.dir, "v%v", "seg%05d.m4s"),
        Path.join(session.dir, "v%v", "stream.m3u8"),
      );
    }
    else {
      output.push("-hls_segment_filename", Path.join(session.dir, "seg%05d.m4s"), Path.join(session.dir, "index.m3u8"));
    }
    return [...args, ...output];
  }

  /**
   * Bytes used by running streams.
   */
  export async function cacheSize() {
    let total = 0;
    for (const session of await fsp.readdir(rootDir).catch(() => [] as string[])) {
      for (const name of await fsp.readdir(Path.join(rootDir, session)).catch(() => [] as string[])) {
        total += (await fsp.stat(Path.join(rootDir, session, name)).catch(() => null))?.size ?? 0;
      }
    }
    return total;
  }
}

export default TranscodeSession;
