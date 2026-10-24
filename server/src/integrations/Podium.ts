import fsp from "node:fs/promises";
import Path from "node:path";
import { createHash } from "node:crypto";
import { encodeHex } from "@std/encoding/hex";
import type { PodiumTargetInfo } from "@shared/admin.ts";
import { Library, MediaFile, MediaItem, Setting, User } from "../models/index.ts";
import Uploads from "../library/Uploads.ts";
import Scanner from "../library/Scanner.ts";
import ClipNames from "../clips/ClipNames.ts";
import ClipLibrary from "../clips/ClipLibrary.ts";
import { errorMessage } from "../lib/http.ts";
import log from "../lib/Logger.ts";

/**
 * Podium's upload protocol (version 1): Podium, a clip recorder, uploads clips to "Podium-compatible" servers. Each
 * target is a library (and a folder in it) with its own token, so one Cinemion can be several targets. The bytes go
 * through `Uploads`, so they're written to disk as they come and survive restarts; once Podium says it's done, the
 * checksum is checked, the file moves into the library, the folder is scanned, and what Podium knows about the clip
 * (its game, when it was recorded, its title and sound tracks) is applied.
 */
export namespace Podium {
  export const VERSIONS = [1];
  /**
   * Piece size for Podium. 8 MB fits through most reverse proxies' body limits with a small change, and loses little
   * when a piece fails.
   */
  export const CHUNK_SIZE = 8 * 1024 * 1024;
  // Uploads nobody carries on with are deleted after three days (see Uploads)
  const UNFINISHED_KEEP_MS = 3 * 24 * 60 * 60 * 1000;
  // Podium waits about a minute for "complete"; answer before that, even when the scan takes longer
  const COMPLETE_WAIT_MS = 40_000;
  const LAST_USED_EVERY_MS = 60_000;

  // Media types Podium may send, and the file extension that goes with each
  const TYPES: Record<string, string> = {
    "video/mp4": ".mp4",
    "video/x-matroska": ".mkv",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "video/x-m4v": ".m4v",
    "video/x-msvideo": ".avi",
    "video/mp2t": ".ts",
    "video/x-flv": ".flv",
    "video/x-ms-wmv": ".wmv",
    "video/mpeg": ".mpg",
    "audio/mpeg": ".mp3",
    "audio/flac": ".flac",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "audio/x-m4b": ".m4b",
    "audio/wav": ".wav",
    "audio/opus": ".opus",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "application/epub+zip": ".epub",
    "application/pdf": ".pdf",
  };

  /**
   * An expected failure, with Podium's error code.
   */
  export class Problem extends Error {
    constructor(public readonly status: number, public readonly code: string, message: string, public readonly extra: Record<string, unknown> = {}) {
      super(message);
    }
  }

  interface StoredTarget {
    id: string;
    name: string;
    token: string;
    libraryId: number;
    folder: string;
    gameFolders: boolean;
    userId: number;
    createdAt: string;
    lastUsedAt: string | null;
  }

  /**
   * What Podium said about the clip. Every field is optional, and anything else in it is ignored.
   */
  export interface ClipDetails {
    id?: unknown;
    title?: unknown;
    game?: unknown;
    recordedAt?: unknown;
    audioTracks?: unknown;
  }

  /**
   * What's kept with a Podium upload in `Uploads`.
   */
  interface UploadExtra {
    podium: {
      targetId: string;
      sha256: string;
      clip: ClipDetails;
      verified?: boolean;
      result?: CompleteResult;
    };
  }

  export interface CompleteResult {
    clip: { id: string; url?: string; thumbnailUrl?: string };
  }

  export interface Caller {
    target: StoredTarget;
    user: User;
    library: Library;
  }

  //#region Targets

  async function stored(): Promise<StoredTarget[]> {
    return (await Setting.get<{ targets?: StoredTarget[] }>(Setting.Keys.PODIUM, {})).targets ?? [];
  }

  async function save(targets: StoredTarget[]) {
    await Setting.set(Setting.Keys.PODIUM, { targets });
  }

  /**
   * A folder inside a library as targets store it: relative, with `/`, nothing that leads out.
   * @throws When it can't be used.
   */
  function cleanFolder(folder: unknown) {
    const text = String(folder ?? "").trim();
    return text ? Uploads.cleanPath(text) : "";
  }

  /**
   * Make a target that uploads into `libraryId` as `user`.
   * @throws With a readable message when a value doesn't work.
   */
  export async function createTarget(user: User, body: { name?: unknown; libraryId?: unknown; folder?: unknown; gameFolders?: unknown }) {
    const library = await Library.findByPk(Number(body.libraryId));
    if (!library) throw new Error("Pick the library Podium uploads to.");
    const name = String(body.name ?? "").trim().slice(0, 60) || library.name;
    const target: StoredTarget = {
      id: encodeHex(crypto.getRandomValues(new Uint8Array(4))),
      name,
      token: encodeHex(crypto.getRandomValues(new Uint8Array(24))),
      libraryId: library.id,
      folder: cleanFolder(body.folder),
      gameFolders: body.gameFolders !== false,
      userId: user.id,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    await save([...await stored(), target]);
    return target;
  }

  /**
   * @returns `false` when there was no such target.
   */
  export async function removeTarget(id: string) {
    const targets = await stored();
    const remaining = targets.filter((t) => t.id !== id);
    if (remaining.length === targets.length) return false;
    await save(remaining);
    return true;
  }

  /**
   * Every target, as Settings › Integrations shows them.
   */
  export async function targetsForClient(): Promise<PodiumTargetInfo[]> {
    const targets = await stored();
    const users = await User.findAll({ where: { id: [...new Set(targets.map((t) => t.userId))] } });
    const libraries = await Library.findAll({ where: { id: [...new Set(targets.map((t) => t.libraryId))] } });
    return targets.map((t) => ({
      id: t.id,
      name: t.name,
      token: t.token,
      libraryId: t.libraryId,
      libraryName: libraries.find((l) => l.id === t.libraryId)?.name ?? null,
      folder: t.folder,
      gameFolders: t.gameFolders,
      createdBy: users.find((u) => u.id === t.userId)?.name ?? null,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
    }));
  }

  /**
   * The target, profile and library behind a token.
   * @throws `Problem` 401 for an unknown token, 403 when its profile may no longer add to libraries or the library is
   * gone.
   */
  export async function authenticate(token: string | null): Promise<Caller> {
    const targets = await stored();
    const target = token ? targets.find((t) => t.token === token) : undefined;
    if (!target) throw new Problem(401, "unauthorized", "The access token is missing or wrong. Copy it again from Cinemion's Settings › Integrations.");
    const user = await User.findByPk(target.userId);
    if (!user || !(await user.hasPermission("LIBRARY_MANAGE"))) {
      throw new Problem(403, "forbidden", "The profile that made this upload target can't add to libraries anymore. Make a new target in Cinemion's Settings › Integrations.");
    }
    const library = await Library.findByPk(target.libraryId);
    if (!library) throw new Problem(403, "forbidden", "The library this target uploads to was removed. Make a new target in Cinemion's Settings › Integrations.");
    if (!target.lastUsedAt || Date.now() - Date.parse(target.lastUsedAt) > LAST_USED_EVERY_MS) {
      target.lastUsedAt = new Date().toISOString();
      await save(targets).catch(() => { });
    }
    return { target, user, library };
  }
  //#endregion

  //#region Uploading

  /**
   * The media types a library takes, for `GET /server`: its media, not the pictures and subtitles that go with it.
   */
  export function acceptedTypes(library: Library) {
    const extensions = Uploads.extensions(library.type);
    const kinds = library.type === "photos" ? ["image/", "video/"] : library.type === "music" || library.type === "audiobooks" ? ["audio/"] : library.type === "books" ? ["application/"] : ["video/"];
    return Object.entries(TYPES).filter(([type, ext]) => extensions.includes(ext) && kinds.some((k) => type.startsWith(k))).map(([type]) => type);
  }

  /**
   * A name for the file on disk, from what Podium calls it: no folders or characters file systems choke on, and the
   * extension its type has when it's missing.
   * @throws `Problem` 415 when the library doesn't take this kind of file.
   */
  function fileNameFor(library: Library, fileName: unknown, contentType: string) {
    let name = String(fileName ?? "").split(/[\\/]/).pop() ?? "";
    // deno-lint-ignore no-control-regex
    name = name.replace(/[\x00-\x1f\x7f<>:"|?*]+/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+/, "").trim();
    if (!name) name = `Upload ${new Date().toISOString().slice(0, 19).replace("T", " ").replace(/:/g, "-")}`;
    if (!Uploads.accepts(library.type, name)) {
      const ext = TYPES[contentType];
      if (!ext || !Uploads.accepts(library.type, `x${ext}`)) throw new Problem(415, "unsupported_type", `${library.name} doesn't take ${contentType || "this kind of"} files.`);
      name += ext;
    }
    // Room for " (2)" and still under the usual 255-byte limit
    while (new TextEncoder().encode(name).length > 240) name = name.slice(0, Path.parse(name).name.length - 1) + Path.extname(name);
    return name;
  }

  /**
   * The game Podium named, as `{ name, steamAppId }`. `null` when it didn't name one.
   */
  function gameOf(clip: ClipDetails) {
    const game = clip.game as { id?: unknown; name?: unknown } | null | undefined;
    if (!game || typeof game !== "object") return null;
    const name = typeof game.name === "string" ? game.name.trim() : "";
    // Example: steam:1172470
    const steamAppId = typeof game.id === "string" ? game.id.match(/^steam:(\d{1,10})$/)?.[1] ?? null : null;
    return name || steamAppId ? { name, steamAppId } : null;
  }

  /**
   * A path for the new file that isn't taken yet: "Clip (2).mp4" when "Clip.mp4" is there.
   */
  async function freePath(root: string, folder: string, name: string) {
    const { name: base, ext } = Path.parse(name);
    for (let n = 1; n < 1000; n++) {
      const candidate = Path.join(folder, `${base}${n === 1 ? "" : ` (${n})`}${ext}`);
      if (!await fsp.stat(Path.join(root, candidate)).then(() => true).catch(() => false)) return candidate;
    }
    throw new Problem(409, "invalid_request", `There are too many files called "${name}" already.`);
  }

  function uploadProblem(error: unknown): never {
    if (error instanceof Problem) throw error;
    if (error instanceof Uploads.Problem) {
      const codes: Record<number, string> = { 400: "invalid_request", 403: "forbidden", 404: "not_found", 409: "invalid_request", 413: "too_large", 507: "quota_exceeded" };
      throw new Problem(error.status, codes[error.status] ?? "invalid_request", error.message);
    }
    throw error;
  }

  function sessionResponse(id: string, offset: number, updatedAt: string) {
    return { id, chunkSize: CHUNK_SIZE, offset, expiresAt: new Date(Date.parse(updatedAt) + UNFINISHED_KEEP_MS).toISOString() };
  }

  /**
   * `POST /uploads`: open an upload, carry on with an unfinished one of the same file, or answer with the clip when
   * the library already has the file.
   * @param origin Where links to the server start, like `https://media.example.com`.
   * @throws `Problem` when the file can't be taken.
   */
  export async function start(caller: Caller, body: Record<string, unknown>, origin: string): Promise<{ status: 200 | 201; body: unknown }> {
    const { target, user, library } = caller;
    const size = body.size;
    const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
    const contentType = typeof body.contentType === "string" ? body.contentType.toLowerCase().split(";")[0].trim() : "";
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1) throw new Problem(400, "invalid_request", "`size` must be a positive whole number of bytes.");
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Problem(400, "invalid_request", "`sha256` must be 64 hex characters.");
    const clip: ClipDetails = body.clip && typeof body.clip === "object" && !Array.isArray(body.clip) ? body.clip as ClipDetails : {};
    const limit = Uploads.maxSize();
    if (limit !== null && size > limit) throw new Problem(413, "too_large", `Files can be at most ${Math.floor(limit / 1024 ** 2)} MB on this server. The limit is UPLOAD_MAX_GB in Cinemion's settings.`);

    const name = fileNameFor(library, body.fileName, contentType);

    // A file the library already has from an earlier upload
    const known = await MediaFile.findOne({ where: { sha256, libraryId: library.id } });
    const knownItem = known?.itemId ? await MediaItem.findByPk(known.itemId) : null;
    if (knownItem) return { status: 200, body: resultFor(knownItem, origin) };

    // The same file again from this target, before it was finished: carry on
    for (const info of Uploads.list(library.id)) {
      const extra = Uploads.extraOf(info.id)?.extra as UploadExtra | undefined;
      if (info.status === "uploading" && extra?.podium?.targetId === target.id && extra.podium.sha256 === sha256 && info.size === size) {
        return { status: 201, body: sessionResponse(info.id, info.received, info.updatedAt) };
      }
    }

    const root = library.paths[0];
    const game = gameOf(clip);
    const gameFolder = library.type === "clips" && target.gameFolders && game?.name ? fileNameFor(library, `${ClipNames.cleanGameName(game.name)}.mp4`, "").replace(/\.mp4$/, "") : "";
    const folder = [target.folder, gameFolder].filter(Boolean).join("/");
    const path = await freePath(root, folder, name);
    const extra: UploadExtra = { podium: { targetId: target.id, sha256, clip } };
    try {
      await fsp.mkdir(root, { recursive: true });
      const info = await Uploads.start(user, { libraryId: library.id, folder: root, path, size, lastModified: 0, fingerprint: sha256 }, { manualFinish: true, extra });
      log.info(`Podium upload started into ${library.name}: ${path}`, { target: target.name });
      return { status: 201, body: sessionResponse(info.id, info.received, info.updatedAt) };
    } catch (error) {
      uploadProblem(error);
    }
  }

  /**
   * The upload with `id`, when it's this target's.
   * @throws `Problem` 404 otherwise.
   */
  export function upload(caller: Caller, id: string) {
    const info = Uploads.get(id);
    const extra = Uploads.extraOf(id)?.extra as UploadExtra | undefined;
    if (!info || extra?.podium?.targetId !== caller.target.id) throw new Problem(404, "not_found", "This upload doesn't exist or has expired. Start it again.");
    return { info, extra };
  }

  /**
   * `PUT /uploads/{id}`: write one piece.
   * @param range From `Content-Range`: the first and last byte, and the file's size.
   */
  export async function receive(caller: Caller, id: string, range: { first: number; last: number; size: number }, body: ReadableStream<Uint8Array> | null) {
    const { info } = upload(caller, id);
    const length = range.last - range.first + 1;
    if (range.size !== info.size || range.last < range.first || range.last >= info.size) throw new Problem(400, "invalid_request", "The Content-Range doesn't fit this upload.");
    if (length > CHUNK_SIZE) throw new Problem(400, "invalid_request", `Pieces can be at most ${CHUNK_SIZE} bytes.`);
    if (info.status !== "uploading") throw new Problem(409, "offset_mismatch", "Every byte of this upload has arrived already.", { offset: info.received });
    if (range.first !== info.received) throw new Problem(409, "offset_mismatch", `Expected the piece at byte ${info.received}.`, { offset: info.received });
    let after;
    try {
      after = await Uploads.write(id, range.first, length, body);
    } catch (error) {
      if (error instanceof Uploads.Problem && error.status === 409) throw new Problem(409, "offset_mismatch", error.message, { offset: error.upload?.received ?? info.received });
      uploadProblem(error);
    }
    // A piece shorter than its Content-Range said is kept as far as it got; the client carries on from there
    if (after.received !== range.first + length) throw new Problem(400, "invalid_request", `Expected ${length} bytes, got ${after.received - range.first}.`, { offset: after.received });
    return { offset: after.received };
  }

  /**
   * SHA-256 of a file, read a piece at a time so big files never sit in memory.
   */
  async function hashFile(path: string) {
    const hash = createHash("sha256");
    const file = await Deno.open(path, { read: true });
    for await (const chunk of file.readable) hash.update(chunk);
    return hash.digest("hex");
  }

  /**
   * Where the clip can be seen, as Podium wants it.
   */
  function resultFor(item: MediaItem, origin: string): CompleteResult {
    const thumb = item.artwork.thumb ?? item.artwork.backdrop;
    return {
      clip: {
        id: String(item.id),
        url: `${origin}/item/${item.id}`,
        ...(thumb ? { thumbnailUrl: `${origin}/api/images/${thumb}?w=780` } : {}),
      },
    };
  }

  /**
   * `POST /uploads/{id}/complete`: check the checksum, move the file into the library, scan it and apply what Podium
   * knows about it. Answers within about 40 seconds even when the scan takes longer, with a link to the library; the
   * rest carries on.
   * @throws `Problem` for missing bytes, a wrong checksum, or a file the library couldn't take.
   */
  export async function complete(caller: Caller, id: string, origin: string): Promise<CompleteResult> {
    const { info, extra } = upload(caller, id);
    const podium = extra.podium;
    if (podium.result) return podium.result;
    if (info.status === "uploading" && info.received < info.size) {
      throw new Problem(409, "incomplete", `Only ${info.received} of ${info.size} bytes have arrived.`, { offset: info.received });
    }
    if (!podium.verified && info.status === "uploading") {
      if (await hashFile(Uploads.dataPath(id)) !== podium.sha256) {
        await Uploads.cancel(id).catch(() => { });
        throw new Problem(422, "checksum_mismatch", "The uploaded bytes don't match the checksum. Upload the clip again.");
      }
      podium.verified = true;
      await Uploads.setExtra(id, extra);
    }

    let placed;
    try {
      placed = await Uploads.complete(id);
    } catch (error) {
      throw new Problem(409, "cinemion_add_failed", `The file arrived but couldn't be added to ${caller.library.name}: ${errorMessage(error)}`);
    }

    const path = Path.join(placed.folder, placed.path);
    const adding = addToLibrary(caller.library, path, podium).then(async (item) => {
      const result = item ? resultFor(item, origin) : null;
      // A late finish still gives later "complete" calls the clip's own link
      if (result && Uploads.get(id)) await Uploads.setExtra(id, { podium: { ...podium, result } } satisfies UploadExtra).catch(() => { });
      return result;
    });
    const result = await Promise.race([adding, new Promise<null>((resolve) => setTimeout(() => resolve(null), COMPLETE_WAIT_MS))]);
    const answer: CompleteResult = result ?? { clip: { id: placed.id, url: `${origin}/library/${caller.library.id}` } };
    if (!result) await Uploads.setExtra(id, { podium: { ...podium, result: answer } } satisfies UploadExtra).catch(() => { });
    return answer;
  }

  /**
   * Scan the new file into the library, remember its checksum, and apply what Podium said about it.
   * @returns The clip (or video, or whatever the library made of it), or `null` when the scan didn't pick it up.
   */
  async function addToLibrary(library: Library, path: string, podium: UploadExtra["podium"]) {
    try {
      await Scanner.scanFoldersNow(library, [Path.dirname(path)]);
      const file = await MediaFile.findOne({ where: { path } });
      const item = file?.itemId ? await MediaItem.findByPk(file.itemId) : null;
      if (!file || !item) return null;
      await file.update({ sha256: podium.sha256 });
      await applyDetails(library, item, file, podium.clip);
      await item.reload();
      return item;
    } catch (error) {
      log.warn(`Could not add the Podium upload ${path} to ${library.name}`, { error });
      return null;
    }
  }

  /**
   * `YYYY-MM-DDTHH:MM:SS` on this server's clock, from an ISO time.
   */
  function localDateTime(iso: unknown) {
    const date = typeof iso === "string" ? new Date(iso) : null;
    if (!date || isNaN(date.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  /**
   * Use what Podium knows: the names of the sound tracks, and for clips the game, when it was recorded and the
   * title someone gave it. Videos get their title and date too.
   */
  async function applyDetails(library: Library, item: MediaItem, file: MediaFile, clip: ClipDetails) {
    // Podium keeps desktop sound and the microphone apart; their names help pick one in a small copy
    if (Array.isArray(clip.audioTracks)) {
      const labels = clip.audioTracks.map((t) => typeof t === "string" ? t.trim().slice(0, 100) : "");
      const audio = file.audio.map((track, i) => track.title || !labels[i] ? track : { ...track, title: labels[i] });
      if (JSON.stringify(audio) !== JSON.stringify(file.audio)) await file.update({ audio });
    }
    if (item.type !== "video") return;

    const recordedAt = localDateTime(clip.recordedAt);
    const title = typeof clip.title === "string" ? clip.title.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    // A title that's only the game and a date (like the file name) isn't one someone gave it
    const ownTitle = title && !ClipNames.parse(`/upload/${title}.mp4`, "/upload").recordedAt ? title : null;

    if (library.type === "clips") {
      const game = gameOf(clip);
      if (game) await ClipLibrary.setGameFromUpload(library, item, game.name, game.steamAppId);
      await item.reload();
      // The time in the file name is on the recording computer's clock, which is what clips show; Podium's time is
      // only used when the name has none
      const parsed = ClipNames.parse(file.path, library.paths.find((p) => Scanner.isInside(file.path, p)) ?? library.paths[0]);
      if (recordedAt && (!parsed.recordedAt || parsed.dateOnly) && !item.editedAt) {
        item.takenAt = recordedAt;
        item.releaseDate = recordedAt.slice(0, 10);
        item.year = parseInt(recordedAt.slice(0, 4));
      }
      if (ownTitle && ownTitle !== item.clip?.hint) {
        item.setTitle(ownTitle);
        item.clip = { hint: null, steamAppId: null, found: null, suggestion: null, ...item.clip, titled: true };
      }
      else if (!item.clip?.titled && item.takenAt) item.setTitle(ClipNames.formatRecorded(item.takenAt));
      await item.save();
      return;
    }

    if (library.type === "videos" || library.type === "photos") {
      if (ownTitle) item.setTitle(ownTitle);
      if (recordedAt) {
        item.releaseDate = recordedAt.slice(0, 10);
        item.year = parseInt(recordedAt.slice(0, 4));
        if (library.type === "photos") item.takenAt = recordedAt;
      }
      // Kept through refreshes, like details typed in by hand
      if (ownTitle || recordedAt) item.editedAt = new Date();
      await item.save();
    }
  }

  /**
   * `DELETE /uploads/{id}`: stop an upload and delete what arrived. Unknown uploads are fine; they're gone either way.
   */
  export async function cancel(caller: Caller, id: string) {
    try {
      const { info } = upload(caller, id);
      if (info.status === "uploading") await Uploads.cancel(id);
    } catch {
      // Already gone
    }
  }
  //#endregion
}

export default Podium;
