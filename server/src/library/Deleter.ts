import fs from "node:fs";
import fsp from "node:fs/promises";
import Path from "node:path";
import { Op } from "sequelize";
import { Library, MediaFile, MediaItem, type User } from "../models/index.ts";
import Scanner from "./Scanner.ts";
import ItemLabels from "./ItemLabels.ts";
import Events from "../integrations/Events.ts";
import log from "../lib/Logger.ts";

/**
 * Deleting files from disk from inside Cinemion: one file (like an extra copy), or a whole movie, episode, video,
 * season or show. Only files of the library are touched, plus the subtitles, NFO and thumbnail that belong to them;
 * a folder only goes when nothing else of the library is in it.
 */
export namespace Deleter {
  /**
   * Item types that can be deleted as a whole.
   */
  export const TYPES = ["movie", "show", "season", "episode", "video"];

  export interface Plan {
    library: Library;
    files: MediaFile[];
    /**
     * Files that belong to the media files: subtitles next to them, `.nfo`, thumbnails.
     */
    extras: string[];
    /**
     * A folder that goes as a whole, or `null`.
     */
    folder: string | null;
    /**
     * Unit is in bytes.
     */
    size: number;
  }

  async function exists(path: string) {
    return await fsp.stat(path).then(() => true).catch(() => false);
  }

  /**
   * Files with the media file's name and another extension that describe it.
   */
  async function extrasOf(file: MediaFile) {
    const extras = new Set(file.sidecars.map((s) => s.path));
    const base = file.path.slice(0, file.path.length - Path.extname(file.path).length);
    for (const suffix of [".nfo", "-thumb.jpg", "-thumb.png", ".jpg", ".png", ".webp"]) {
      if (await exists(base + suffix)) extras.add(base + suffix);
    }
    return [...extras];
  }

  async function filesOf(item: MediaItem): Promise<MediaFile[]> {
    if (item.type === "movie" || item.type === "episode" || item.type === "video") return await MediaFile.findAll({ where: { itemId: item.id } });
    const seasons = item.type === "show" ? await MediaItem.findAll({ where: { parentId: item.id, type: "season" }, attributes: ["id"] }) : [item];
    const episodes = seasons.length ? await MediaItem.findAll({ where: { parentId: seasons.map((s) => s.id), type: "episode" }, attributes: ["id"] }) : [];
    return episodes.length ? await MediaFile.findAll({ where: { itemId: episodes.map((e) => e.id) } }) : [];
  }

  function commonFolder(paths: string[]) {
    if (paths.length === 0) return null;
    let common = Path.dirname(paths[0]);
    for (const path of paths) {
      while (!(path + Path.sep).startsWith(common + Path.sep)) {
        const parent = Path.dirname(common);
        if (parent === common) return null;
        common = parent;
      }
    }
    return common;
  }

  /**
   * The folder that holds all of these files and nothing else from the library, when it's inside a library folder.
   */
  async function ownFolder(library: Library, files: MediaFile[]) {
    const folder = commonFolder(files.map((f) => f.path));
    if (!folder) return null;
    const inside = library.paths.some((root) => folder.startsWith(Path.resolve(root) + Path.sep));
    if (!inside) return null;
    const ids = new Set(files.map((f) => f.id));
    const others = await MediaFile.count({ where: { libraryId: library.id, path: { [Op.startsWith]: folder + Path.sep }, id: { [Op.notIn]: [...ids] } } });
    return others === 0 ? folder : null;
  }

  /**
   * What deleting an item, or some of its files, would remove.
   * @throws When the item can't be deleted.
   */
  export async function plan(item: MediaItem, only?: MediaFile[]): Promise<Plan> {
    if (!only && !TYPES.includes(item.type)) throw new Error("Only movies, shows, seasons, episodes and videos can be deleted.");
    const library = await Library.findByPk(item.libraryId);
    if (!library) throw new Error("That title's library is gone.");
    const files = only ?? await filesOf(item);
    if (files.length === 0) throw new Error("There are no files to delete.");
    const extras = (await Promise.all(files.map(extrasOf))).flat();
    // Single files leave their folder; whole titles take it along when nothing else lives there
    const folder = only ? null : await ownFolder(library, files);
    return { library, files, extras, folder, size: files.reduce((sum, f) => sum + Number(f.size), 0) };
  }

  /**
   * What deleting one file would remove: the file and what belongs to it, never its folder.
   * @throws When the file's library is gone.
   */
  export async function planFile(file: MediaFile): Promise<Plan> {
    const library = await Library.findByPk(file.libraryId);
    if (!library) throw new Error("That file's library is gone.");
    return { library, files: [file], extras: await extrasOf(file), folder: null, size: Number(file.size) };
  }

  /**
   * Whether Cinemion may delete in all the folders a plan touches.
   */
  export async function canDelete(plan: Plan) {
    const folders = new Set([...plan.files.map((f) => Path.dirname(f.path)), ...plan.folder ? [Path.dirname(plan.folder)] : []]);
    for (const folder of folders) {
      if (!(await fsp.access(folder, fs.constants.W_OK).then(() => true).catch(() => false))) return false;
    }
    return true;
  }

  /**
   * Delete what a plan says, then scan the folders so the titles go from the library.
   * @throws When Cinemion can't write to the folder, with what to change.
   */
  export async function run(plan: Plan, user: User, what: string) {
    if (!(await canDelete(plan))) {
      throw new Error("Cinemion can't delete files in this folder: it only has read access. Allow writing to the library folder (in Docker, mount it without :ro) and try again.");
    }
    if (plan.folder) {
      await fsp.rm(plan.folder, { recursive: true });
    }
    else {
      for (const path of [...plan.files.map((f) => f.path), ...plan.extras]) await fsp.rm(path, { force: true });
      // A folder left with nothing at all in it goes too, unless it's a library folder itself
      const roots = new Set(plan.library.paths.map((p) => Path.resolve(p)));
      for (const folder of new Set(plan.files.map((f) => Path.dirname(f.path)))) {
        if (roots.has(folder)) continue;
        const left = await fsp.readdir(folder).catch(() => null);
        if (left && left.length === 0) await fsp.rmdir(folder).catch(() => { });
      }
    }
    log.info(`${user.name} deleted ${what}`, { files: plan.files.length, folder: plan.folder, size: plan.size });
    Events.activity({ kind: "delete", message: `${user.name} deleted ${what} from ${plan.library.name}`, userId: user.id });

    // The nearest folder that's still there is scanned, which drops what was in the deleted ones
    const scan = new Set<string>();
    for (const path of plan.folder ? [plan.folder] : plan.files.map((f) => f.path)) {
      let folder = Path.dirname(path);
      while (!(await exists(folder)) && Path.dirname(folder) !== folder) folder = Path.dirname(folder);
      scan.add(folder);
    }
    await Scanner.scanFoldersNow(plan.library, [...scan]);
  }

  /**
   * How a title is called in the activity feed: "Saltwater Kings · S1 E3".
   */
  export async function describe(item: MediaItem) {
    if (item.type === "season") {
      const show = item.parentId ? await MediaItem.findByPk(item.parentId, { attributes: ["title"] }) : null;
      return show ? `${show.title} · ${item.title}` : item.title;
    }
    return (await ItemLabels.describe(item)).title;
  }
}

export default Deleter;
