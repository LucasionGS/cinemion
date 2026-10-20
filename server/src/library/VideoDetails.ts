import fsp from "node:fs/promises";
import Path from "node:path";
import AppSystem from "../AppSystem.ts";
import { Library, MediaFile, MediaItem } from "../models/index.ts";
import { EMPTY_ARTWORK } from "../models/MediaItem.ts";
import ImageCache from "../images/ImageCache.ts";
import Palette from "../images/Palette.ts";
import Nfo from "../metadata/Nfo.ts";
import Ffmpeg from "../lib/Ffmpeg.ts";
import ContentRatings from "./ContentRatings.ts";
import FolderTree from "./FolderTree.ts";
import log from "../lib/Logger.ts";

/**
 * Details for Videos libraries, which are never looked up online: titles from file names, dates from the recording,
 * thumbnails picked from the video itself, and whatever someone typed in "Edit details".
 */
export namespace VideoDetails {
  const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
  // Pictures next to a video (Beach day.jpg, Beach day-thumb.jpg) or in a folder (folder.jpg) that are used as-is
  const VIDEO_IMAGE_SUFFIXES = ["", "-thumb", "-poster", "-fanart"];
  const FOLDER_IMAGE_NAMES = ["folder", "cover", "poster", "thumb"];
  const THUMBNAIL_WIDTH = 1920;
  // Recording dates before this are camera clocks that were never set
  const EARLIEST_YEAR = 1990;

  /**
   * A readable title from a file name: "Beach_day.mp4" becomes "Beach day".
   */
  export function titleFromFile(path: string) {
    const name = Path.parse(path).name;
    // Names without spaces use dots or underscores instead; names with spaces keep them as they are
    const spaced = /\s/.test(name) ? name : name.replace(/[._]+/g, " ");
    return spaced.replace(/\s+/g, " ").trim() || name;
  }

  function localDate(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  /**
   * The day a video was recorded, from the creation time phones and cameras write into the file, or else the
   * file's modification date. `YYYY-MM-DD` in the server's time zone.
   * @param mtime Unit is in milliseconds since the epoch.
   */
  export async function recordedDate(path: string, mtime: number): Promise<string | null> {
    // Example output: {"format":{"tags":{"creation_time":"2024-07-12T14:03:22.000000Z"}},"streams":[...]}
    const result = await new Deno.Command(AppSystem.config.FFPROBE_PATH, {
      args: ["-v", "error", "-show_entries", "format_tags=creation_time:stream_tags=creation_time", "-of", "json", path],
      stdout: "piped",
      stderr: "null",
    }).output().catch(() => null);
    if (result?.success) {
      try {
        const data = JSON.parse(new TextDecoder().decode(result.stdout));
        const times = [data.format?.tags?.creation_time, ...(data.streams ?? []).map((s: { tags?: { creation_time?: string } }) => s.tags?.creation_time)];
        for (const time of times) {
          const date = time ? new Date(time) : null;
          if (date && !isNaN(date.getTime()) && date.getFullYear() >= EARLIEST_YEAR) return localDate(date);
        }
      } catch {
        // Fall back to the file date
      }
    }
    return mtime ? localDate(new Date(mtime)) : null;
  }

  async function firstExisting(paths: string[]) {
    for (const path of paths) {
      if (await fsp.stat(path).then((s) => s.isFile()).catch(() => false)) return path;
    }
    return null;
  }

  function videoImages(videoPath: string) {
    const { dir, name } = Path.parse(videoPath);
    return VIDEO_IMAGE_SUFFIXES.flatMap((suffix) => IMAGE_EXTENSIONS.map((ext) => Path.join(dir, `${name}${suffix}${ext}`)));
  }

  function folderImages(folder: string) {
    return FOLDER_IMAGE_NAMES.flatMap((name) => IMAGE_EXTENSIONS.map((ext) => Path.join(folder, `${name}${ext}`)));
  }

  function frameFilters(file: MediaFile, width: number, pick: boolean) {
    // The thumbnail filter picks the most typical of the next frames, which skips fades and blurry moments
    const filters = pick ? ["thumbnail=n=48"] : [];
    filters.push(`scale='min(${width},iw)':-2`);
    // HDR frames look washed out on ordinary screens
    if (file.hdr) filters.push("zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709", "tonemap=tonemap=hable:desat=0", "zscale=t=bt709:m=bt709:r=tv");
    filters.push("format=yuvj420p");
    return filters.join(",");
  }

  /**
   * Where the automatic thumbnail is taken: a tenth of the way in, past intros and fades, and at most a minute in.
   * Unit is in seconds.
   */
  export function automaticTime(duration: number | null) {
    return duration ? Math.min(60, duration * 0.1) : 0;
  }

  /**
   * One frame of the video as a JPEG, for the frame picker in "Edit details".
   * @param time Unit is in seconds.
   */
  export async function frame(file: MediaFile, time: number, width = 640): Promise<Uint8Array | null> {
    const at = Math.max(0, Math.min(time, (file.duration ?? time) - 0.1));
    const result = await Ffmpeg.run(["-ss", String(at), "-i", file.path, "-map", "0:V:0", "-vf", frameFilters(file, width, false), "-frames:v", "1", "-q:v", "4", "-f", "image2", "-c:v", "mjpeg", "pipe:1"]);
    return result.code === 0 && result.stdout.length > 0 ? result.stdout : null;
  }

  /**
   * Take a thumbnail from the video and store it. With `time`, that exact moment; without, a typical frame
   * near `automaticTime()`.
   * @returns The image key, or `null` when ffmpeg can't read the video.
   */
  export async function makeThumbnail(file: MediaFile, time?: number): Promise<string | null> {
    const pick = time === undefined;
    const at = pick ? automaticTime(file.duration) : Math.max(0, Math.min(time!, (file.duration ?? time!) - 0.1));
    const temp = Path.join(AppSystem.tempDir, `thumb-${crypto.randomUUID()}.jpg`);
    try {
      let result = await Ffmpeg.run(["-y", "-ss", String(at), "-i", file.path, "-map", "0:V:0", "-vf", frameFilters(file, THUMBNAIL_WIDTH, pick), "-frames:v", "1", "-q:v", "2", temp]);
      // Very short clips can end before the picked moment; the first frame always exists
      if (result.code !== 0 || !await fsp.stat(temp).then((s) => s.size > 0).catch(() => false)) {
        result = await Ffmpeg.run(["-y", "-i", file.path, "-map", "0:V:0", "-vf", frameFilters(file, THUMBNAIL_WIDTH, false), "-frames:v", "1", "-q:v", "2", temp]);
      }
      if (result.code !== 0) {
        log.warn(`Could not take a thumbnail from ${file.path}`, { error: result.stderr.trim().split("\n").pop() });
        return null;
      }
      return await ImageCache.store({ file: temp });
    } finally {
      await fsp.rm(temp, { force: true });
    }
  }

  /**
   * Store an uploaded picture as a thumbnail.
   * @throws When the file isn't a picture ffmpeg can read.
   */
  export async function storeUpload(bytes: Uint8Array): Promise<string> {
    const temp = Path.join(AppSystem.tempDir, `upload-${crypto.randomUUID()}`);
    const converted = `${temp}.jpg`;
    try {
      await fsp.writeFile(temp, bytes);
      // Re-encoding checks it's really a picture, and drops anything else hidden in the upload
      const result = await Ffmpeg.run(["-y", "-i", temp, "-vf", `scale='min(${THUMBNAIL_WIDTH},iw)':-2,format=yuvj420p`, "-frames:v", "1", "-q:v", "2", converted]);
      if (result.code !== 0) throw new Error("That file isn't a picture Cinemion can read. Use a JPG, PNG or WebP image.");
      const key = await ImageCache.store({ file: converted });
      if (!key) throw new Error("The picture couldn't be saved. The server log has the details.");
      return key;
    } finally {
      await fsp.rm(temp, { force: true });
      await fsp.rm(converted, { force: true });
    }
  }

  /**
   * Use `key` as the item's thumbnail and backdrop, and take the ambient colours from it.
   */
  export async function setThumbnail(item: MediaItem, key: string | null) {
    if (key === item.artwork.thumb) return;
    item.artwork = { ...EMPTY_ARTWORK, thumb: key, backdrop: key };
    item.palette = key ? await Palette.fromImage(key) : null;
  }

  /**
   * Fill in a video's details from its file. Hand-made details and thumbnails are kept.
   * @param opts.regenerate Take a new automatic thumbnail even when there is one.
   */
  export async function refreshVideo(item: MediaItem, opts?: { regenerate?: boolean; library?: Library | null }) {
    opts ??= {};
    const file = await MediaFile.findOne({ where: { itemId: item.id }, order: [["path", "ASC"]] });
    if (!file) return;
    const library = opts.library ?? await Library.findByPk(item.libraryId);

    if (!item.editedAt) {
      const { dir, name } = Path.parse(file.path);
      const nfo = await Nfo.readFirst([Path.join(dir, `${name}.nfo`)]);
      if (nfo?.title) item.setTitle(nfo.title);
      if (nfo?.overview) item.overview = nfo.overview;
      if (nfo?.genres?.length) item.genres = nfo.genres;
      if (nfo?.contentRating) item.contentRating = nfo.contentRating;
      item.releaseDate = nfo?.releaseDate ?? item.releaseDate ?? await recordedDate(file.path, Number(file.mtime));
    }
    item.year = item.releaseDate ? parseInt(item.releaseDate.slice(0, 4)) || null : null;
    item.runtime = file.duration ? Math.max(1, Math.round(file.duration / 60)) : null;
    item.ageRating = ContentRatings.ageFor(item.contentRating) ?? library?.defaultAge() ?? null;
    item.matchStatus = "matched";

    if (!item.customArtwork) {
      const image = await firstExisting(videoImages(file.path));
      const key = image ? await ImageCache.store({ file: image }) : null;
      if (key) await setThumbnail(item, key);
      else if (opts.regenerate || !item.artwork.thumb) await setThumbnail(item, await makeThumbnail(file));
    }
    item.metadataUpdatedAt = new Date();
    await item.save();
  }

  /**
   * Update every folder of a library from what's inside it: the thumbnail (a picture in the folder, or the newest
   * video's), the newest recording date, and the lowest age rating, so a folder shows for anyone who may see a
   * video in it.
   */
  export async function refreshFolders(library: Library) {
    const folders = await MediaItem.findAll({ where: { libraryId: library.id, type: "folder" } });
    const tree = await FolderTree.load([library.id]);
    for (const folder of folders) {
      const videos = tree.videosUnder(folder.id);
      const ages = videos.map((v) => v.ageRating).filter((a): a is number => a !== null);
      folder.ageRating = ages.length ? Math.min(...ages) : null;
      folder.releaseDate = videos.map((v) => v.releaseDate).filter((d): d is string => !!d).sort().pop() ?? null;
      folder.year = folder.releaseDate ? parseInt(folder.releaseDate.slice(0, 4)) || null : null;
      folder.matchStatus = "matched";

      if (!folder.customArtwork) {
        const image = folder.folderPath ? await firstExisting(folderImages(folder.folderPath)) : null;
        const own = image ? await ImageCache.store({ file: image }) : null;
        const newest = [...videos].sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime()).find((v) => v.artwork.thumb);
        await setThumbnail(folder, own ?? newest?.artwork.thumb ?? null);
      }
      if (!folder.metadataUpdatedAt) folder.metadataUpdatedAt = new Date();
      if (folder.changed()) await folder.save();
    }
  }

  /**
   * Give unrated videos the library's rating for unrated videos, after it changed.
   */
  export async function applyDefaultRating(library: Library) {
    const videos = await MediaItem.findAll({ where: { libraryId: library.id, type: "video", contentRating: null } });
    for (const video of videos) {
      video.ageRating = library.defaultAge();
      if (video.changed()) await video.save();
    }
    await refreshFolders(library);
  }

  /**
   * The folders above an item, outermost first.
   */
  export async function ancestors(item: MediaItem) {
    const result: { id: number; title: string }[] = [];
    let parentId = item.type === "video" || item.type === "folder" ? item.parentId : null;
    while (parentId) {
      const parent = await MediaItem.findByPk(parentId, { attributes: ["id", "title", "parentId", "type"] });
      if (!parent || parent.type !== "folder") break;
      result.unshift({ id: parent.id, title: parent.title });
      parentId = parent.parentId;
    }
    return result;
  }
}

export default VideoDetails;
