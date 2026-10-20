import fsp from "node:fs/promises";
import Path from "node:path";
import { Op } from "sequelize";
import { Collection, Library, MediaFile, MediaItem } from "../models/index.ts";
import NameParser from "./NameParser.ts";
import Probe from "../media/Probe.ts";
import Sidecars from "./Sidecars.ts";
import Trickplay from "../media/Trickplay.ts";
import Markers from "../media/Markers.ts";
import MetadataManager from "../metadata/MetadataManager.ts";
import ItemLabels from "./ItemLabels.ts";
import VideoDetails from "./VideoDetails.ts";
import Events from "../integrations/Events.ts";
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
    /**
     * Only look in these folders inside the library, like the ones Sonarr or Radarr just imported into.
     * A folder that's gone (a deleted show) is looked at from the nearest folder that's still there.
     */
    folders?: string[];
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
  // Imports often come in bursts (a season pack is one event per episode), so folders are collected for a moment
  const FOLDER_DEBOUNCE_MS = 5_000;
  // More new titles than this at once are one line in the activity feed
  const ACTIVITY_GROUP_OVER = 5;

  const _pendingFolders = new Map<number, { folders: Set<string>; timer?: ReturnType<typeof setTimeout> }>();

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
   * Scan only some folders of a library, shortly, so several calls in a row become one scan.
   */
  export function queueFolders(libraryId: number, folders: string[]) {
    const pending = _pendingFolders.get(libraryId) ?? { folders: new Set<string>() };
    for (const folder of folders) pending.folders.add(Path.resolve(folder));
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      _pendingFolders.delete(libraryId);
      const list = [...pending.folders];
      Tasks.run(`scan-folders:${libraryId}:${Date.now()}`, "Scanning changed folders", { libraryId, queue: "scan" }, async (task) => {
        const library = await Library.findByPk(libraryId);
        if (!library) return;
        await scanLibrary(library, task, { folders: list });
      }).catch(() => { });
    }, FOLDER_DEBOUNCE_MS);
    _pendingFolders.set(libraryId, pending);
  }

  /**
   * Whether `path` is `folder` or somewhere inside it.
   */
  export function isInside(path: string, folder: string) {
    const p = Path.resolve(path);
    const f = Path.resolve(folder);
    return p === f || p.startsWith(f.endsWith(Path.sep) ? f : f + Path.sep);
  }

  /**
   * `folder`, or the closest folder above it that exists, without leaving `root`.
   */
  async function nearestExisting(folder: string, root: string) {
    let current = Path.resolve(folder);
    while (isInside(current, root)) {
      if (await fsp.stat(current).then((s) => s.isDirectory()).catch(() => false)) return current;
      if (current === Path.resolve(root)) return null;
      current = Path.dirname(current);
    }
    return null;
  }

  /**
   * Every video file under `start` (default `root`), following symlinked folders but never looping.
   * @param anyVideo For Videos libraries: keep extras, trailers and samples, which are just videos there.
   */
  async function walk(root: string, start = root, anyVideo = false): Promise<FoundFile[]> {
    const found: FoundFile[] = [];
    const visited = new Set<string>();
    const shouldSkip = (relative: string) => anyVideo ? relative.split(/[\\/]/).some((p) => p.startsWith(".")) : NameParser.shouldSkip(relative);

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
          if (!shouldSkip(Path.relative(root, full) + "/x")) await visit(full);
          continue;
        }
        if (!NameParser.isVideo(entry.name) || shouldSkip(Path.relative(root, full))) continue;
        const info = stat ?? await fsp.stat(full).catch(() => null);
        if (!info?.isFile()) continue;
        if (!anyVideo && /sample/i.test(entry.name) && info.size < SAMPLE_MAX_BYTES) continue;
        found.push({ path: full, root, size: info.size, mtime: info.mtime?.getTime() ?? 0 });
      }
    }

    await visit(start);
    return found;
  }

  /**
   * Which of `paths` already belong to another library. Libraries can't be set up to share folders anymore, but
   * ones from before that check (or a folder renamed into another library's) mustn't fail the whole scan.
   */
  async function inOtherLibraries(library: Library, paths: string[]) {
    const owners = new Map<string, number>();
    // Small batches, since SQLite limits the number of values in one query
    for (let i = 0; i < paths.length; i += 500) {
      const rows = await MediaFile.findAll({ where: { path: paths.slice(i, i + 500), libraryId: { [Op.ne]: library.id } }, attributes: ["path", "libraryId"] });
      for (const row of rows) owners.set(row.path, row.libraryId);
    }
    if (owners.size > 0) {
      const names = (await Library.findAll({ where: { id: [...new Set(owners.values())] }, attributes: ["name"] })).map((l) => `"${l.name}"`);
      log.warn(`${owners.size} ${owners.size === 1 ? "file" : "files"} in "${library.name}" ${owners.size === 1 ? "is" : "are"} already in ${names.join(" and ")}, so ${owners.size === 1 ? "it's" : "they're"} left out here. Give each library its own folders in Settings › Libraries.`);
    }
    return owners;
  }

  /**
   * Bring one library up to date with its folders.
   */
  export async function scanLibrary(library: Library, task: Tasks.Handle, opts: ScanOptions) {
    const started = Date.now();
    const firstScan = !library.lastScannedAt;
    task.update("Looking for files");

    const found: FoundFile[] = [];
    // Folders looked at in a partial scan; `null` = the whole library
    let scope: string[] | null = null;
    if (opts.folders?.length) {
      scope = [];
      for (const folder of opts.folders) {
        const root = library.paths.find((p) => isInside(folder, p));
        const start = root ? await nearestExisting(folder, root) : null;
        // A missing library folder (unplugged drive, unmounted share) must not wipe anything
        if (!root || !start) continue;
        if (scope.some((s) => isInside(start, s))) continue;
        scope = scope.filter((s) => !isInside(s, start));
        scope.push(start);
      }
      for (const start of scope) found.push(...await walk(library.paths.find((p) => isInside(start, p))!, start, library.type === "videos"));
      if (scope.length === 0) return;
    }
    else {
      for (const root of library.paths) {
        const exists = await fsp.stat(root).then((s) => s.isDirectory()).catch(() => false);
        // A missing folder (unplugged drive, unmounted share) must not wipe the library
        if (!exists) {
          log.warn(`The folder ${root} of library "${library.name}" isn't there. Skipping this scan so nothing gets removed.`);
          return;
        }
        found.push(...await walk(root, root, library.type === "videos"));
      }
    }
    const onDisk = new Map(found.map((f) => [f.path, f]));
    const inScope = (path: string) => !scope || scope.some((s) => isInside(path, s));

    // Removed files
    const known = await MediaFile.findAll({ where: { libraryId: library.id } });
    const removed = known.filter((f) => inScope(f.path) && !onDisk.has(f.path));
    if (removed.length) await MediaFile.destroy({ where: { id: removed.map((f) => f.id) } });

    // New and changed files. A file another library already has stays there: a file is in one library only.
    const knownByPath = new Map(known.map((f) => [f.path, f]));
    const elsewhere = await inOtherLibraries(library, [...onDisk.keys()].filter((p) => !knownByPath.has(p)));
    for (const file of onDisk.values()) {
      const existing = knownByPath.get(file.path);
      if (!existing) {
        if (elsewhere.has(file.path)) continue;
        await MediaFile.create({ libraryId: library.id, path: file.path, size: file.size, mtime: file.mtime });
      }
      else if (Number(existing.size) !== file.size || Number(existing.mtime) !== file.mtime) {
        await existing.update({ size: file.size, mtime: file.mtime, probedAt: null, markersVersion: 0 });
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

    // Subtitle files come and go without the video changing, so look for them every scan
    task.update("Looking for subtitles");
    for (const file of await MediaFile.findAll({ where: { libraryId: library.id } })) {
      if (!inScope(file.path)) continue;
      await Sidecars.refresh(file).catch((error) => log.warn(`Could not look for subtitles of ${file.path}`, { error }));
    }

    task.update("Sorting files");
    const roots = new Map(found.map((f) => [f.path, f.root]));
    const added = library.type === "movies" ? await assignMovies(library, roots) : library.type === "videos" ? await assignVideos(library, roots) : await assignEpisodes(library, roots);
    await removeEmptyItems(library);

    const refreshed = library.type === "videos" ? await refreshVideos(library, task, opts) : await refreshMetadata(library, task, opts);

    // Only a full scan counts for the schedule
    if (!scope) {
      library.lastScannedAt = new Date();
      await library.save();
    }
    await Trickplay.cleanup().catch((error) => log.warn("Could not clean up seek thumbnails", { error }));
    Trickplay.queueLibrary(library.id);
    Markers.queueLibrary(library.id);
    await reportAdded(library, added, firstScan).catch((error) => log.warn("Could not report new titles", { error }));
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    if (scope) {
      log.info(`Scanned changed folders in "${library.name}"`, { folders: scope, files: found.length, removed: removed.length, added: added.length, seconds });
    }
    else {
      log.info(`Scanned "${library.name}"`, { files: found.length, removed: removed.length, probed: toProbe.length, refreshed, seconds });
      Events.emit("library.scanned", { library: { id: library.id, name: library.name }, added: added.length, removed: removed.length });
    }
  }

  /**
   * Tell webhooks and the activity feed about new movies and episodes. The first scan of a library is one line,
   * since everything in it is new.
   */
  async function reportAdded(library: Library, ids: number[], firstScan: boolean) {
    if (ids.length === 0) return;
    const items = await MediaItem.findAll({ where: { id: ids }, order: [["sortTitle", "ASC"], ["seasonNumber", "ASC"], ["episodeNumber", "ASC"]] });
    const shows = new Map<number, MediaItem | null>();
    for (const item of items) shows.set(item.id, item.type === "episode" ? await ItemLabels.showOf(item) : null);

    if (firstScan) {
      const count = library.type === "shows" ? new Set([...shows.values()].map((s) => s?.id)).size : items.length;
      const nouns = { movies: ["movie", "movies"], shows: ["show", "shows"], videos: ["video", "videos"] }[library.type];
      const noun = nouns[count === 1 ? 0 : 1];
      Events.activity({ kind: "added", message: `${library.name} is ready, with ${count} ${noun}` });
      return;
    }

    const ref = { id: library.id, name: library.name };
    for (const item of items) Events.emit("item.added", { library: ref, item: await ItemLabels.forWebhook(item, shows.get(item.id)) });

    if (library.type === "videos") {
      const byFolder = new Map<number | null, MediaItem[]>();
      for (const item of items) byFolder.set(item.parentId, [...byFolder.get(item.parentId) ?? [], item]);
      for (const [folderId, videos] of byFolder) {
        const folder = folderId ? await MediaItem.findByPk(folderId, { attributes: ["id", "title"] }) : null;
        const place = folder ? `${folder.title} in ${library.name}` : library.name;
        const message = videos.length === 1 ? `${videos[0].title} was added to ${place}` : `${videos.length} videos were added to ${place}`;
        Events.activity({ kind: "added", message, itemId: videos.length === 1 ? videos[0].id : folder?.id ?? null });
      }
      return;
    }

    if (library.type === "movies") {
      if (items.length > ACTIVITY_GROUP_OVER) {
        Events.activity({ kind: "added", message: `${items.length} movies were added to ${library.name}` });
        return;
      }
      for (const item of items) Events.activity({ kind: "added", message: `${item.title} was added to ${library.name}`, itemId: item.id });
      return;
    }

    const byShow = new Map<number, MediaItem[]>();
    for (const item of items) {
      const show = shows.get(item.id);
      if (show) byShow.set(show.id, [...byShow.get(show.id) ?? [], item]);
    }
    for (const episodes of byShow.values()) {
      const show = shows.get(episodes[0].id)!;
      const message = episodes.length === 1
        ? `${show.title} ${ItemLabels.episodeCode(episodes[0])} was added to ${library.name}`
        : `${episodes.length} episodes of ${show.title} were added to ${library.name}`;
      Events.activity({ kind: "added", message, itemId: episodes.length === 1 ? episodes[0].id : show.id });
    }
  }

  /**
   * Details for new movies and shows (or all of them, when asked), from the metadata providers.
   */
  async function refreshMetadata(library: Library, task: Tasks.Handle, opts: ScanOptions) {
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
    return top.length;
  }

  /**
   * Details and thumbnails for new videos (or all of them, when asked), then every folder's summary of its videos.
   */
  async function refreshVideos(library: Library, task: Tasks.Handle, opts: ScanOptions) {
    const videos = await MediaItem.findAll({ where: { libraryId: library.id, type: "video", ...(opts.refreshMetadata ? {} : { metadataUpdatedAt: null }) } });
    let done = 0;
    await forEachLimit(videos, METADATA_CONCURRENCY, async (video) => {
      task.update("Making thumbnails", done / videos.length);
      try {
        await VideoDetails.refreshVideo(video, { regenerate: opts.refreshMetadata, library });
      } catch (error) {
        log.warn(`Could not read details of "${video.title}"`, { error });
      }
      done++;
    });
    await VideoDetails.refreshFolders(library);
    return videos.length;
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
   * in the library root) are versions of one movie. Returns the new movies.
   */
  async function assignMovies(library: Library, roots: Map<string, string>) {
    const added: number[] = [];
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
        added.push(itemId);
      }
      await file.update({ itemId });
    }
    return added;
  }

  /**
   * Sort episode files into shows, seasons and episodes, creating whatever is new. Returns the new episodes.
   */
  async function assignEpisodes(library: Library, roots: Map<string, string>) {
    const added: number[] = [];
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
        added.push(episode.id);
      }
      await file.update({ itemId: episode.id });
    }
    return added;
  }

  /**
   * Every file in a Videos library is its own video. The folders holding them become folder items, nested like on
   * disk; files in a library folder itself have no folder. Returns the new videos.
   */
  async function assignVideos(library: Library, roots: Map<string, string>) {
    const added: number[] = [];
    const folders = new Map((await MediaItem.findAll({ where: { libraryId: library.id, type: "folder" } })).map((f) => [f.folderPath!, f.id]));

    async function folderFor(dir: string, root: string): Promise<number | null> {
      if (!isInside(dir, root) || Path.resolve(dir) === Path.resolve(root)) return null;
      const known = folders.get(dir);
      if (known) return known;
      const parentId = await folderFor(Path.dirname(dir), root);
      const folder = MediaItem.build({ libraryId: library.id, parentId, type: "folder", folderPath: dir, title: "", sortTitle: "", matchStatus: "matched" });
      folder.setTitle(Path.basename(dir));
      await folder.save();
      folders.set(dir, folder.id);
      return folder.id;
    }

    for (const file of await MediaFile.findAll({ where: { libraryId: library.id, itemId: null } })) {
      const dir = Path.dirname(file.path);
      const parentId = await folderFor(dir, roots.get(file.path) ?? library.paths[0]);
      const video = MediaItem.build({ libraryId: library.id, parentId, type: "video", folderPath: dir, title: "", sortTitle: "", matchStatus: "matched" });
      video.setTitle(VideoDetails.titleFromFile(file.path));
      await video.save();
      await file.update({ itemId: video.id });
      added.push(video.id);
    }
    return added;
  }

  /**
   * Remove movies, episodes and videos whose files are all gone, then seasons, shows and folders left empty.
   */
  async function removeEmptyItems(library: Library) {
    const withFiles = new Set((await MediaFile.findAll({ where: { libraryId: library.id, itemId: { [Op.ne]: null } }, attributes: ["itemId"] })).map((f) => f.itemId!));
    const playable = await MediaItem.findAll({ where: { libraryId: library.id, type: ["movie", "episode", "video"] }, attributes: ["id"] });
    const orphans = playable.filter((i) => !withFiles.has(i.id)).map((i) => i.id);
    if (orphans.length) await MediaItem.destroy({ where: { id: orphans } });

    for (const type of ["season", "show"] as const) {
      const parents = await MediaItem.findAll({ where: { libraryId: library.id, type }, attributes: ["id"] });
      for (const parent of parents) {
        if (await MediaItem.count({ where: { parentId: parent.id } }) === 0) await parent.destroy();
      }
    }

    // Folders nest, so emptying one can empty the folder above it
    let emptied = true;
    while (emptied) {
      emptied = false;
      for (const folder of await MediaItem.findAll({ where: { libraryId: library.id, type: "folder" }, attributes: ["id"] })) {
        if (await MediaItem.count({ where: { parentId: folder.id } }) > 0) continue;
        await folder.destroy();
        emptied = true;
      }
    }

    for (const collection of await Collection.findAll({ where: { libraryId: library.id }, attributes: ["id"] })) {
      if (await MediaItem.count({ where: { collectionId: collection.id } }) === 0) await collection.destroy();
    }
  }
}

export default Scanner;
