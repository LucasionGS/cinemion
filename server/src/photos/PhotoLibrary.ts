import fsp from "node:fs/promises";
import Path from "node:path";
import type { PhotoMeta } from "@shared/photos.ts";
import AppSystem from "../AppSystem.ts";
import { Library, MediaFile, type MediaItem } from "../models/index.ts";
import { EMPTY_ARTWORK } from "../models/MediaItem.ts";
import ImageCache from "../images/ImageCache.ts";
import NameParser from "../library/NameParser.ts";
import ContentRatings from "../library/ContentRatings.ts";
import VideoDetails from "../library/VideoDetails.ts";
import Ffmpeg from "../lib/Ffmpeg.ts";
import Exif from "./Exif.ts";
import log from "../lib/Logger.ts";

/**
 * Details for Photos libraries, which come only from the files: when a photo was taken (EXIF, then the file name,
 * then the file date), its size and camera, and a thumbnail. Originals stay on disk untouched.
 */
export namespace PhotoLibrary {
  export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".jpe", ".png", ".webp", ".heic", ".heif", ".hif", ".avif", ".gif", ".bmp", ".tif", ".tiff", ".jxl"]);
  // Formats browsers show as they are; the others are converted to JPEG for viewing
  const BROWSER_FORMATS: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".jpe": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
  };
  // Longest side of the stored thumbnail, and of the copy made for viewing formats browsers can't show
  const THUMBNAIL_SIZE = 1920;
  const VIEW_SIZE = 4096;
  // Made during the scan, since that's the size the grids ask for first
  const GRID_WIDTH = 500;
  // Copies for viewing that nobody opened for this long are deleted
  const VIEW_COPY_DAYS = 30;
  // Decoded with libheif's heif-convert when it's there: older ffmpeg (Debian's 7.1) shows only one tile of a
  // phone's HEIC and ignores the HEIF rotation
  const HEIF_EXTENSIONS = new Set([".heic", ".heif", ".hif", ".avif"]);
  // ffmpeg filters that turn a picture upright, per EXIF orientation (2 to 8)
  const ORIENTATION_FILTERS: Record<number, string[]> = {
    2: ["hflip"],
    3: ["hflip", "vflip"],
    4: ["vflip"],
    5: ["transpose=0"],
    6: ["transpose=1"],
    7: ["transpose=3"],
    8: ["transpose=2"],
  };

  let _heifConvert: Promise<boolean> | null = null;

  export function isImage(path: string) {
    return IMAGE_EXTENSIONS.has(Path.extname(path).toLowerCase());
  }

  /**
   * What a Photos library picks up: pictures and videos.
   */
  export function isPhotoOrVideo(path: string) {
    return isImage(path) || NameParser.isVideo(path);
  }

  /**
   * `YYYY-MM-DDTHH:MM:SS` in the server's time zone.
   */
  export function localDateTime(date: Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  /**
   * When a photo was taken, from a file name phones and apps write: `IMG_20240713_143210.jpg`,
   * `Screenshot 2024-07-13 at 14.32.10.png`, `IMG-20240713-WA0001.jpg` (the day only). `null` when the name has no date.
   */
  export function takenFromName(path: string): string | null {
    const name = Path.parse(path).name;
    // Example: PXL_20240713_133210123 -> 2024-07-13T13:32:10
    const match = name.match(/(?<!\d)((?:18|19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:(?:[-_ T.]|\s+at\s+)?([01]\d|2[0-3])[-_.:h ]?([0-5]\d)[-_.:m ]?([0-5]\d))?/i);
    if (!match) return null;
    const [, y, mo, d, h = "00", mi = "00", s = "00"] = match;
    const result = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
    return Exif.isRealDateTime(result) ? result : null;
  }

  /**
   * Read a picture's EXIF and size into its file row. Pictures aren't media, so ffprobe isn't needed.
   */
  export async function readFile(file: MediaFile) {
    const meta = await Exif.read(file.path);
    await file.update({
      container: Path.extname(file.path).slice(1).toLowerCase(),
      photo: meta,
      width: meta.width,
      height: meta.height,
      duration: null,
      probedAt: new Date(),
    });
  }

  /**
   * The size a video shows at, which differs from how it's stored when the phone was held upright.
   */
  async function videoDisplaySize(file: MediaFile) {
    const probe = await Ffmpeg.probe(file.path).catch(() => null);
    const stream = probe?.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
    if (!stream?.width || !stream.height) return null;
    const rotation = Math.abs(stream.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation ?? 0);
    return rotation === 90 || rotation === 270 ? { width: stream.height, height: stream.width } : { width: stream.width, height: stream.height };
  }

  function hasHeifConvert() {
    _heifConvert ??= new Deno.Command("heif-convert", { args: ["--version"], stdout: "null", stderr: "null" }).output().then((r) => r.success).catch(() => false);
    return _heifConvert;
  }

  /**
   * Write a photo as an upright JPEG of at most `size` on its longest side. ffmpeg's own turning differs between
   * versions (older ones only turn JPEGs), so it's switched off and the EXIF orientation is applied here instead.
   * HEIC and AVIF go through heif-convert first when it's installed, which puts tiles together and turns them.
   * @returns ffmpeg's error, or `null` when it worked.
   */
  async function convert(file: MediaFile, output: string, size: number, quality: number): Promise<string | null> {
    const ext = Path.extname(file.path).toLowerCase();
    const scale = `scale='min(${size},iw)':'min(${size},ih)':force_original_aspect_ratio=decrease:flags=lanczos`;
    let input = ["-noautorotate", "-i", file.path];
    let upright = ORIENTATION_FILTERS[file.photo?.orientation ?? 1] ?? [];
    let decoded: string | null = null;
    if (HEIF_EXTENSIONS.has(ext)) {
      if (await hasHeifConvert()) {
        decoded = Path.join(AppSystem.tempDir, `heif-${crypto.randomUUID()}.jpg`);
        const result = await new Deno.Command("heif-convert", { args: ["--quiet", "-q", "95", file.path, decoded], stdout: "null", stderr: "piped" }).output().catch(() => null);
        if (result?.success) input = ["-noautorotate", "-i", decoded];
        else input = ["-i", file.path];
      }
      // Without heif-convert, ffmpeg's own HEIF support is the best there is (the turning comes from the file)
      else input = ["-i", file.path];
      upright = [];
    }
    try {
      // No -map: tiled HEIC pictures are only put together when ffmpeg picks the streams itself
      const result = await Ffmpeg.run(["-y", ...input, "-vf", [...upright, scale, "format=yuvj420p"].join(","), "-frames:v", "1", "-q:v", String(quality), "-update", "1", output]);
      if (result.code !== 0 || !await fsp.stat(output).then((s) => s.size > 0).catch(() => false)) return result.stderr.trim().split("\n").pop() || "ffmpeg made no picture";
      return null;
    } finally {
      if (decoded) await fsp.rm(decoded, { force: true });
    }
  }

  /**
   * Make a photo's thumbnail (turned upright, at most `THUMBNAIL_SIZE` on its longest side) and store it under an
   * identity made from the file, so a changed file gets a new one.
   * @returns The image key and the thumbnail's size, or `null` when ffmpeg can't read the picture.
   */
  async function makeThumbnail(file: MediaFile, identity: string): Promise<{ key: string; width: number; height: number } | null> {
    const temp = Path.join(AppSystem.tempDir, `photo-${crypto.randomUUID()}.jpg`);
    try {
      const error = await convert(file, temp, THUMBNAIL_SIZE, 3);
      if (error) {
        log.warn(`Could not make a thumbnail of ${file.path}`, { error });
        return null;
      }
      const probe = await Ffmpeg.probe(temp).catch(() => null);
      const stream = probe?.streams.find((s) => s.codec_type === "video");
      const key = await ImageCache.store({ file: temp }, identity);
      if (!key || !stream?.width || !stream.height) return null;
      await ImageCache.variant(key, GRID_WIDTH);
      return { key, width: stream.width, height: stream.height };
    } finally {
      await fsp.rm(temp, { force: true });
    }
  }

  function identityOf(file: MediaFile) {
    return `photo:${file.path}:${file.size}:${file.mtime}`;
  }

  /**
   * Fill in a photo's date, age rating and thumbnail from its file. Details edited by hand are kept, and the
   * thumbnail is only made again when the file changed or `regenerate` is set, which also reads the EXIF again.
   */
  export async function refreshPhoto(item: MediaItem, opts?: { regenerate?: boolean; library?: Library | null }) {
    opts ??= {};
    const file = await MediaFile.findOne({ where: { itemId: item.id }, order: [["path", "ASC"]] });
    if (!file) return;
    if (opts.regenerate) await readFile(file);
    const library = opts.library ?? await Library.findByPk(item.libraryId);

    if (!item.editedAt) {
      item.takenAt = file.photo?.takenAt ?? takenFromName(file.path) ?? localDateTime(new Date(Number(file.mtime)));
      item.releaseDate = item.takenAt.slice(0, 10);
    }
    item.year = item.releaseDate ? parseInt(item.releaseDate.slice(0, 4)) || null : null;
    item.ageRating = ContentRatings.ageFor(item.contentRating) ?? library?.defaultAge() ?? null;
    item.matchStatus = "matched";

    const identity = identityOf(file);
    const expected = await ImageCache.keyFor(identity);
    if (opts.regenerate || item.artwork.thumb !== expected || !await ImageCache.has(expected)) {
      const thumb = await makeThumbnail(file, identity);
      item.artwork = { ...EMPTY_ARTWORK, thumb: thumb?.key ?? null };
      if (thumb) {
        // The thumbnail is upright, whatever the file's orientation; its shape decides which way round the size is
        let { width, height } = { width: file.width ?? thumb.width, height: file.height ?? thumb.height };
        if ((width > height) !== (thumb.width > thumb.height) && width !== height) [width, height] = [height, width];
        await file.update({ width, height });
      }
    }
    item.metadataUpdatedAt = new Date();
    await item.save();
  }

  /**
   * Fill in a video in a Photos library: what a Videos library does, plus when it was recorded to the second and
   * the size it shows at.
   */
  export async function refreshVideo(item: MediaItem, opts?: { regenerate?: boolean; library?: Library | null }) {
    opts ??= {};
    await VideoDetails.refreshVideo(item, opts);
    const file = await MediaFile.findOne({ where: { itemId: item.id }, order: [["path", "ASC"]] });
    if (!file) return;
    // A date typed in by hand sets `takenAt` too, so only the recorded time is filled in here
    if (!item.editedAt || !item.takenAt) {
      const recorded = await VideoDetails.recordedAt(file.path, Number(file.mtime));
      const sameDay = recorded && (!item.releaseDate || recorded.startsWith(item.releaseDate));
      item.takenAt = sameDay ? recorded : item.releaseDate ? `${item.releaseDate}T00:00:00` : recorded;
      await item.save();
    }
    const size = await videoDisplaySize(file);
    if (size) await file.update({ photo: { ...emptyMeta(), ...size } });
  }

  function emptyMeta(): PhotoMeta {
    return { width: null, height: null, orientation: 1, takenAt: null, offset: null, camera: null, lens: null, fNumber: null, exposureTime: null, iso: null, focalLength: null, latitude: null, longitude: null };
  }

  /**
   * The picture to show in the viewer: the original when browsers show its format, otherwise a JPEG copy made
   * once and kept for a while.
   * @returns `null` when the file is gone or can't be converted.
   */
  export async function viewFile(file: MediaFile): Promise<{ path: string; contentType: string } | null> {
    const ext = Path.extname(file.path).toLowerCase();
    if (BROWSER_FORMATS[ext]) return { path: file.path, contentType: BROWSER_FORMATS[ext] };

    const target = Path.join(AppSystem.photosDir, `${await ImageCache.keyFor(identityOf(file))}.jpg`);
    if (await fsp.stat(target).then(() => true).catch(() => false)) {
      // Opened again, so it stays a while longer
      const now = new Date();
      await fsp.utimes(target, now, now).catch(() => { });
      return { path: target, contentType: "image/jpeg" };
    }
    const temp = `${target}.${crypto.randomUUID()}.jpg`;
    const error = await convert(file, temp, VIEW_SIZE, 2);
    if (error) {
      await fsp.rm(temp, { force: true });
      log.warn(`Could not convert ${file.path} for viewing`, { error });
      return null;
    }
    await fsp.rename(temp, target);
    return { path: target, contentType: "image/jpeg" };
  }

  /**
   * The original's type, for downloads.
   */
  export function contentType(path: string) {
    const ext = Path.extname(path).toLowerCase();
    const others: Record<string, string> = { ".heic": "image/heic", ".heif": "image/heif", ".hif": "image/heif", ".tif": "image/tiff", ".tiff": "image/tiff", ".jxl": "image/jxl" };
    return BROWSER_FORMATS[ext] ?? others[ext] ?? "application/octet-stream";
  }

  /**
   * Delete copies for viewing that nobody opened in a while.
   */
  export async function cleanup() {
    const cutoff = Date.now() - VIEW_COPY_DAYS * 24 * 60 * 60 * 1000;
    for (const entry of await fsp.readdir(AppSystem.photosDir).catch(() => [])) {
      const path = Path.join(AppSystem.photosDir, entry);
      const stat = await fsp.stat(path).catch(() => null);
      if (stat && (stat.mtime?.getTime() ?? 0) < cutoff) await fsp.rm(path, { force: true });
    }
  }
}

export default PhotoLibrary;
