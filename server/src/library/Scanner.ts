import fsp from "node:fs/promises";
import Path from "node:path";
import { Op } from "sequelize";
import { Collection, Library, MediaFile, MediaItem } from "../models/index.ts";
import NameParser from "./NameParser.ts";
import Probe from "../media/Probe.ts";
import MetadataManager from "../metadata/MetadataManager.ts";
import Tasks from "../lib/Tasks.ts";
import { forEachLimit } from "../lib/async.ts";
import log from "../lib/Logger.ts";

/**
 * Finds the video files in a library, works out what they are, and keeps the database in step with the disk.
 * Unchanged files (same size and modification time) are skipped, so rescans are cheap.
 */
export namespace Scanner {
  export interface ScanOptions {
    /**
     * Fetch metadata again for everything, not just new items.
     */
    refreshMetadata?: boolean;
  }

  interface FoundFile {
    path: string;
    root: string;
    size: number;
    mtime: number;
  }

  // Tiny files named "sample" are release samples, not the movie
  const SAMPLE_MAX_BYTES = 80 * 1024 * 1024;
  const PROBE_CONCURRENCY = 4;
  const METADATA_CONCURRENCY = 3;

  export function taskId(libraryId: number) {
    return `scan:${libraryId}`;
  }

  /**
   * Scan a library in the background. Returns the running scan if one is already going.
   */
  export function queue(libraryId: number, opts?: ScanOptions) {
    opts ??= {};
    return Tasks.run(taskId(libraryId), "Scanning library", { libraryId, queue: "scan" }, async (task) => {
      const library = await Library.findByPk(libraryId);
      if (!library) return;
      await scanLibrary(library, task, opts);
    });
  }

  /**
   * Every video file under `root`, following symlinked folders but never looping.
   */
  async function walk(root: string): Promise<FoundFile[]> {
    const found: FoundFile[] = [];
    const visited = new Set<string>();

    async function visit(folder: string) {
      const real = await fsp.realpath(folder).catch(() => null);
      if (!real || visited.has(real)) return;
      visited.add(real);
      const entries = await fsp.readdir(folder, { withFileTypes: true }).catch((error) => {
        log.warn(`Could not read the folder ${folder}`, { error });
        return [];
      });
      for (const entry of entries) {
        const full = Path.join(folder, entry.name);
        const stat = entry.isSymbolicLink() ? await fsp.stat(full).catch(() => null) : null;
        if (entry.isDirectory() || stat?.isDirectory()) {
          if (!NameParser.shouldSkip(Path.relative(root, full) + "/x")) await visit(full);
          continue;
        }
        if (!NameParser.isVideo(entry.name) || NameParser.shouldSkip(Path.relative(root, full))) continue;
        const info = stat ?? await fsp.stat(full).catch(() => null);
        if (!info?.isFile()) continue;
        if (/sample/i.test(entry.name) && info.size < SAMPLE_MAX_BYTES) continue;
        found.push({ path: full, root, size: info.size, mtime: info.mtime?.getTime() ?? 0 });
      }
    }

    await visit(root);
    return found;
  }

  /**
   * Bring one library up to date with its folders.
   */
  export async function scanLibrary(library: Library, task: Tasks.Handle, opts: ScanOptions) {
    const started = Date.now();
    task.update("Looking for files");

    const found: FoundFile[] = [];
    for (const root of library.paths) {
      const exists = await fsp.stat(root).then((s) => s.isDirectory()).catch(() => false);
      // A missing folder (unplugged drive, unmounted share) must not wipe the library
      if (!exists) {
        log.warn(`The folder ${root} of library "${library.name}" isn't there. Skipping this scan so nothing gets removed.`);
        return;
      }
      found.push(...await walk(root));
    }
    const onDisk = new Map(found.map((f) => [f.path, f]));

    // Removed files
    const known = await MediaFile.findAll({ where: { libraryId: library.id } });
    const removed = known.filter((f) => !onDisk.has(f.path));
    if (removed.length) await MediaFile.destroy({ where: { id: removed.map((f) => f.id) } });

    // New and changed files
    const knownByPath = new Map(known.map((f) => [f.path, f]));
    for (const file of found) {
      const existing = knownByPath.get(file.path);
      if (!existing) {
        await MediaFile.create({ libraryId: library.id, path: file.path, size: file.size, mtime: file.mtime });
      }
      else if (Number(existing.size) !== file.size || Number(existing.mtime) !== file.mtime) {
        await existing.update({ size: file.size, mtime: file.mtime, probedAt: null });
      }
    }

    // Read the files ffprobe hasn't seen yet
    const toProbe = await MediaFile.findAll({ where: { libraryId: library.id, probedAt: null } });
    let probed = 0;
    await forEachLimit(toProbe, PROBE_CONCURRENCY, async (file) => {
      task.update("Reading files", probed / toProbe.length);
      try {
        const details = await Probe.read(file.path);
        await file.update({ ...details, probedAt: new Date() });
      } catch (error) {
        log.warn(`Could not read ${file.path}`, { error });
        await file.update({ probedAt: new Date() });
      }
      probed++;
    });

    task.update("Sorting files");
    const roots = new Map(found.map((f) => [f.path, f.root]));
    if (library.type === "movies") await assignMovies(library, roots);
    else await assignEpisodes(library, roots);
    await removeEmptyItems(library);

    // Details for new items (or all of them, when asked)
    const top = await MediaItem.findAll({
      where: {
        libraryId: library.id,
        type: library.type === "movies" ? "movie" : "show",
        ...(opts.refreshMetadata ? {} : { [Op.or]: [{ metadataUpdatedAt: null }, { id: await showsWithNewEpisodes(library) }] }),
      },
    });
    let done = 0;
    await forEachLimit(top, METADATA_CONCURRENCY, async (item) => {
      task.update("Fetching details", done / top.length);
      try {
        if (item.type === "movie") await MetadataManager.refreshMovie(item);
        else await MetadataManager.refreshShow(item);
      } catch (error) {
        log.warn(`Could not fetch details for "${item.title}"`, { error });
      }
      done++;
    });

    library.lastScannedAt = new Date();
    await library.save();
    log.info(`Scanned "${library.name}"`, { files: found.length, removed: removed.length, probed: toProbe.length, refreshed: top.length, seconds: Math.round((Date.now() - started) / 100) / 10 });
  }

  /**
   * Shows that gained seasons or episodes without details since the last scan.
   */
  async function showsWithNewEpisodes(library: Library) {
    const fresh = await MediaItem.findAll({ where: { libraryId: library.id, type: ["season", "episode"], metadataUpdatedAt: null }, attributes: ["id", "parentId", "type"] });
    const showIds = new Set<number>();
    for (const item of fresh) {
      if (item.type === "season" && item.parentId) showIds.add(item.parentId);
      else if (item.parentId) {
        const season = await MediaItem.findByPk(item.parentId, { attributes: ["parentId"] });
        if (season?.parentId) showIds.add(season.parentId);
      }
    }
    return [...showIds];
  }

  /**
   * Group movie files into movies. Files in the same movie folder (or with the same title and year
   * in the library root) are versions of one movie.
   */
  async function assignMovies(library: Library, roots: Map<string, string>) {
    const groupKey = (path: string) => {
      const root = roots.get(path) ?? library.paths[0];
      const folder = Path.dirname(path);
      if (Path.resolve(folder) !== Path.resolve(root)) return `folder:${folder}`;
      const parsed = NameParser.parseMovie(path, root);
      return `title:${parsed.title.toLowerCase()}|${parsed.year ?? ""}`;
    };

    const movies = new Map<string, number>();
    for (const file of await MediaFile.findAll({ where: { libraryId: library.id, itemId: { [Op.ne]: null } } })) {
      movies.set(groupKey(file.path), file.itemId!);
    }

    for (const file of await MediaFile.findAll({ where: { libraryId: library.id, itemId: null } })) {
      const key = groupKey(file.path);
      let itemId = movies.get(key);
      if (!itemId) {
        const parsed = NameParser.parseMovie(file.path, roots.get(file.path) ?? library.paths[0]);
        const movie = MediaItem.build({ libraryId: library.id, type: "movie", title: parsed.title, sortTitle: "", year: parsed.year, externalIds: parsed.ids });
        movie.setTitle(parsed.title);
        await movie.save();
        itemId = movie.id;
        movies.set(key, itemId);
      }
      await file.update({ itemId });
    }
  }

  /**
   * Sort episode files into shows, seasons and episodes, creating whatever is new.
   */
  async function assignEpisodes(library: Library, roots: Map<string, string>) {
    const unassigned = await MediaFile.findAll({ where: { libraryId: library.id, itemId: null } });
    for (const file of unassigned) {
      const info = NameParser.parseEpisode(file.path, roots.get(file.path) ?? library.paths[0]);
      if (!info) {
        log.debug(`No episode number in ${file.path}, so it's left out`);
        continue;
      }

      let show = await MediaItem.findOne({ where: { libraryId: library.id, type: "show", folderPath: info.showFolder } });
      if (!show) {
        show = MediaItem.build({ libraryId: library.id, type: "show", folderPath: info.showFolder, title: info.show.title, sortTitle: "", year: info.show.year, externalIds: info.show.ids });
        show.setTitle(info.show.title);
        await show.save();
      }

      let season = await MediaItem.findOne({ where: { parentId: show.id, type: "season", seasonNumber: info.season } });
      if (!season) {
        season = MediaItem.build({ libraryId: library.id, parentId: show.id, type: "season", title: "", sortTitle: "", seasonNumber: info.season });
        season.setTitle(info.season === 0 ? "Specials" : `Season ${info.season}`);
        await season.save();
      }

      let episode = await MediaItem.findOne({ where: { parentId: season.id, type: "episode", episodeNumber: info.episode } });
      if (!episode) {
        episode = MediaItem.build({ libraryId: library.id, parentId: season.id, type: "episode", title: "", sortTitle: "", seasonNumber: info.season, episodeNumber: info.episode, episodeEnd: info.episodeEnd });
        episode.setTitle(info.title ?? (info.episodeEnd ? `Episodes ${info.episode}–${info.episodeEnd}` : `Episode ${info.episode}`));
        await episode.save();
      }
      await file.update({ itemId: episode.id });
    }
  }

  /**
   * Remove movies and episodes whose files are all gone, then seasons and shows left empty.
   */
  async function removeEmptyItems(library: Library) {
    const withFiles = new Set((await MediaFile.findAll({ where: { libraryId: library.id, itemId: { [Op.ne]: null } }, attributes: ["itemId"] })).map((f) => f.itemId!));
    const playable = await MediaItem.findAll({ where: { libraryId: library.id, type: ["movie", "episode"] }, attributes: ["id"] });
    const orphans = playable.filter((i) => !withFiles.has(i.id)).map((i) => i.id);
    if (orphans.length) await MediaItem.destroy({ where: { id: orphans } });

    for (const type of ["season", "show"] as const) {
      const parents = await MediaItem.findAll({ where: { libraryId: library.id, type }, attributes: ["id"] });
      for (const parent of parents) {
        if (await MediaItem.count({ where: { parentId: parent.id } }) === 0) await parent.destroy();
      }
    }

    for (const collection of await Collection.findAll({ where: { libraryId: library.id }, attributes: ["id"] })) {
      if (await MediaItem.count({ where: { collectionId: collection.id } }) === 0) await collection.destroy();
    }
  }
}

export default Scanner;
