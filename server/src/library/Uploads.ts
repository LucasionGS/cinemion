import fs from "node:fs";
import fsp from "node:fs/promises";
import Path from "node:path";
import os from "node:os";
import type { LibraryType } from "@shared/api.ts";
import type { StartUploadRequest, UploadInfo, UploadRules } from "@shared/uploads.ts";
import AppSystem from "../AppSystem.ts";
import { Library, User } from "../models/index.ts";
import NameParser from "./NameParser.ts";
import Sidecars from "./Sidecars.ts";
import Scanner from "./Scanner.ts";
import MusicTags from "../music/MusicTags.ts";
import BookLibrary from "../books/BookLibrary.ts";
import PhotoLibrary from "../photos/PhotoLibrary.ts";
import MediaRoots from "../lib/MediaRoots.ts";
import SystemStats from "../lib/SystemStats.ts";
import ZipReader from "../lib/ZipReader.ts";
import Tasks from "../lib/Tasks.ts";
import Events from "../integrations/Events.ts";
import log from "../lib/Logger.ts";
import { errorMessage } from "../lib/http.ts";

/**
 * Media uploaded from the browser. Each upload is a folder in `AppSystem.uploadsDir` with the data received so far
 * and an `info.json`, so it can be picked up again after a dropped connection, a reload or a server restart. Pieces
 * are written to disk as they arrive, never held in memory. A complete upload is moved into the library folder, or
 * unpacked there when it's a zip file, then that folder is scanned.
 */
export namespace Uploads {
  /**
   * Largest piece one request may carry. Unit is in bytes.
   */
  export const MAX_CHUNK = 64 * 1024 * 1024;
  // Room left on a drive after an upload, so the server doesn't fill it to the last byte
  const SPACE_MARGIN = 256 * 1024 * 1024;
  // Unfinished uploads nobody carried on with are deleted after this long; finished ones after a day
  const UNFINISHED_KEEP_MS = 3 * 24 * 60 * 60 * 1000;
  const FINISHED_KEEP_MS = 24 * 60 * 60 * 1000;
  const MAX_SESSIONS = 1000;
  const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
  // Things zip tools add that nobody wants in a library; left out without a mention
  const ZIP_JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;
  const STAGING_SUFFIX = ".cinemion-upload";

  /**
   * An expected failure with the HTTP status that fits it.
   */
  export class Problem extends Error {
    constructor(message: string, public readonly status: 400 | 403 | 404 | 409 | 413 | 507, public readonly upload?: UploadInfo) {
      super(message);
    }
  }

  interface Session {
    info: UploadInfo;
    userId: number;
    /**
     * A piece is being written right now.
     */
    busy: boolean;
    /**
     * Wait for `complete()` before adding it to the library, rather than doing it when the last byte arrives. Used by
     * Podium uploads, which check the file's checksum first.
     */
    manualFinish?: boolean;
    /**
     * What the caller keeps with the upload (Podium's details about the clip), saved with it.
     */
    extra?: unknown;
    /**
     * Adding it to the library, while that runs.
     */
    finishing?: Promise<void>;
  }

  const _sessions = new Map<string, Session>();
  let _reaper: ReturnType<typeof setInterval> | null = null;

  //#region Rules

  /**
   * File types a library of `type` takes from uploads, besides zip files: its media plus the files that go with it
   * (subtitles, NFO files, pictures, lyrics).
   */
  export function extensions(type: LibraryType): string[] {
    switch (type) {
      case "movies":
      case "shows":
      case "videos":
      case "clips":
        return [...NameParser.VIDEO_EXTENSIONS, ...Sidecars.SUBTITLE_EXTENSIONS, ".nfo", ...IMAGE_EXTENSIONS];
      case "music":
        return [...MusicTags.AUDIO_EXTENSIONS, ".lrc", ".cue", ...IMAGE_EXTENSIONS];
      case "audiobooks":
        return [...MusicTags.AUDIO_EXTENSIONS, ".cue", ".nfo", ".txt", ...IMAGE_EXTENSIONS];
      case "books":
        return [...BookLibrary.EBOOK_EXTENSIONS, ...IMAGE_EXTENSIONS];
      case "photos":
        return [...PhotoLibrary.IMAGE_EXTENSIONS, ...NameParser.VIDEO_EXTENSIONS];
    }
  }

  /**
   * Whether a library of `type` takes the file at `path`.
   */
  export function accepts(type: LibraryType, path: string) {
    return extensions(type).includes(Path.extname(path).toLowerCase());
  }

  /**
   * The largest file uploads take, from `UPLOAD_MAX_GB`. Unit is in bytes. `null` = no limit.
   */
  export function maxSize() {
    const gb = AppSystem.config.UPLOAD_MAX_GB;
    return gb > 0 ? Math.round(gb * 1024 ** 3) : null;
  }

  export function rules(): UploadRules {
    const types: LibraryType[] = ["movies", "shows", "videos", "music", "audiobooks", "books", "photos", "clips"];
    return { maxSize: maxSize(), maxChunk: MAX_CHUNK, extensions: Object.fromEntries(types.map((t) => [t, extensions(t)])) as Record<LibraryType, string[]> };
  }

  /**
   * What a library of `type` takes, for error messages.
   */
  function describe(type: LibraryType) {
    return ({
      movies: "video files, subtitles, NFO files and pictures",
      shows: "video files, subtitles, NFO files and pictures",
      videos: "video files, subtitles, NFO files and pictures",
      clips: "video files, subtitles, NFO files and pictures",
      music: "audio files, lyrics (.lrc) and pictures",
      audiobooks: "audio files, cue sheets, descriptions and pictures",
      books: "EPUB and PDF files and pictures",
      photos: "pictures and videos",
    } as const)[type];
  }

  /**
   * Make a path from the browser or a zip file safe to put under a library folder: `/` between folders, no `.` or
   * `..` parts, nothing hidden, no drive letters or control characters.
   * @throws When the path can't be used.
   */
  // Example: "Season 1\\Episode 1.mkv" -> "Season 1/Episode 1.mkv"; "../x.mkv" and ".hidden/x.mkv" throw
  export function cleanPath(path: string): string {
    const parts = String(path ?? "").split(/[\\/]+/).filter((p) => p !== "" && p !== ".");
    if (parts.length === 0) throw new Error("The file needs a name.");
    for (const part of parts) {
      if (part === "..") throw new Error(`"${path}" points outside the folder.`);
      if (part.startsWith(".")) throw new Error(`"${path}" is hidden (a name starts with a dot), so the library would never show it.`);
      // deno-lint-ignore no-control-regex
      if (/[\x00-\x1f\x7f]/.test(part) || /^[a-z]:$/i.test(part)) throw new Error(`"${path}" has characters a file name can't have.`);
      if (new TextEncoder().encode(part).length > 255) throw new Error(`"${part}" is too long for a file name.`);
    }
    return parts.join("/");
  }

  //#endregion

  //#region Sessions

  function dirOf(id: string) {
    return Path.join(AppSystem.uploadsDir, id);
  }

  function dataOf(id: string) {
    return Path.join(dirOf(id), "data");
  }

  async function save(session: Session) {
    session.info.updatedAt = new Date().toISOString();
    const file = Path.join(dirOf(session.info.id), "info.json");
    // Written next to it and renamed, so a crash never leaves half a file
    await fsp.writeFile(`${file}.tmp`, JSON.stringify({ ...session.info, userId: session.userId, manualFinish: session.manualFinish, extra: session.extra }));
    await fsp.rename(`${file}.tmp`, file);
  }

  async function remove(id: string) {
    _sessions.delete(id);
    await fsp.rm(dirOf(id), { recursive: true, force: true }).catch((error) => log.warn(`Could not delete the upload folder ${dirOf(id)}`, { error }));
  }

  /**
   * Load the uploads left from before a restart, carry on with the ones that were being added, and start deleting
   * old ones every hour. Call once at startup.
   */
  export async function init() {
    for (const entry of await fsp.readdir(AppSystem.uploadsDir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      try {
        const stored = JSON.parse(await fsp.readFile(Path.join(dirOf(id), "info.json"), "utf8")) as UploadInfo & { userId: number; manualFinish?: boolean; extra?: unknown };
        const { userId, manualFinish, extra, ...info } = stored;
        // The data on disk is the truth; the server may have stopped between writing a piece and saving the count
        const onDisk = (await fsp.stat(dataOf(id)).catch(() => null))?.size ?? 0;
        if (info.status === "uploading") info.received = Math.min(onDisk, info.size);
        _sessions.set(id, { info, userId, busy: false, manualFinish, extra });
      } catch {
        // No readable info: a start that never finished saving
        await fsp.rm(dirOf(id), { recursive: true, force: true }).catch(() => { });
      }
    }
    for (const session of _sessions.values()) {
      if (session.info.status === "processing") finish(session);
    }
    await reap();
    _reaper ??= setInterval(() => reap().catch(() => { }), 60 * 60 * 1000);
    Deno.unrefTimer(_reaper);
  }

  export function stop() {
    if (_reaper) clearInterval(_reaper);
    _reaper = null;
  }

  /**
   * Delete unfinished uploads nobody carried on with, and finished ones after a day.
   */
  async function reap() {
    const now = Date.now();
    for (const session of [..._sessions.values()]) {
      const age = now - Date.parse(session.info.updatedAt);
      const keep = session.info.status === "uploading" ? UNFINISHED_KEEP_MS : FINISHED_KEEP_MS;
      if (session.info.status !== "processing" && !session.busy && age > keep) await remove(session.info.id);
    }
  }

  export function list(libraryId?: number): UploadInfo[] {
    return [..._sessions.values()]
      .map((s) => s.info)
      .filter((i) => libraryId === undefined || i.libraryId === libraryId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  export function get(id: string): UploadInfo | null {
    return _sessions.get(id)?.info ?? null;
  }

  function session(id: string) {
    const found = _sessions.get(id);
    if (!found) throw new Problem("That upload doesn't exist anymore. Unfinished uploads are deleted after three days; start it again.", 404);
    return found;
  }

  //#endregion

  //#region Folders and space

  /**
   * The library's folders as real paths.
   */
  async function libraryRoots(library: Library) {
    return await Promise.all(library.paths.map((p) => fsp.realpath(p).catch(() => Path.resolve(p))));
  }

  /**
   * `folder` as a real path, after checking it's a folder inside one of the library's folders.
   */
  async function resolveFolder(library: Library, folder: string) {
    const real = await MediaRoots.resolveAllowed(String(folder ?? ""));
    const roots = await libraryRoots(library);
    if (!real || !roots.some((root) => Scanner.isInside(real, root))) {
      throw new Problem(`Pick a folder inside ${library.name}: ${library.paths.join(", ")}.`, 400);
    }
    if (!(await fsp.stat(real)).isDirectory()) throw new Problem(`"${real}" is a file, not a folder.`, 400);
    return real;
  }

  /**
   * `path`, or the closest folder above it that exists.
   */
  async function nearestExisting(path: string) {
    let current = Path.resolve(path);
    while (!(await fsp.stat(current).then(() => true).catch(() => false))) {
      const parent = Path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return current;
  }

  /**
   * Check that new files can be written at `target`: the folders on the way stay inside the library (a symlinked
   * folder could point anywhere) and the server may write there.
   */
  async function checkWritable(library: Library, target: string) {
    const existing = await nearestExisting(Path.dirname(target));
    const real = await fsp.realpath(existing).catch(() => existing);
    if (!(await libraryRoots(library)).some((root) => Scanner.isInside(real, root))) {
      throw new Problem(`"${target}" leads outside ${library.name}'s folders through a linked folder.`, 400);
    }
    const writable = await fsp.access(real, fs.constants.W_OK).then(() => true).catch(() => false);
    if (!writable) {
      // The packaged systemd service runs as the "cinemion" user, with the system mounted read-only
      const hint = AppSystem.isDocker
        ? " In Docker, mount the media folder without :ro."
        : os.userInfo().username === "cinemion" ? ` As a system service, allow it with "systemctl edit cinemion": [Service] ReadWritePaths=${real}` : "";
      throw new Problem(`Cinemion isn't allowed to write in "${real}". Give the user it runs as write access to that folder.${hint}`, 403);
    }
  }

  /**
   * Whether uploads can go into `folder` of the library, and why not, so the page can say so before anything is
   * sent.
   */
  export async function check(libraryId: number, folder: string): Promise<{ ok: boolean; message: string | null }> {
    const library = await Library.findByPk(libraryId);
    if (!library) return { ok: false, message: "That library doesn't exist." };
    try {
      const real = await resolveFolder(library, folder);
      await checkWritable(library, Path.join(real, "x"));
      return { ok: true, message: null };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  /**
   * Refuse when the drive holding `path` has less than `bytes` (plus a margin) free.
   */
  async function checkSpace(path: string, bytes: number, what: string) {
    const free = await SystemStats.freeSpace(await nearestExisting(path));
    if (free !== null && free < bytes + SPACE_MARGIN) {
      throw new Problem(`There isn't enough space for ${what}: it needs ${formatBytes(bytes)}, and the drive with "${path}" has ${formatBytes(free)} free.`, 507);
    }
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }

  function isDiskFull(error: unknown) {
    return (error as { code?: string })?.code === "ENOSPC" || /no space left/i.test(errorMessage(error));
  }

  function isCrossDevice(error: unknown) {
    return (error as { code?: string })?.code === "EXDEV" || /cross-device/i.test(errorMessage(error));
  }

  //#endregion

  //#region Receiving

  /**
   * Start an upload, or return the unfinished one for the same file so the browser carries on where it stopped.
   * @throws `Problem` when the file can't go there.
   */
  export async function start(user: User, body: Partial<StartUploadRequest>, opts?: { manualFinish?: boolean; extra?: unknown }): Promise<UploadInfo> {
    opts ??= {};
    const library = await Library.findByPk(Number(body.libraryId));
    if (!library) throw new Problem("That library doesn't exist.", 404);

    let path: string;
    try {
      path = cleanPath(String(body.path ?? ""));
    } catch (error) {
      throw new Problem(errorMessage(error), 400);
    }
    const name = Path.basename(path);
    const size = Number(body.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new Problem("The file size is missing.", 400);
    if (size === 0) throw new Problem(`"${name}" is empty.`, 400);
    const limit = maxSize();
    if (limit !== null && size > limit) {
      throw new Problem(`"${name}" is ${formatBytes(size)}, more than this server takes (${formatBytes(limit)}). The limit is UPLOAD_MAX_GB in the server's settings.`, 413);
    }
    const isZip = Path.extname(path).toLowerCase() === ".zip";
    if (!isZip && !accepts(library.type, path)) {
      throw new Problem(`${library.name} takes ${describe(library.type)}, or zip files with them. "${name}" isn't one of those.`, 400);
    }

    const folder = await resolveFolder(library, String(body.folder ?? ""));
    const target = Path.join(folder, path);
    const replace = body.replace === true;
    const lastModified = Number(body.lastModified) || 0;
    const fingerprint = String(body.fingerprint ?? "").slice(0, 128);

    // The same file again: carry on with what's there
    const existing = [..._sessions.values()].find((s) => {
      const i = s.info;
      return i.status === "uploading" && i.libraryId === library.id && i.folder === folder && i.path === path && i.size === size && i.lastModified === lastModified && i.fingerprint === fingerprint;
    });
    if (existing) {
      if (existing.info.replace !== replace) {
        existing.info.replace = replace;
        await save(existing);
      }
      return existing.info;
    }

    if (!isZip && !replace && await fsp.stat(target).then(() => true).catch(() => false)) {
      throw new Problem(`"${path}" is already in that folder. Turn on "Replace files that are already there" to overwrite it.`, 409);
    }
    await checkWritable(library, target);
    if (_sessions.size >= MAX_SESSIONS) throw new Problem("There are too many unfinished uploads. Cancel some of them first.", 409);
    await checkSpace(AppSystem.uploadsDir, size, `"${name}" while it uploads`);

    const now = new Date().toISOString();
    const info: UploadInfo = {
      id: crypto.randomUUID(),
      libraryId: library.id,
      folder,
      path,
      size,
      lastModified,
      fingerprint,
      received: 0,
      replace,
      isZip,
      status: "uploading",
      progress: null,
      message: null,
      placed: [],
      skipped: [],
      createdAt: now,
      updatedAt: now,
    };
    const created: Session = { info, userId: user.id, busy: false, manualFinish: opts.manualFinish, extra: opts.extra };
    await fsp.mkdir(dirOf(info.id), { recursive: true });
    await fsp.writeFile(dataOf(info.id), new Uint8Array(0));
    await save(created);
    _sessions.set(info.id, created);
    log.info(`Upload started: ${path} (${formatBytes(size)}) into ${folder}`, { user: user.username });
    return info;
  }

  async function writeAll(file: Deno.FsFile, data: Uint8Array) {
    let written = 0;
    while (written < data.length) written += await file.write(data.subarray(written));
  }

  /**
   * Write one piece, starting at `offset`, which must be the number of bytes the server has. Bytes are counted as
   * they're written, so a piece cut off halfway still counts for what arrived. The last piece starts moving the file
   * into the library.
   * @param declared The request's Content-Length, when it has one.
   * @throws `Problem` for a wrong offset (with the upload, so the client can carry on from the right place), a piece
   * that's too big, or a full disk.
   */
  export async function write(id: string, offset: number, declared: number | null, body: ReadableStream<Uint8Array> | null): Promise<UploadInfo> {
    const s = session(id);
    const info = s.info;
    if (info.status !== "uploading") throw new Problem("This upload is already complete.", 409, info);
    if (s.busy) throw new Problem("Another piece of this upload is still coming in. Wait for it to finish, then carry on.", 409, info);
    if (offset !== info.received) throw new Problem(`The server has ${info.received} bytes of this file; carry on from there.`, 409, info);
    if (declared !== null && declared > MAX_CHUNK) throw new Problem(`Pieces can be at most ${formatBytes(MAX_CHUNK)}.`, 413, info);
    if (declared !== null && offset + declared > info.size) throw new Problem("This piece goes past the end of the file.", 400, info);
    if (!body) throw new Problem("The piece is empty.", 400, info);

    s.busy = true;
    let pieceLength = 0;
    let file: Deno.FsFile | null = null;
    try {
      file = await Deno.open(dataOf(id), { write: true });
      await file.seek(offset, Deno.SeekMode.Start);
      try {
        for await (const chunk of body) {
          pieceLength += chunk.length;
          if (pieceLength > MAX_CHUNK) throw new Problem(`Pieces can be at most ${formatBytes(MAX_CHUNK)}.`, 413, info);
          if (info.received + chunk.length > info.size) throw new Problem("This piece goes past the end of the file.", 400, info);
          await writeAll(file, chunk);
          info.received += chunk.length;
        }
      } catch (error) {
        if (error instanceof Problem) throw error;
        if (isDiskFull(error)) throw new Problem("The server ran out of disk space while receiving this file. Free some space, then carry on.", 507, info);
        // The browser went away mid-piece; what arrived is kept and the next try starts after it
        log.debug(`Upload ${id} piece cut off after ${pieceLength} bytes`, { error: errorMessage(error) });
      }
    } finally {
      file?.close();
      // A partly written last chunk past `received` would be overwritten by the next piece anyway, but keep it tidy
      if (file) await fsp.truncate(dataOf(id), info.received).catch(() => { });
      s.busy = false;
      await save(s).catch(() => { });
    }

    if (info.received === info.size && !s.manualFinish) finish(s);
    return info;
  }

  /**
   * Where the bytes of an upload are while it's coming in.
   */
  export function dataPath(id: string) {
    return dataOf(id);
  }

  /**
   * What the caller kept with an upload, and the user who started it. `null` for an unknown upload.
   */
  export function extraOf(id: string) {
    const s = _sessions.get(id);
    return s ? { extra: s.extra, userId: s.userId } : null;
  }

  /**
   * Change what the caller keeps with an upload.
   */
  export async function setExtra(id: string, extra: unknown) {
    const s = session(id);
    s.extra = extra;
    await save(s);
  }

  /**
   * Add a complete upload that waits for this (see `start()`'s `manualFinish`) to its library, and wait until it's
   * there. Calling it again while that runs, or after, waits for the same.
   * @throws `Problem` while bytes are missing, or when it couldn't be added (with the reason).
   */
  export async function complete(id: string): Promise<UploadInfo> {
    const s = session(id);
    const info = s.info;
    if (info.status === "uploading") {
      if (info.received < info.size) throw new Problem(`Only ${info.received} of ${info.size} bytes have arrived.`, 409, info);
      finish(s);
    }
    else if (info.status === "failed") throw new Problem(info.message ?? "The file couldn't be added to the library.", 409, info);
    await s.finishing;
    if (s.info.status === "failed") throw new Problem(s.info.message ?? "The file couldn't be added to the library.", 409, s.info);
    return s.info;
  }

  /**
   * Stop an upload and delete what was received.
   * @throws `Problem` while it's being moved into the library.
   */
  export async function cancel(id: string) {
    const s = session(id);
    if (s.info.status === "processing") throw new Problem("It's being added to the library right now and can't be stopped.", 409, s.info);
    await remove(id);
  }

  /**
   * Try adding a complete upload that failed again, optionally replacing files that are already there.
   */
  export async function retry(id: string, replace?: boolean): Promise<UploadInfo> {
    const s = session(id);
    if (s.info.status !== "failed") throw new Problem("Only uploads that failed can be tried again.", 409, s.info);
    if (!(await fsp.stat(dataOf(id)).then(() => true).catch(() => false))) {
      throw new Problem("The uploaded file isn't on the server anymore. Upload it again.", 409, s.info);
    }
    if (replace !== undefined) s.info.replace = replace;
    s.info.skipped = [];
    finish(s);
    return s.info;
  }

  //#endregion

  //#region Adding to the library

  /**
   * Move or unpack a complete upload into its library, in the `uploads` task queue, then scan where it went.
   */
  function finish(s: Session) {
    const info = s.info;
    info.status = "processing";
    info.progress = 0;
    info.message = "Waiting to be added";
    save(s).catch(() => { });
    s.finishing = Tasks.run(`upload:${info.id}`, `Adding ${Path.basename(info.path)}`, { libraryId: info.libraryId, queue: "uploads" }, async (task) => {
      const update = (message: string, progress: number) => {
        info.message = message;
        info.progress = progress;
        task.update(message, progress);
      };
      try {
        const library = await Library.findByPk(info.libraryId);
        if (!library) throw new Error("The library was removed while this was uploading.");
        await fsp.stat(info.folder).catch(() => {
          throw new Error(`The folder "${info.folder}" isn't there anymore.`);
        });
        if (info.isZip) await unpack(s, library, update);
        else await place(s, library, update);

        await fsp.rm(dataOf(info.id), { force: true });
        info.status = "done";
        info.progress = 1;
        info.message = info.isZip
          ? `Added ${info.placed.length} ${info.placed.length === 1 ? "file" : "files"}${info.skipped.length ? `, left out ${info.skipped.length}` : ""}`
          : "Added";
        await save(s);
        log.info(`Upload added to ${library.name}: ${info.path}`, { files: info.placed.length, skipped: info.skipped.length });
        rescan(library, info);
        report(s, library);
      } catch (error) {
        info.status = "failed";
        info.progress = null;
        info.message = isDiskFull(error) ? "The library's drive ran out of space. Free some space, then try again." : errorMessage(error);
        await save(s).catch(() => { });
        log.warn(`Upload ${info.path} could not be added`, { error: info.message });
      }
    }).catch(() => { }).finally(() => s.finishing = undefined);
  }

  /**
   * Copy `from` to a hidden file next to `target`, then rename it into place, so scans never see half a file.
   */
  async function copyInto(source: ReadableStream<Uint8Array>, target: string, onProgress: (bytes: number) => void) {
    const staging = Path.join(Path.dirname(target), `.${Path.basename(target)}${STAGING_SUFFIX}`);
    const file = await Deno.open(staging, { write: true, create: true, truncate: true });
    let copied = 0;
    try {
      for await (const chunk of source) {
        await writeAll(file, chunk);
        copied += chunk.length;
        onProgress(copied);
      }
      file.close();
      await fsp.rename(staging, target);
    } catch (error) {
      try {
        file.close();
      } catch {
        // Closed already
      }
      await fsp.rm(staging, { force: true }).catch(() => { });
      throw error;
    }
  }

  /**
   * A single file: renamed into place when the upload folder is on the same drive, copied otherwise.
   */
  async function place(s: Session, library: Library, update: (message: string, progress: number) => void) {
    const info = s.info;
    const target = Path.join(info.folder, info.path);
    await checkWritable(library, target);
    await fsp.mkdir(Path.dirname(target), { recursive: true });
    if (!info.replace && await fsp.stat(target).then(() => true).catch(() => false)) {
      throw new Error(`"${info.path}" is already in that folder. Try again with "Replace files that are already there" on.`);
    }
    update("Moving into the library", 0);
    try {
      await fsp.rename(dataOf(info.id), target);
    } catch (error) {
      if (!isCrossDevice(error)) throw error;
      await checkSpace(Path.dirname(target), info.size, `"${Path.basename(target)}"`);
      const source = await Deno.open(dataOf(info.id), { read: true });
      await copyInto(source.readable, target, (bytes) => update("Copying into the library", bytes / info.size));
    }
    info.placed = [info.path];
  }

  /**
   * A zip file: every file this library takes is unpacked under the folder, keeping the folders inside the zip.
   * Files that are already there are skipped unless `replace` is on; a damaged file is skipped and the rest go on.
   */
  async function unpack(s: Session, library: Library, update: (message: string, progress: number) => void) {
    const info = s.info;
    update("Reading the zip file", 0);
    const zip = await ZipReader.open(dataOf(info.id));
    try {
      const planned: { entry: ZipReader.Entry; path: string; target: string }[] = [];
      for (const entry of zip.entries) {
        if (entry.isDirectory || ZIP_JUNK.test(entry.name)) continue;
        let path: string;
        try {
          path = cleanPath(entry.name);
        } catch (error) {
          info.skipped.push({ path: entry.name, reason: errorMessage(error) });
          continue;
        }
        // Already put in place before a restart interrupted this
        if (info.placed.includes(path)) continue;
        if (!accepts(library.type, path)) {
          info.skipped.push({ path, reason: "Not a file this library uses" });
          continue;
        }
        if (entry.isEncrypted) {
          info.skipped.push({ path, reason: "Password-protected" });
          continue;
        }
        if (!ZipReader.isSupported(entry)) {
          info.skipped.push({ path, reason: "Packed in a way Cinemion can't unpack; zip it again with normal compression" });
          continue;
        }
        const target = Path.join(info.folder, path);
        if (!info.replace && await fsp.stat(target).then(() => true).catch(() => false)) {
          info.skipped.push({ path, reason: "Already in the folder" });
          continue;
        }
        planned.push({ entry, path, target });
      }

      if (planned.length === 0) {
        if (info.placed.length > 0) return;
        const reasons = [...new Set(info.skipped.map((x) => x.reason))];
        throw new Error(reasons.length === 1 && reasons[0] === "Already in the folder"
          ? "Everything in the zip file is already in that folder. Try again with \"Replace files that are already there\" on."
          : `Nothing in the zip file is something ${library.name} uses (${describe(library.type)}).`);
      }

      const total = planned.reduce((sum, p) => sum + p.entry.size, 0);
      await checkSpace(info.folder, total, "the unpacked files");
      let done = 0;
      for (const { entry, path, target } of planned) {
        await checkWritable(library, target);
        await fsp.mkdir(Path.dirname(target), { recursive: true });
        const name = Path.basename(path);
        update(`Unpacking ${name}`, total ? done / total : 0);
        try {
          let lastReport = 0;
          await copyInto(await zip.stream(entry), target, (bytes) => {
            // A progress update per megabyte or so is plenty
            if (bytes - lastReport < 1024 * 1024) return;
            lastReport = bytes;
            update(`Unpacking ${name}`, total ? (done + bytes) / total : 0);
          });
          info.placed.push(path);
          await save(s);
        } catch (error) {
          if (isDiskFull(error)) throw error;
          info.skipped.push({ path, reason: errorMessage(error) });
        }
        done += entry.size;
      }
      if (info.placed.length === 0) throw new Error(`None of the files could be unpacked. ${info.skipped[0]?.reason ?? ""}`.trim());
    } finally {
      zip.close();
    }
  }

  /**
   * Scan the folders the files went into. Many folders at once (a whole series) scan the upload's folder instead.
   */
  function rescan(library: Library, info: UploadInfo) {
    const folders = [...new Set(info.placed.map((p) => Path.dirname(Path.join(info.folder, p))))];
    Scanner.queueFolders(library.id, folders.length > 20 ? [info.folder] : folders);
  }

  async function report(s: Session, library: Library) {
    const user = await User.findByPk(s.userId).catch(() => null);
    const count = s.info.placed.length;
    const name = user?.name ?? "?";
    const file = Path.basename(s.info.placed[0] ?? "");
    const message = count === 1 ? `${name} uploaded "${file}" to ${library.name}` : `${name} uploaded ${count} files to ${library.name}`;
    Events.activity({ kind: "upload", message, userId: user?.id ?? null });
  }

  //#endregion
}

export default Uploads;
