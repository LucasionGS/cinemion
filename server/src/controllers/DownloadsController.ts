import fsp from "node:fs/promises";
import Path from "node:path";
import { Hono } from "hono";
import { isPlayable } from "@shared/media.ts";
import { languageName } from "@shared/languages.ts";
import type { DownloadInfo, DownloadOption, DownloadOptions, DownloadQuality, StartDownloadRequest } from "@shared/downloads.ts";
import type { DeviceCapabilities } from "@shared/playback.ts";
import { MediaFile, MediaItem, User } from "../models/index.ts";
import Visibility from "../library/Visibility.ts";
import ItemLabels from "../library/ItemLabels.ts";
import PlaybackDecider from "../media/PlaybackDecider.ts";
import HardwareAcceleration from "../media/HardwareAcceleration.ts";
import OfflineCopies from "../media/OfflineCopies.ts";
import Subtitles from "../media/Subtitles.ts";
import Events from "../integrations/Events.ts";
import { errorMessage, readJson, sendFile } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Offline downloads: which sizes a title can be saved at on this device, making copies, and handing out the file
 * and its subtitles. Fetched with the sign-in header, so the browser can save them in the background.
 */
export namespace DownloadsController {
  export const router = new Hono<AppEnv>();

  const allowed = User.$middleware({ permissions: ["MEDIA_DOWNLOAD"] });
  const QUALITIES: DownloadQuality[] = ["original", "1080p", "720p", "480p"];
  const VIDEO_TYPES: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/mp4", webm: "video/webm" };

  /**
   * What a download id says. Example: "12.720p.1" is file 12 at 720p with audio stream 1; "d" is the default track.
   */
  function parseId(id: string) {
    const match = id.match(/^(\d+)\.(original|1080p|720p|480p)\.(\d+|d)$/);
    return match ? { fileId: Number(match[1]), quality: match[2] as DownloadQuality, audioIndex: match[3] === "d" ? null : Number(match[3]) } : null;
  }

  function makeId(fileId: number, quality: DownloadQuality, audioIndex: number | null) {
    return `${fileId}.${quality}.${quality === "original" || audioIndex === null ? "d" : audioIndex}`;
  }

  function copyKey(file: MediaFile, quality: DownloadQuality, audioIndex: number | null) {
    return `${file.id}-${file.mtime}-${quality}-${audioIndex ?? "d"}`;
  }

  async function visibleFile(user: User, fileId: number) {
    const file = await MediaFile.findByPk(fileId);
    const item = file?.itemId ? await MediaItem.findByPk(file.itemId) : null;
    return file && item && isPlayable(item.type) && Visibility.canSee(user, item) ? { file, item } : null;
  }

  /**
   * Whether this browser plays the file as it is, so the original can be saved.
   */
  async function playsAsIs(file: MediaFile, capabilities: DeviceCapabilities | undefined) {
    if (!capabilities) return false;
    const decision = PlaybackDecider.decide(file.toInfo(), { capabilities, quality: "original", audioIndex: null, subtitleIndex: null, isRemote: false }, await HardwareAcceleration.settings());
    return decision.mode === "direct";
  }

  async function info(id: string, file: MediaFile, item: MediaItem): Promise<DownloadInfo> {
    const parsed = parseId(id)!;
    const subtitles = file.allSubtitles().filter((t) => !t.isImage).map((t) => ({
      index: t.index,
      label: [t.title ?? languageName(t.language) ?? "Subtitles", t.isForced ? "Forced" : null].filter(Boolean).join(" · "),
      language: t.language,
      isForced: t.isForced,
      url: `/api/downloads/${id}/subtitles/${t.index}.vtt`,
    }));
    if (parsed.quality === "original") {
      const stat = await fsp.stat(file.path).catch(() => null);
      return { id, itemId: item.id, fileId: file.id, quality: "original", status: stat ? "ready" : "failed", progress: null, size: stat?.size ?? null, contentType: VIDEO_TYPES[file.container ?? ""] ?? "video/mp4", error: stat ? null : "The video file can't be found on disk.", subtitles };
    }
    const state = await OfflineCopies.status(copyKey(file, parsed.quality, parsed.audioIndex));
    return { id, itemId: item.id, fileId: file.id, quality: parsed.quality, ...state, contentType: "video/mp4", subtitles };
  }

  /**
   * @swagger
   * /api/downloads/options:
   *   post:
   *     summary: The sizes a title can be saved at for offline viewing on this device. Body `{ itemId, capabilities }`.
   */
  router.post("/options", allowed, async (c) => {
    const user = c.get("user")!;
    const body = await readJson<{ itemId: number; capabilities: DeviceCapabilities }>(c);
    const item = body?.itemId ? await MediaItem.findByPk(Number(body.itemId)) : null;
    if (!item || !isPlayable(item.type) || !Visibility.canSee(user, item)) return c.json({ message: "Only movies, episodes and videos can be downloaded." }, 404);
    const file = (await MediaFile.findAll({ where: { itemId: item.id } })).sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
    if (!file) return c.json({ message: "This title has no video file." }, 404);

    const duration = file.duration;
    const options: DownloadOption[] = [];
    if (await playsAsIs(file, body?.capabilities)) {
      options.push({ quality: "original", label: "Original", size: Number(file.size), note: "Plays as it is, at full quality" });
    }
    for (const quality of ["1080p", "720p", "480p"] as const) {
      const size = OfflineCopies.SIZES[quality];
      // Copies are never taller than the original; small videos still get the small size
      if (quality !== "480p" && size.height > (file.height ?? 0) * 1.05) continue;
      options.push({
        quality,
        label: quality === "1080p" ? "High (1080p)" : quality === "720p" ? "Medium (720p)" : "Small (480p)",
        size: duration ? Math.round(duration * (size.bitrate + OfflineCopies.AUDIO_BITRATE) / 8) : null,
        note: "Made on the server first",
      });
    }
    const result: DownloadOptions = { fileId: file.id, duration, options };
    return c.json(result);
  });

  /**
   * @swagger
   * /api/downloads:
   *   post:
   *     summary: Get a title ready to save offline (`StartDownloadRequest`). Copies are made in the background; poll
   *       `GET /api/downloads/{id}` until it's ready.
   */
  router.post("/", allowed, async (c) => {
    const user = c.get("user")!;
    const body = await readJson<StartDownloadRequest>(c);
    if (!body?.itemId || !QUALITIES.includes(body.quality as DownloadQuality)) return c.json({ message: "Pick a title and a size to download." }, 400);
    const item = await MediaItem.findByPk(Number(body.itemId));
    if (!item || !isPlayable(item.type) || !Visibility.canSee(user, item)) return c.json({ message: "Only movies, episodes and videos can be downloaded." }, 404);
    const files = await MediaFile.findAll({ where: { itemId: item.id } });
    const file = (body.fileId ? files.find((f) => f.id === body.fileId) : null) ?? files.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
    if (!file) return c.json({ message: "This title has no video file." }, 404);
    if (body.quality === "original" && !await playsAsIs(file, body.capabilities)) return c.json({ message: "This device can't play the original file. Pick one of the other sizes." }, 400);

    const audioIndex = typeof body.audioIndex === "number" && file.audio.some((a) => a.index === body.audioIndex) ? body.audioIndex : null;
    const id = makeId(file.id, body.quality as DownloadQuality, audioIndex);
    const label = await ItemLabels.describe(item);
    if (body.quality !== "original") {
      try {
        await OfflineCopies.prepare(copyKey(file, body.quality as DownloadQuality, audioIndex), file, body.quality as Exclude<DownloadQuality, "original">, audioIndex, `${label.inline} (${body.quality})`);
      } catch (error) {
        return c.json({ message: errorMessage(error) }, 500);
      }
    }
    Events.activity({ kind: "download", message: `${user.name} saved ${label.inline} to watch offline`, userId: user.id, itemId: item.id, dedupeHours: 12 });
    return c.json(await info(id, file, item));
  });

  /**
   * @swagger
   * /api/downloads/{id}:
   *   get:
   *     summary: Whether a download is ready, or how far its copy is.
   */
  router.get("/:id", allowed, async (c) => {
    const parsed = parseId(c.req.param("id"));
    const found = parsed ? await visibleFile(c.get("user")!, parsed.fileId) : null;
    if (!parsed || !found) return c.json({ message: "That download doesn't exist." }, 404);
    return c.json(await info(c.req.param("id"), found.file, found.item));
  });

  /**
   * @swagger
   * /api/downloads/{id}/file:
   *   get:
   *     summary: The video to save, with range requests so an interrupted download can carry on.
   */
  router.get("/:id/file", allowed, async (c) => {
    const parsed = parseId(c.req.param("id"));
    const found = parsed ? await visibleFile(c.get("user")!, parsed.fileId) : null;
    if (!parsed || !found) return c.json({ message: "That download doesn't exist." }, 404);
    const { file } = found;
    let path = file.path;
    let type = VIDEO_TYPES[file.container ?? ""] ?? "video/mp4";
    if (parsed.quality !== "original") {
      const key = copyKey(file, parsed.quality, parsed.audioIndex);
      if ((await OfflineCopies.status(key)).status !== "ready") return c.json({ message: "The copy isn't ready yet." }, 409);
      path = OfflineCopies.pathFor(key);
      type = "video/mp4";
      await OfflineCopies.touch(key);
    }
    const name = `${Path.basename(file.path, Path.extname(file.path))}${parsed.quality === "original" ? Path.extname(file.path) : ` (${parsed.quality}).mp4`}`;
    c.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    const response = await sendFile(c, path, type);
    return response ?? c.json({ message: "The video file can't be found on disk." }, 404);
  });

  /**
   * @swagger
   * /api/downloads/{id}/subtitles/{index}.vtt:
   *   get:
   *     summary: A text subtitle track of the download's file as WebVTT, to save alongside it.
   */
  router.get("/:id/subtitles/:file", allowed, async (c) => {
    const parsed = parseId(c.req.param("id"));
    const found = parsed ? await visibleFile(c.get("user")!, parsed.fileId) : null;
    const index = Number(c.req.param("file").replace(/\.vtt$/, ""));
    if (!parsed || !found || !Number.isInteger(index)) return c.json({ message: "That subtitle track doesn't exist." }, 404);
    try {
      const path = await Subtitles.toWebVtt(found.file, index);
      return c.body(new Uint8Array(await fsp.readFile(path)), 200, { "Content-Type": "text/vtt; charset=utf-8" });
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 404);
    }
  });
}

export default DownloadsController;
