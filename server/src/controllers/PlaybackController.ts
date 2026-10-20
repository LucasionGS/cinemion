import fsp from "node:fs/promises";
import { Hono } from "hono";
import { encodeHex } from "@std/encoding/hex";
import type { AudioOption, DeviceCapabilities, HardwareAcceleration as Kind, PlaybackInfo, PlaybackSettings, StartPlaybackRequest, SubtitleOption, TrickplayInfo } from "@shared/playback.ts";
import type { AudioTrack, SubtitleTrack } from "@shared/media.ts";
import { languageName } from "@shared/languages.ts";
import { MediaFile, MediaItem, User } from "../models/index.ts";
import Visibility from "../library/Visibility.ts";
import HardwareAcceleration from "../media/HardwareAcceleration.ts";
import PlaybackDecider from "../media/PlaybackDecider.ts";
import TranscodeSession from "../media/TranscodeSession.ts";
import Subtitles from "../media/Subtitles.ts";
import Trickplay from "../media/Trickplay.ts";
import SubtitleManager from "../subtitles/SubtitleManager.ts";
import Network from "../lib/Network.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import log from "../lib/Logger.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Starting playback, and the stream URLs the player loads.
 * Stream and session URLs carry a random id instead of a sign-in token, because video elements
 * and HLS players can't send headers. Anyone with the URL can load that one stream while it lives.
 */
export namespace PlaybackController {
  export const router = new Hono<AppEnv>();

  interface StreamGrant {
    fileId: number;
    userId: number;
    lastUsed: number;
  }

  /**
   * Stream ids stay valid this long after their last use.
   */
  const GRANT_LIFETIME = 6 * 60 * 60 * 1000;
  const _grants = new Map<string, StreamGrant>();

  function grant(fileId: number, userId: number) {
    for (const [token, g] of _grants) {
      if (Date.now() - g.lastUsed > GRANT_LIFETIME) _grants.delete(token);
    }
    const token = encodeHex(crypto.getRandomValues(new Uint8Array(16)));
    _grants.set(token, { fileId, userId, lastUsed: Date.now() });
    return token;
  }

  function useGrant(token: string) {
    const g = _grants.get(token);
    if (!g || Date.now() - g.lastUsed > GRANT_LIFETIME) return null;
    g.lastUsed = Date.now();
    return g;
  }

  function channelLabel(channels: number) {
    return channels === 1 ? "Mono" : channels === 2 ? "Stereo" : channels === 6 ? "5.1" : channels === 8 ? "7.1" : `${channels} channels`;
  }

  function audioOptions(tracks: AudioTrack[]): AudioOption[] {
    return tracks.map((t, i) => ({
      index: t.index,
      label: [t.title ?? languageName(t.language) ?? `Track ${i + 1}`, channelLabel(t.channels)].join(" · "),
      language: t.language,
      detail: `${PlaybackDecider.codecName(t.codec)}${t.title && t.language ? ` · ${languageName(t.language)}` : ""}`,
      isDefault: t.isDefault,
    }));
  }

  function subtitleOptions(tracks: SubtitleTrack[], token: string): SubtitleOption[] {
    return tracks.map((t, i) => ({
      index: t.index,
      label: t.title ?? languageName(t.language) ?? `Subtitles ${i + 1}`,
      language: t.language,
      detail: [
        t.external ? "File" : null,
        t.isForced ? "Forced" : null,
        t.isHearingImpaired ? "SDH" : null,
        t.isImage ? "Picture subtitles, drawn into the video" : t.codec === "ass" || t.codec === "ssa" ? "Styled text" : "Text",
      ].filter(Boolean).join(" · "),
      isForced: t.isForced,
      isDefault: t.isDefault,
      url: t.isImage ? null : `/api/playback/stream/${token}/subtitles/${t.index}.vtt`,
    }));
  }

  /**
   * Seek thumbnails for the player, starting them in the background when they're missing.
   */
  async function trickplayInfo(file: MediaFile, token: string, generate: boolean): Promise<TrickplayInfo | null> {
    const manifest = await Trickplay.manifest(file);
    if (!manifest) {
      if (generate && file.duration) Trickplay.queueNow(file);
      return null;
    }
    const { interval, width, height, columns, rows, count } = manifest;
    return { interval, width, height, columns, rows, count, sheetUrl: `/api/playback/stream/${token}/trickplay/{n}.jpg` };
  }

  function validCapabilities(value: unknown): value is DeviceCapabilities {
    const c = value as DeviceCapabilities | null;
    return !!c && Array.isArray(c.videoCodecs) && Array.isArray(c.audioCodecs) && Array.isArray(c.containers) && typeof c.hdr === "boolean" && typeof c.maxAudioChannels === "number";
  }

  /**
   * @swagger
   * /api/playback/{itemId}/start:
   *   post:
   *     summary: Start playing a movie or episode. Picks direct play, repackaging or conversion for the device,
   *       and returns the URL to load. Body is a `StartPlaybackRequest`.
   */
  router.post("/:itemId/start", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const item = await MediaItem.findByPk(Number(c.req.param("itemId")));
    if (!item || !Visibility.canSee(user, item)) return c.json({ message: "That title doesn't exist." }, 404);
    if (item.type !== "movie" && item.type !== "episode") return c.json({ message: "Only movies and episodes can be played." }, 400);

    const body = await readJson<StartPlaybackRequest>(c);
    if (!body || !validCapabilities(body.capabilities)) return c.json({ message: "The player has to say what this device can play." }, 400);

    const files = await MediaFile.findAll({ where: { itemId: item.id } });
    if (files.length === 0) return c.json({ message: "This title has no video file. It may have been moved or deleted." }, 404);
    const quality = body.quality && ["original", ...Object.keys(PlaybackDecider.QUALITY)].includes(body.quality) ? body.quality : "original";
    const settings = await HardwareAcceleration.settings();
    const isRemote = Network.isRemote(c);
    const request: PlaybackDecider.Request = {
      capabilities: body.capabilities,
      quality,
      audioIndex: typeof body.audioIndex === "number" ? body.audioIndex : null,
      subtitleIndex: typeof body.subtitleIndex === "number" ? body.subtitleIndex : null,
      isRemote,
    };

    // Without a pick, play the version that needs the least work, then the largest picture
    const COST = { direct: 0, remux: 1, transcode: 2 };
    const options = files.map((f) => ({ file: f, decision: PlaybackDecider.decide(f.toInfo(), { ...request, audioIndex: null, subtitleIndex: null }, settings) }));
    options.sort((a, b) => COST[a.decision.mode] - COST[b.decision.mode] || (b.file.height ?? 0) - (a.file.height ?? 0) || Number(b.file.size) - Number(a.file.size));
    const file = (body.fileId ? files.find((f) => f.id === body.fileId) : null) ?? options[0].file;
    if (!await fsp.stat(file.path).then(() => true).catch(() => false)) {
      return c.json({ message: "The video file can't be found on disk. Check that the media folder is mounted, then scan the library again." }, 404);
    }
    const decision = PlaybackDecider.decide(file.toInfo(), request, settings);

    if (decision.mode === "transcode") {
      if (!await user.hasPermission("TRANSCODE_ALLOW")) {
        return c.json({ message: "This file has to be converted for this device, and your profile isn't allowed to convert videos. Ask an admin, or try another device." }, 403);
      }
      if (isRemote && !settings.allowRemoteConversion && decision.video.action === "convert") {
        return c.json({ message: "This file has to be converted for this device, and the server doesn't convert videos for viewers outside the home network." }, 403);
      }
      if (decision.video.action === "convert" && TranscodeSession.conversions() >= settings.maxConversions) {
        return c.json({ message: `The server is already converting ${settings.maxConversions} videos. Try again when one of them stops, or pick Original quality on a device that can play the file.` }, 503);
      }
    }

    const token = grant(file.id, user.id);
    const startAt = Math.max(0, Math.min(Number(body.startAt) || 0, (file.duration ?? Infinity) - 1));
    let url = `/api/playback/stream/${token}/file`;
    let sessionId: string | null = null;
    let startOffset = 0;
    let hardware: Kind = "none";

    if (decision.mode !== "direct") {
      try {
        const session = await TranscodeSession.create({ userId: user.id, itemId: item.id, fileId: file.id, input: file.path, decision, startAt, settings });
        url = `/api/playback/session/${session.id}/index.m3u8`;
        sessionId = session.id;
        startOffset = session.startOffset;
        hardware = session.hardware;
      } catch (error) {
        log.error("Could not start playback", { item: item.id, file: file.path, error });
        return c.json({ message: errorMessage(error) }, 500);
      }
    }

    const info: PlaybackInfo = {
      mode: decision.mode,
      url,
      sessionId,
      startOffset,
      duration: file.duration ?? 0,
      fileId: file.id,
      audioIndex: decision.audio?.index ?? null,
      subtitleIndex: typeof body.subtitleIndex === "number" ? body.subtitleIndex : null,
      quality,
      audio: audioOptions(file.audio),
      subtitles: subtitleOptions(file.allSubtitles(), token),
      reasons: decision.reasons,
      video: {
        codec: decision.video.codec,
        source: file.videoCodec ?? "unknown",
        action: decision.video.action,
        hardware: decision.video.action === "convert" ? hardware : null,
        height: decision.video.height ?? file.height,
        hdr: decision.video.toneMap ? null : file.hdr,
        bitrate: decision.video.action === "convert" ? decision.video.bitrate : file.bitrate,
      },
      audioStream: decision.audio ? { codec: decision.audio.codec, source: file.audio.find((a) => a.index === decision.audio!.index)?.codec ?? "unknown", action: decision.audio.action, channels: decision.audio.channels } : null,
      isRemote,
      trickplay: await trickplayInfo(file, token, settings.seekThumbnails),
      streamBase: `/api/playback/stream/${token}`,
      canSearchSubtitles: await user.hasPermission("SUBTITLES_DOWNLOAD") && await SubtitleManager.isAvailable(),
    };
    return c.json(info);
  });

  /**
   * @swagger
   * /api/playback/session/{id}:
   *   delete:
   *     summary: Stop a conversion when the player closes or seeks somewhere new.
   */
  router.delete("/session/:id", async (c) => {
    await TranscodeSession.stop(c.req.param("id"));
    return c.body(null, 204);
  });

  /**
   * @swagger
   * /api/playback/session/{id}/ping:
   *   post:
   *     summary: Keep a paused session alive. Sessions without requests stop after 90 seconds.
   */
  router.post("/session/:id/ping", (c) => {
    const session = TranscodeSession.get(c.req.param("id"));
    if (!session) return c.json({ message: "That playback session has ended." }, 404);
    session.touch();
    return c.body(null, 204);
  });

  /**
   * @swagger
   * /api/playback/session/{id}/{file}:
   *   get:
   *     summary: The HLS playlist (`index.m3u8`) and segments of a session.
   */
  router.get("/session/:id/:file", async (c) => {
    const session = TranscodeSession.get(c.req.param("id"));
    if (!session) return c.json({ message: "That playback session has ended." }, 404);
    session.touch();
    const path = session.filePath(c.req.param("file"));
    if (!path) return c.json({ message: "That isn't part of the stream." }, 404);

    // A segment that's still being made is usually only a moment away
    let data: Uint8Array<ArrayBuffer> | null = null;
    for (let attempt = 0; attempt < 100 && !data; attempt++) {
      data = await Deno.readFile(path).catch(() => null);
      if (data || path.endsWith(".m3u8") || session.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!data) return c.json({ message: "That part of the stream isn't ready." }, 404);

    const type = path.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4";
    return c.body(data, 200, { "Content-Type": type, "Cache-Control": path.endsWith(".m3u8") ? "no-cache" : "private, max-age=3600" });
  });

  const VIDEO_TYPES: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/mp4", webm: "video/webm" };

  /**
   * @swagger
   * /api/playback/stream/{token}/file:
   *   get:
   *     summary: The original video file, with range requests for seeking.
   */
  router.get("/stream/:token/file", async (c) => {
    const g = useGrant(c.req.param("token"));
    const file = g ? await MediaFile.findByPk(g.fileId) : null;
    if (!file) return c.json({ message: "This stream has expired. Start playback again." }, 404);

    const stat = await fsp.stat(file.path).catch(() => null);
    if (!stat) return c.json({ message: "The video file can't be found on disk." }, 404);
    const size = stat.size;
    const headers: Record<string, string> = {
      "Content-Type": VIDEO_TYPES[file.container ?? ""] ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-transform",
    };

    // Example: Range: bytes=1000-  or  bytes=1000-1999
    const range = c.req.header("Range")?.match(/^bytes=(\d*)-(\d*)$/);
    let start = 0;
    let end = size - 1;
    if (range) {
      if (range[1] === "") {
        start = Math.max(0, size - Number(range[2]));
      }
      else {
        start = Number(range[1]);
        if (range[2] !== "") end = Math.min(Number(range[2]), size - 1);
      }
      if (start >= size || start > end) {
        return c.body(null, 416, { "Content-Range": `bytes */${size}` });
      }
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    headers["Content-Length"] = String(end - start + 1);
    if (c.req.method === "HEAD") return c.body(null, range ? 206 : 200, headers);

    const handle = await Deno.open(file.path, { read: true });
    await handle.seek(start, Deno.SeekMode.Start);
    let remaining = end - start + 1;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const buffer = new Uint8Array(Math.min(256 * 1024, remaining));
        const read = await handle.read(buffer);
        if (read === null || read === 0) {
          handle.close();
          controller.close();
          return;
        }
        remaining -= read;
        controller.enqueue(buffer.subarray(0, read));
        if (remaining <= 0) {
          handle.close();
          controller.close();
        }
      },
      cancel() {
        try {
          handle.close();
        } catch {
          // Already closed
        }
      },
    });
    return c.body(body, range ? 206 : 200, headers);
  });

  /**
   * @swagger
   * /api/playback/stream/{token}/subtitles/{index}.vtt:
   *   get:
   *     summary: A text subtitle track of the file as WebVTT.
   */
  router.get("/stream/:token/subtitles/:index{[0-9]+\\.vtt}", async (c) => {
    const g = useGrant(c.req.param("token"));
    const file = g ? await MediaFile.findByPk(g.fileId) : null;
    if (!file) return c.json({ message: "This stream has expired. Start playback again." }, 404);
    try {
      const path = await Subtitles.toWebVtt(file, parseInt(c.req.param("index")));
      return c.body(new Uint8Array(await fsp.readFile(path)), 200, { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "private, max-age=3600" });
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/playback/stream/{token}/trickplay:
   *   get:
   *     summary: Seek thumbnails of the stream's file, or `null` while they're being made.
   */
  router.get("/stream/:token/trickplay", async (c) => {
    const g = useGrant(c.req.param("token"));
    const file = g ? await MediaFile.findByPk(g.fileId) : null;
    if (!file) return c.json({ message: "This stream has expired. Start playback again." }, 404);
    return c.json(await trickplayInfo(file, c.req.param("token"), false));
  });

  /**
   * @swagger
   * /api/playback/stream/{token}/trickplay/{n}.jpg:
   *   get:
   *     summary: One sheet of seek thumbnails.
   */
  router.get("/stream/:token/trickplay/:sheet{[0-9]+\\.jpg}", async (c) => {
    const g = useGrant(c.req.param("token"));
    const file = g ? await MediaFile.findByPk(g.fileId) : null;
    if (!file) return c.json({ message: "This stream has expired. Start playback again." }, 404);
    const path = await Trickplay.sheetPath(file, parseInt(c.req.param("sheet")));
    if (!path) return c.json({ message: "That thumbnail sheet doesn't exist." }, 404);
    return c.body(await Deno.readFile(path), 200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" });
  });

  //#region Settings
  const manage = User.$middleware({ permissions: ["SERVER_MANAGE"] });

  /**
   * @swagger
   * /api/playback/settings:
   *   get:
   *     summary: How the server converts video.
   */
  router.get("/settings", manage, async (c) => c.json(await HardwareAcceleration.settings()));

  /**
   * @swagger
   * /api/playback/settings:
   *   put:
   *     summary: Change how the server converts video. Unknown or invalid fields are rejected.
   */
  router.put("/settings", manage, async (c) => {
    const body = await readJson<PlaybackSettings>(c);
    if (!body) return c.json({ message: "Nothing to change." }, 400);
    const next = { ...await HardwareAcceleration.settings(), ...body };

    if (!["none", "vaapi", "qsv", "nvenc"].includes(next.hardwareAcceleration)) return c.json({ message: "Pick Off, VA-API, Quick Sync or NVENC for hardware acceleration." }, 400);
    if (typeof next.device !== "string" || !next.device.startsWith("/dev/")) return c.json({ message: "The GPU device must be a path under /dev, like /dev/dri/renderD128." }, 400);
    if (!Array.isArray(next.hardwareDecodeCodecs) || next.hardwareDecodeCodecs.some((x) => typeof x !== "string")) return c.json({ message: "The GPU decode list must be a list of codec names." }, 400);
    if (!Number.isInteger(next.maxConversions) || next.maxConversions < 1 || next.maxConversions > 32) return c.json({ message: "Simultaneous conversions must be between 1 and 32." }, 400);
    if (!["fast", "balanced", "quality"].includes(next.preset)) return c.json({ message: "The quality preset must be Fast, Balanced or Quality." }, 400);
    if (typeof next.remoteMaxBitrate !== "number" || next.remoteMaxBitrate < 0) return c.json({ message: "The remote stream limit must be 0 (no limit) or more." }, 400);
    next.toneMapping = !!next.toneMapping;
    next.allowRemoteConversion = !!next.allowRemoteConversion;

    const clean: PlaybackSettings = {
      hardwareAcceleration: next.hardwareAcceleration,
      device: next.device,
      hardwareDecodeCodecs: next.hardwareDecodeCodecs,
      maxConversions: next.maxConversions,
      preset: next.preset,
      toneMapping: next.toneMapping,
      remoteMaxBitrate: next.remoteMaxBitrate,
      allowRemoteConversion: next.allowRemoteConversion,
      seekThumbnails: !!next.seekThumbnails,
    };
    await HardwareAcceleration.saveSettings(clean);
    return c.json(clean);
  });

  /**
   * @swagger
   * /api/playback/devices:
   *   get:
   *     summary: GPUs the server can see, and the size of the conversion cache.
   */
  router.get("/devices", manage, async (c) => {
    return c.json({ devices: await HardwareAcceleration.detect(), cacheSize: await TranscodeSession.cacheSize(), cacheDir: TranscodeSession.rootDir, thumbnailsSize: await Trickplay.size() });
  });

  /**
   * @swagger
   * /api/playback/test:
   *   post:
   *     summary: Convert a short test clip with a GPU method. Body `{ "kind": "vaapi", "device": "/dev/dri/renderD128" }`.
   */
  router.post("/test", manage, async (c) => {
    const body = await readJson<{ kind: Kind; device: string }>(c);
    const settings = await HardwareAcceleration.settings();
    const kind = body?.kind ?? settings.hardwareAcceleration;
    if (!["none", "vaapi", "qsv", "nvenc"].includes(kind)) return c.json({ message: "Unknown hardware acceleration method." }, 400);
    return c.json(await HardwareAcceleration.test(kind, body?.device ?? settings.device));
  });

  /**
   * @swagger
   * /api/playback/cache:
   *   delete:
   *     summary: Stop every conversion and delete converted files and extracted subtitles.
   */
  router.delete("/cache", manage, async (c) => {
    await TranscodeSession.stopAll();
    await TranscodeSession.init();
    await fsp.rm(Subtitles.cacheDir, { recursive: true, force: true });
    return c.json({ cacheSize: await TranscodeSession.cacheSize() });
  });
  //#endregion
}

export default PlaybackController;
