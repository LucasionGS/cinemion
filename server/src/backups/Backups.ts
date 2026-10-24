import fsp from "node:fs/promises";
import Path from "node:path";
import type { BackupInfo, BackupKind, BackupSettings, BackupSettingsUpdate, BackupsOverview, RestoreStatus } from "@shared/admin.ts";
import AppSystem from "../AppSystem.ts";
import sequelize, { Activity, Setting } from "../models/index.ts";
import { QueryTypes } from "sequelize";
import DatabaseDump from "./DatabaseDump.ts";
import Tar from "../lib/Tar.ts";
import Encryption from "../lib/Encryption.ts";
import Tasks from "../lib/Tasks.ts";
import SystemStats from "../lib/SystemStats.ts";
import { errorMessage } from "../lib/http.ts";
import log from "../lib/Logger.ts";

/**
 * Backups of everything that can't be made again: the database (profiles, watch history, settings, playlists, albums,
 * hand-made details), the sign-in key, profile pictures and artwork. The cache (conversions, seek thumbnails, copies)
 * is left out; it fills itself again.
 *
 * A backup is a `.tar.gz` holding `manifest.json`, `db/<table>.jsonl` and `files/…`; with a password it's encrypted
 * as a whole and ends in `.enc`.
 */
export namespace Backups {
  /**
   * Bumped when the layout of a backup changes in a way older Cinemions can't read.
   */
  export const FORMAT = 1;
  const PREFIX = "cinemion-backup-";
  // Example: cinemion-backup-20261025-031500-scheduled.tar.gz.enc
  const NAME_PATTERN = /^cinemion-backup-(\d{8}-\d{6})-(manual|scheduled|update)\.tar\.gz(\.enc)?$/;
  /**
   * Backups made before updates are only for going back, so a few are enough.
   */
  const KEEP_BEFORE_UPDATE = 3;
  const SCHEDULE_TIMER_MS = 60 * 60 * 1000;
  const SCHEDULE_HOURS: Record<Exclude<BackupSettings["schedule"], "off">, number> = { daily: 24, weekly: 24 * 7 };

  export interface Manifest {
    format: number;
    app: "Cinemion";
    version: string;
    createdAt: string;
    kind: BackupKind;
    serverName: string;
    dialect: string;
    migrations: string[];
    tables: DatabaseDump.TableInfo[];
    /**
     * Whether all artwork is in it, or only what was made by hand.
     */
    artwork: "all" | "handMade";
  }

  /**
   * A password-protected backup was opened without one.
   */
  export class PasswordNeeded extends Error {
    constructor() {
      super("This backup is protected with a password. Enter it to restore the backup.");
    }
  }

  interface Stored {
    schedule: BackupSettings["schedule"];
    folder: string | null;
    keep: number;
    artwork: boolean;
    password: string | null;
    lastScheduledAt: string | null;
    lastError: string | null;
  }

  const DEFAULTS: Stored = { schedule: "off", folder: null, keep: 7, artwork: true, password: null, lastScheduledAt: null, lastError: null };

  let _firstTimer: ReturnType<typeof setTimeout> | null = null;
  let _timer: ReturnType<typeof setInterval> | null = null;
  let _restore: RestoreStatus = { state: "idle", step: null, progress: null, error: null, backup: null };

  async function stored(): Promise<Stored> {
    return { ...DEFAULTS, ...await Setting.get<Partial<Stored>>(Setting.Keys.BACKUPS, {}) };
  }

  async function store(changes: Partial<Stored>) {
    await Setting.set(Setting.Keys.BACKUPS, { ...await stored(), ...changes });
  }

  //#region Settings

  export async function settings(): Promise<BackupSettings> {
    const state = await stored();
    return { schedule: state.schedule, folder: state.folder, keep: state.keep, artwork: state.artwork, hasPassword: !!state.password };
  }

  /**
   * Where backups go now.
   */
  export async function folder() {
    return (await stored()).folder ?? AppSystem.backupsDir;
  }

  /**
   * Change the backup settings. A new folder must be one Cinemion can write to.
   * @throws When a value isn't allowed, with a sentence saying why.
   */
  export async function updateSettings(changes: BackupSettingsUpdate) {
    const next: Partial<Stored> = {};
    if (changes.schedule !== undefined) {
      if (!["off", "daily", "weekly"].includes(changes.schedule)) throw new Error("The schedule must be off, daily or weekly.");
      next.schedule = changes.schedule;
    }
    if (changes.keep !== undefined) {
      if (!Number.isInteger(changes.keep) || changes.keep < 1 || changes.keep > 100) throw new Error("Keep between 1 and 100 backups.");
      next.keep = changes.keep;
    }
    if (changes.artwork !== undefined) next.artwork = !!changes.artwork;
    if (changes.password !== undefined) {
      if (changes.password !== null && changes.password.length < 8) throw new Error("Use a password of at least 8 characters.");
      next.password = changes.password;
    }
    if (changes.folder !== undefined) {
      const folder = changes.folder?.trim() || null;
      if (folder !== null) {
        if (!Path.isAbsolute(folder)) throw new Error("Give the folder as a full path, like /backups or D:\\Backups.");
        await checkWritable(folder);
      }
      next.folder = folder === null ? null : Path.resolve(folder);
    }
    await store(next);
  }

  async function checkWritable(folder: string) {
    try {
      await fsp.mkdir(folder, { recursive: true });
      const probe = Path.join(folder, `.cinemion-write-check-${crypto.randomUUID()}`);
      await fsp.writeFile(probe, "");
      await fsp.rm(probe);
    } catch {
      throw new Error(`Cinemion can't write to ${folder}. Pick another folder, or give the user Cinemion runs as access to it.`);
    }
  }

  //#endregion

  //#region Listing

  function parseName(name: string): { kind: BackupKind; encrypted: boolean; createdAt: string | null } | null {
    const match = name.match(NAME_PATTERN);
    if (!match) return null;
    // The time in the name is the server's clock, and stays right when the file is copied (unlike its date)
    const [, y, mo, d, h, mi, s] = match[1].match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)!.map(Number);
    const made = new Date(y, mo - 1, d, h, mi, s);
    return { kind: match[2] as BackupKind, encrypted: !!match[3], createdAt: isNaN(made.getTime()) ? null : made.toISOString() };
  }

  /**
   * The backups in a folder, newest first. Half-written ones are left out.
   */
  export async function list(dir?: string): Promise<BackupInfo[]> {
    dir ??= await folder();
    const names = await fsp.readdir(dir).catch(() => [] as string[]);
    const backups: BackupInfo[] = [];
    for (const name of names) {
      const parsed = parseName(name);
      if (!parsed) continue;
      const stat = await fsp.stat(Path.join(dir, name)).catch(() => null);
      if (!stat?.isFile()) continue;
      backups.push({ name, size: stat.size, createdAt: parsed.createdAt ?? (stat.mtime ?? new Date()).toISOString(), kind: parsed.kind, encrypted: parsed.encrypted });
    }
    return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * The full path of a backup in the backup folder, or `null` when there's no such backup.
   */
  export async function pathOf(name: string, dir?: string): Promise<string | null> {
    if (!parseName(name)) return null;
    const path = Path.join(dir ?? await folder(), name);
    return await fsp.stat(path).then((s) => s.isFile() ? path : null).catch(() => null);
  }

  export async function remove(name: string) {
    const path = await pathOf(name);
    if (!path) throw new Error("That backup isn't there any more.");
    await fsp.rm(path);
  }

  /**
   * When the next scheduled backup is due.
   */
  function nextAt(state: Stored): Date | null {
    if (state.schedule === "off") return null;
    if (!state.lastScheduledAt) return new Date(Date.now() + 5 * 60 * 1000);
    return new Date(Date.parse(state.lastScheduledAt) + SCHEDULE_HOURS[state.schedule] * 60 * 60 * 1000);
  }

  export async function overview(): Promise<BackupsOverview> {
    const state = await stored();
    const dir = await folder();
    return {
      settings: await settings(),
      folder: dir,
      defaultFolder: AppSystem.backupsDir,
      backups: await list(dir),
      running: Tasks.get("backup"),
      nextAt: nextAt(state)?.toISOString() ?? null,
      lastError: state.lastError,
      freeSpace: await SystemStats.freeSpace(await existingParent(dir)),
    };
  }

  async function existingParent(path: string) {
    let current = path;
    while (!(await fsp.stat(current).then(() => true).catch(() => false))) {
      const parent = Path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return current;
  }

  //#endregion

  //#region Making backups

  function stamp(date: Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  /**
   * Keys of artwork made by hand (uploaded or picked thumbnails), which can't be downloaded again.
   */
  async function handMadeArtwork(): Promise<string[]> {
    // Raw, so this also works on a database from before an update, whose models don't match yet
    const rows = await sequelize.query<{ artwork: string | null }>("SELECT artwork FROM media_items WHERE customArtwork = 1", { type: QueryTypes.SELECT }).catch(() => []);
    const keys = new Set<string>();
    for (const row of rows) {
      try {
        for (const value of Object.values(JSON.parse(row.artwork ?? "{}") as Record<string, unknown>)) {
          if (typeof value === "string" && /^[0-9a-f]{32}$/.test(value)) keys.add(value);
        }
      } catch {
        // Unreadable artwork has nothing to keep
      }
    }
    return [...keys];
  }

  /**
   * The original of every stored image; the resized copies next to them are made again when they're asked for.
   */
  async function allArtwork(): Promise<string[]> {
    const files: string[] = [];
    for (const dir of await fsp.readdir(AppSystem.imagesDir).catch(() => [] as string[])) {
      if (!/^[0-9a-f]{2}$/.test(dir)) continue;
      for (const file of await fsp.readdir(Path.join(AppSystem.imagesDir, dir)).catch(() => [] as string[])) {
        if (file.endsWith(".img")) files.push(Path.join(dir, file));
      }
    }
    return files;
  }

  /**
   * Make a backup now, as a background task. Only one is made at a time.
   */
  export function make(kind: BackupKind, opts?: { artwork?: boolean }): Promise<BackupInfo> {
    opts ??= {};
    return Tasks.run("backup", "Making a backup", { queue: "backup" }, (task) => write(kind, opts, task));
  }

  async function write(kind: BackupKind, opts: { artwork?: boolean }, task: Tasks.Handle): Promise<BackupInfo> {
    const state = await stored();
    const dir = await folder();
    await checkWritable(dir);
    const createdAt = new Date();
    const name = `${PREFIX}${stamp(createdAt)}-${kind}.tar.gz${state.password ? ".enc" : ""}`;
    const target = Path.join(dir, name);
    const partial = `${target}.partial`;
    const work = await fsp.mkdtemp(Path.join(AppSystem.tempDir, "backup-"));
    const allImages = opts.artwork ?? state.artwork;

    try {
      task.update("Saving the database");
      const dump = await DatabaseDump.exportTo(Path.join(work, "db"));
      const manifest: Manifest = {
        format: FORMAT,
        app: "Cinemion",
        version: AppSystem.VERSION,
        createdAt: createdAt.toISOString(),
        kind,
        serverName: await Setting.get(Setting.Keys.SERVER_NAME, AppSystem.APP_NAME),
        dialect: sequelize.getDialect(),
        migrations: dump.migrations,
        tables: dump.tables,
        artwork: allImages ? "all" : "handMade",
      };

      // Backups hold the sign-in key and API keys, so only the user Cinemion runs as may read them
      const out = await Deno.open(partial, { write: true, create: true, truncate: true, mode: 0o600 });
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      let packed = readable.pipeThrough(new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
      if (state.password) packed = packed.pipeThrough(await Encryption.encrypt(state.password));
      const written = packed.pipeTo(out.writable);
      const tar = new Tar.Writer(writable.getWriter());
      try {
        await tar.addBytes("manifest.json", new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
        for (const table of dump.tables) await tar.addFile(`db/${table.name}.jsonl`, Path.join(work, "db", `${table.name}.jsonl`));

        task.update("Adding profile pictures");
        if (!AppSystem.config.JWT_SECRET) await tar.addFile("files/secret.key", AppSystem.secretFile);
        for (const file of await fsp.readdir(AppSystem.avatarsDir).catch(() => [] as string[])) {
          await tar.addFile(`files/avatars/${file}`, Path.join(AppSystem.avatarsDir, file));
        }

        const images = allImages ? await allArtwork() : (await handMadeArtwork()).map((key) => Path.join(key.slice(0, 2), `${key}.img`));
        for (const [i, image] of images.entries()) {
          if (i % 50 === 0) task.update(`Adding artwork (${i} of ${images.length})`, images.length ? i / images.length : null);
          await tar.addFile(`files/images/${image.split(Path.sep).join("/")}`, Path.join(AppSystem.imagesDir, image));
        }
        await tar.finish();
      } catch (error) {
        await writable.abort(error).catch(() => { });
        throw error;
      } finally {
        await written.catch(() => { });
      }
      await written;
      await fsp.rename(partial, target);
    } catch (error) {
      await fsp.rm(partial, { force: true });
      if ((error as { code?: string }).code === "ENOSPC") throw new Error(`There isn't enough free space in ${dir} for the backup.`);
      throw error;
    } finally {
      await fsp.rm(work, { recursive: true, force: true });
    }

    await prune(dir, kind, kind === "scheduled" ? state.keep : KEEP_BEFORE_UPDATE);
    const stat = await fsp.stat(target);
    log.info(`Made a backup: ${target}`, { size: stat.size, kind });
    return { name, size: stat.size, createdAt: createdAt.toISOString(), kind, encrypted: !!state.password };
  }

  /**
   * Delete the oldest backups of a kind beyond `keep`. Backups made by hand are never deleted by themselves.
   */
  async function prune(dir: string, kind: BackupKind, keep: number) {
    if (kind === "manual") return;
    const old = (await list(dir)).filter((b) => b.kind === kind).slice(keep);
    for (const backup of old) {
      await fsp.rm(Path.join(dir, backup.name), { force: true });
      log.info(`Deleted an old backup: ${backup.name}`);
    }
  }

  //#endregion

  //#region Schedule

  /**
   * Make scheduled backups when they're due, preferably at night.
   */
  export function start() {
    _firstTimer = setTimeout(() => checkSchedule(), 5 * 60 * 1000);
    _timer = setInterval(() => checkSchedule(), SCHEDULE_TIMER_MS);
  }

  export function stop() {
    if (_firstTimer !== null) clearTimeout(_firstTimer);
    if (_timer !== null) clearInterval(_timer);
    _firstTimer = _timer = null;
  }

  async function checkSchedule() {
    const state = await stored().catch(() => null);
    const due = state && nextAt(state);
    if (!state || !due || Tasks.get("backup")) return;
    const now = Date.now();
    const hour = new Date().getHours();
    // Within an hour of being due, wait for the night (2 to 6), unless it's already more than six hours late
    const night = hour >= 2 && hour < 6;
    if (state.lastScheduledAt && !(now >= due.getTime() - 60 * 60 * 1000 && night) && now < due.getTime() + 6 * 60 * 60 * 1000) return;

    try {
      await make("scheduled");
      await store({ lastScheduledAt: new Date().toISOString(), lastError: null });
    } catch (error) {
      const message = errorMessage(error);
      // Try again tomorrow rather than every hour
      await store({ lastScheduledAt: new Date().toISOString(), lastError: message });
      await Activity.record("backup", `The scheduled backup failed: ${message}`);
    }
  }

  /**
   * Make a backup before migrations change the database, so an update can be undone. Runs at startup, before the
   * migrations; a failure is logged and doesn't stop the update.
   */
  export async function beforeUpdate(pending: string[]) {
    try {
      log.info(`Making a backup before updating the database (${pending.length} ${pending.length === 1 ? "change" : "changes"})`);
      await make("update", { artwork: false });
    } catch (error) {
      log.warn("Could not make a backup before updating the database", { error: errorMessage(error) });
    }
  }

  //#endregion

  //#region Restoring

  /**
   * The files in a backup, in order, opened with `password` when it's protected.
   * @throws `PasswordNeeded` when it's protected and no password was given.
   */
  async function entries(path: string, password?: string | null): Promise<AsyncGenerator<Tar.ReadEntry>> {
    const encrypted = await Encryption.isEncryptedFile(path);
    if (encrypted && !password) throw new PasswordNeeded();
    const file = await Deno.open(path, { read: true });
    let stream: ReadableStream<Uint8Array> = file.readable;
    if (encrypted) stream = stream.pipeThrough(Encryption.decrypt(password!));
    stream = stream.pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
    return Tar.read(stream);
  }

  function readableError(error: unknown) {
    if (error instanceof PasswordNeeded) return error;
    const message = errorMessage(error);
    // gzip and tar errors mean the file is something else, or damaged
    if (/gzip|corrupt|incorrect header|tar archive|invalid/i.test(message)) return new Error("This isn't a Cinemion backup, or it's damaged.");
    return error instanceof Error ? error : new Error(message);
  }

  function checkManifest(manifest: Partial<Manifest>) {
    if (manifest.app !== "Cinemion" || typeof manifest.format !== "number" || !Array.isArray(manifest.tables) || !Array.isArray(manifest.migrations)) {
      throw new Error("This isn't a Cinemion backup, or it's damaged.");
    }
    if (manifest.format > FORMAT || DatabaseDump.unknownMigrations(manifest.migrations).length > 0) {
      throw new Error(`This backup was made by Cinemion ${manifest.version}, which is newer than this one (${AppSystem.VERSION}). Update Cinemion first, then restore it.`);
    }
  }

  /**
   * What's in a backup, without restoring it.
   * @throws `PasswordNeeded`, or an error saying what's wrong with the file.
   */
  export async function inspect(path: string, password?: string | null): Promise<Manifest> {
    try {
      for await (const entry of await entries(path, password)) {
        if (entry.name !== "manifest.json") break;
        const manifest = JSON.parse(await entry.text()) as Manifest;
        checkManifest(manifest);
        return manifest;
      }
    } catch (error) {
      throw readableError(error);
    }
    throw new Error("This isn't a Cinemion backup, or it's damaged.");
  }

  /**
   * Where an entry of a backup may be unpacked to, or `null` for anything else, so a made-up backup can't write
   * outside the folders it belongs in.
   */
  function allowedEntry(name: string) {
    return name === "manifest.json" || name === "files/secret.key" ||
      /^db\/[A-Za-z0-9_]+\.jsonl$/.test(name) ||
      /^files\/avatars\/[A-Za-z0-9_.-]+$/.test(name) ||
      /^files\/images\/[0-9a-f]{2}\/[0-9a-f]{32}\.img$/.test(name);
  }

  export function restoreStatus(): RestoreStatus {
    return { ..._restore };
  }

  /**
   * Replace this server's database and files with a backup. Everything in the backup is unpacked and checked before
   * anything is changed, so a wrong password or a damaged file leaves the server as it was.
   * @param onStep Told about each step, for the CLI.
   * @throws `PasswordNeeded`, or an error saying what went wrong.
   */
  export async function restore(path: string, password?: string | null, onStep?: (step: string, progress: number | null) => void): Promise<Manifest> {
    if (_restore.state === "running") throw new Error("A backup is being restored already.");
    _restore = { state: "running", step: "Checking the backup", progress: null, error: null, backup: null };
    const step = (text: string, progress: number | null = null) => {
      _restore.step = text;
      _restore.progress = progress;
      onStep?.(text, progress);
    };
    step("Checking the backup");
    const work = Path.join(AppSystem.config.CONFIG_DIR, `.restore-${crypto.randomUUID()}`);
    try {
      let manifest: Manifest | null = null;
      try {
        const total = (await fsp.stat(path)).size;
        let seen = 0;
        for await (const entry of await entries(path, password)) {
          if (!manifest) {
            if (entry.name !== "manifest.json") throw new Error("This isn't a Cinemion backup, or it's damaged.");
            manifest = JSON.parse(await entry.text()) as Manifest;
            checkManifest(manifest);
            _restore.backup = { createdAt: manifest.createdAt, version: manifest.version, serverName: manifest.serverName };
            continue;
          }
          if (!allowedEntry(entry.name)) {
            log.warn(`Left "${entry.name}" in the backup out; Cinemion doesn't restore files there.`);
            continue;
          }
          const target = Path.join(work, ...entry.name.split("/"));
          await fsp.mkdir(Path.dirname(target), { recursive: true });
          const out = await Deno.open(target, { write: true, create: true, truncate: true });
          try {
            for await (const piece of entry.chunks()) {
              let at = 0;
              while (at < piece.length) at += await out.write(piece.subarray(at));
            }
          } finally {
            out.close();
          }
          // The packed size is a fair guide to how far along the unpacking is
          seen += entry.size;
          step("Checking the backup", Math.min(0.99, seen / Math.max(total * 2, 1)));
        }
      } catch (error) {
        throw readableError(error);
      }
      if (!manifest) throw new Error("This isn't a Cinemion backup, or it's damaged.");

      step("Restoring the database", 0);
      await DatabaseDump.importFrom(Path.join(work, "db"), manifest.migrations, manifest.tables, (done, total) => step("Restoring the database", total ? done / total : null));
      Setting.clearCache();

      step("Restoring profile pictures and artwork");
      const files = Path.join(work, "files");
      if (await fsp.stat(Path.join(files, "secret.key")).then(() => true).catch(() => false)) {
        await fsp.copyFile(Path.join(files, "secret.key"), AppSystem.secretFile);
        await fsp.chmod(AppSystem.secretFile, 0o600).catch(() => { });
        await AppSystem.loadSecret();
      }
      // Profile pictures belong to profiles, so the ones of this server go with its database
      for (const file of await fsp.readdir(AppSystem.avatarsDir).catch(() => [] as string[])) await fsp.rm(Path.join(AppSystem.avatarsDir, file), { force: true });
      await moveAll(Path.join(files, "avatars"), AppSystem.avatarsDir);
      await moveAll(Path.join(files, "images"), AppSystem.imagesDir);

      const made = new Date(manifest.createdAt);
      await Activity.record("backup", `Restored a backup made on ${made.toISOString().slice(0, 10)} by Cinemion ${manifest.version}`);
      log.info("Restored a backup", { file: path, createdAt: manifest.createdAt, version: manifest.version });
      _restore = { ..._restore, state: "done", step: null, progress: null };
      return manifest;
    } catch (error) {
      _restore = { ..._restore, state: "failed", step: null, progress: null, error: errorMessage(error) };
      throw error;
    } finally {
      await fsp.rm(work, { recursive: true, force: true });
    }
  }

  /**
   * Move every file from `from` into `to`, keeping folders. Across drives, files are copied.
   */
  async function moveAll(from: string, to: string) {
    for (const entry of await fsp.readdir(from, { withFileTypes: true }).catch(() => [])) {
      const source = Path.join(from, entry.name);
      const target = Path.join(to, entry.name);
      if (entry.isDirectory()) {
        await fsp.mkdir(target, { recursive: true });
        await moveAll(source, target);
        continue;
      }
      await fsp.rename(source, target).catch(async () => await fsp.copyFile(source, target));
    }
  }

  //#endregion
}

export default Backups;
