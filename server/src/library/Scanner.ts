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
import Watchlist from "./Watchlist.ts";
import Notifications from "../notifications/Notifications.ts";
import VideoDetails from "./VideoDetails.ts";
import MusicLibrary from "../music/MusicLibrary.ts";
import MusicTags from "../music/MusicTags.ts";
import BookLibrary from "../books/BookLibrary.ts";
import PhotoLibrary from "../photos/PhotoLibrary.ts";
import ClipLibrary from "../clips/ClipLibrary.ts";
import Recognition from "../clips/Recognition.ts";
import SubtitleAutomation from "../subtitles/SubtitleAutomation.ts";
import Events from "../integrations/Events.ts";
import Tasks from "../lib/Tasks.ts";
import { forEachLimit } from "../lib/async.ts";
import log from "../lib/Logger.ts";

/**
 * Finds the video, music, book or photo files in a library, works out what they are, and keeps the database in step
 * with the disk. Unchanged files (same size and modification time) are skipped, so rescans are cheap.
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

  /**
   * What a library looks for: movies and episodes (skipping extras and samples), any video, audio (music and
   * audiobooks), EPUB and PDF books, or pictures and videos.
   */
  type WalkMode = "titles" | "videos" | "audio" | "books" | "photos";

  function walkMode(library: Library): WalkMode {
    return ({ movies: "titles", shows: "titles", videos: "videos", music: "audio", audiobooks: "audio", books: "books", photos: "photos", clips: "videos" } as const)[library.type];
  }

  // Folders NAS systems fill with their own thumbnails and deleted files, which would show up as photos
  const SYSTEM_FOLDERS = new Set(["@eadir", "#recycle", "#snapshot", "@recycle", "$recycle.bin", "lost+found"]);

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
   * Scan some folders of a library now, through the scan queue so it never runs at the same time as another scan,
   * and wait for it. For files Cinemion just put there itself, like a cut clip or an upload.
   */
  export async function scanFoldersNow(library: Library, folders: string[]) {
    await Tasks.run(`scan-folders:${library.id}:${Date.now()}`, "Scanning changed folders", { libraryId: library.id, queue: "scan" }, async (task) => {
      await scanLibrary(library, task, { folders });
    });
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
   * Every video or music file under `start` (default `root`), following symlinked folders but never looping.
   * @param mode `videos` keeps extras, trailers and samples, which are just videos in a Videos library.
   */
  async function walk(root: string, start = root, mode: WalkMode = "titles"): Promise<FoundFile[]> {
    const found: FoundFile[] = [];
    const visited = new Set<string>();
    const anyFile = mode !== "titles";
    const shouldSkip = (relative: string) => anyFile ? relative.split(/[\\/]/).some((p) => p.startsWith(".") || SYSTEM_FOLDERS.has(p.toLowerCase())) : NameParser.shouldSkip(relative);
    const wanted = mode === "audio" ? MusicTags.isAudio : mode === "books" ? BookLibrary.isEbook : mode === "photos" ? PhotoLibrary.isPhotoOrVideo : NameParser.isVideo;

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
        if (!wanted(entry.name) || shouldSkip(Path.relative(root, full))) continue;
        const info = stat ?? await fsp.stat(full).catch(() => null);
        if (!info?.isFile()) continue;
        if (!anyFile && /sample/i.test(entry.name) && info.size < SAMPLE_MAX_BYTES) continue;
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
      for (const start of scope) found.push(...await walk(library.paths.find((p) => isInside(start, p))!, start, walkMode(library)));
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
        found.push(...await walk(root, root, walkMode(library)));
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
        // A changed file may have different subtitles, so automatic searches start over too
        await existing.update({ size: file.size, mtime: file.mtime, probedAt: null, markersVersion: 0, subtitleSearches: null, sha256: null });
      }
    }

    // Read the files ffprobe hasn't seen yet. EPUB and PDF books aren't media, so they're read later; pictures have
    // their EXIF read instead.
    const isMusic = library.type === "music";
    const isPhotos = library.type === "photos";
    const isClips = library.type === "clips";
    const hasVideo = library.type === "movies" || library.type === "shows" || library.type === "videos" || isClips;
    const toProbe = await MediaFile.findAll({ where: { libraryId: library.id, probedAt: null } });
    let probed = 0;
    await forEachLimit(toProbe, PROBE_CONCURRENCY, async (file) => {
      task.update("Reading files", probed / toProbe.length);
      try {
        if (library.type === "books") {
          await file.update({ container: Path.extname(file.path).slice(1).toLowerCase(), probedAt: new Date() });
          probed++;
          return;
        }
        if (isPhotos && PhotoLibrary.isImage(file.path)) {
          await PhotoLibrary.readFile(file);
          probed++;
          return;
        }
        const { tags, chapters, ...details } = await Probe.read(file.path);
        // Clips keep their tags, since some recorders write the game into them
        await file.update({ ...details, tags: (hasVideo && !isClips) || isPhotos ? null : tags, chapters: library.type === "audiobooks" ? chapters : null, probedAt: new Date() });
      } catch (error) {
        log.warn(`Could not read ${file.path}`, { error });
        await file.update({ probedAt: new Date() });
      }
      probed++;
    });

    // Subtitle files come and go without the video changing, so look for them every scan
    task.update("Looking for subtitles");
    for (const file of hasVideo ? await MediaFile.findAll({ where: { libraryId: library.id } }) : []) {
      if (!inScope(file.path)) continue;
      await Sidecars.refresh(file).catch((error) => log.warn(`Could not look for subtitles of ${file.path}`, { error }));
    }

    task.update("Sorting files");
    const roots = new Map(found.map((f) => [f.path, f.root]));
    const isBooks = library.type === "audiobooks" || library.type === "books";
    let added: number[];
    if (isMusic) added = await MusicLibrary.assign(library, roots, new Set(toProbe.map((f) => f.id)));
    else if (isBooks) added = await BookLibrary.assign(library, roots);
    else if (library.type === "movies") added = await assignMovies(library, roots);
    else if (library.type === "videos" || isPhotos) added = await assignVideos(library, roots);
    else if (isClips) added = await ClipLibrary.assign(library, roots);
    else added = await assignEpisodes(library, roots);
    if (isMusic) await MusicLibrary.removeEmpty(library);
    else if (isBooks) await BookLibrary.removeEmpty(library);
    else await removeEmptyItems(library);
    if (isClips) await ClipLibrary.removeEmptyGames(library);

    let refreshed: number;
    if (isMusic) refreshed = await MusicLibrary.refresh(library, task, { regenerate: opts.refreshMetadata });
    else if (isBooks) refreshed = await BookLibrary.refresh(library, task, { regenerate: opts.refreshMetadata });
    else if (library.type === "videos") refreshed = await refreshVideos(library, task, opts);
    else if (isPhotos) refreshed = await refreshPhotos(library, task, opts, toProbe.map((f) => f.itemId).filter((id): id is number => id !== null));
    else if (isClips) refreshed = await ClipLibrary.refresh(library, task, { regenerate: opts.refreshMetadata });
    else refreshed = await refreshMetadata(library, task, opts);

    // Only a full scan counts for the schedule
    if (!scope) {
      library.lastScannedAt = new Date();
      await library.save();
    }
    await Trickplay.cleanup().catch((error) => log.warn("Could not clean up seek thumbnails", { error }));
    if (hasVideo) {
      Trickplay.queueLibrary(library.id);
      // Clips have no intros or credits to find
      if (!isClips) Markers.queueLibrary(library.id);
    }
    // Videos in Photos libraries get seek thumbnails too; there are no intros to find in them
    if (isPhotos) {
      Trickplay.queueLibrary(library.id);
      await PhotoLibrary.cleanup().catch((error) => log.warn("Could not clean up photo copies", { error }));
    }
    await reportAdded(library, added, firstScan).catch((error) => log.warn("Could not report new titles", { error }));
    if (isClips && await Recognition.shouldRunAfterScan(library)) Recognition.queue(library.id).catch(() => { });
    if (added.length && (library.type === "movies" || library.type === "shows")) SubtitleAutomation.queue({ libraryId: library.id }).catch(() => { });
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

    // Titles on someone's list that weren't here yet, also when a whole new library brought them
    if (library.type === "movies" || library.type === "shows") {
      const titles = [...items.filter((i) => i.type === "movie"), ...new Map([...shows.values()].filter((s): s is MediaItem => !!s).map((s) => [s.id, s])).values()];
      await Watchlist.arrived(titles).catch((error) => log.warn("Could not check the watchlists for new titles", { error }));
    }
    if (!firstScan) await Notifications.itemsAdded(library, items, shows).catch((error) => log.warn("Could not make notifications for new titles", { error }));

    if (library.type === "photos") {
      reportPhotos(library, items, firstScan);
      return;
    }
    if (firstScan) {
      const count = library.type === "shows" ? new Set([...shows.values()].map((s) => s?.id)).size : library.type === "music" ? new Set(items.map((i) => i.parentId)).size : items.length;
      const nouns = { movies: ["movie", "movies"], shows: ["show", "shows"], videos: ["video", "videos"], music: ["album", "albums"], audiobooks: ["audiobook", "audiobooks"], books: ["book", "books"], photos: ["photo", "photos"], clips: ["clip", "clips"] }[library.type];
      const noun = nouns[count === 1 ? 0 : 1];
      Events.activity({ kind: "added", message: `${library.name} is ready, with ${count} ${noun}` });
      return;
    }

    const ref = { id: library.id, name: library.name };
    if (library.type === "music") {
      // One line and one webhook per album, not per track
      const byAlbum = new Map<number, MediaItem[]>();
      for (const item of items) if (item.parentId) byAlbum.set(item.parentId, [...byAlbum.get(item.parentId) ?? [], item]);
      for (const [albumId, tracks] of byAlbum) {
        const album = await MediaItem.findByPk(albumId);
        if (!album) continue;
        const artist = album.parentId ? await MediaItem.findByPk(album.parentId, { attributes: ["title"] }) : null;
        Events.emit("item.added", { library: ref, item: await ItemLabels.forWebhook(album) });
        const what = `${album.title}${artist ? ` by ${artist.title}` : ""}`;
        const message = tracks.length === 1 ? `${tracks[0].title} from ${what} was added to ${library.name}` : `${what} was added to ${library.name}`;
        Events.activity({ kind: "added", message, itemId: album.id });
      }
      return;
    }
    for (const item of items) Events.emit("item.added", { library: ref, item: await ItemLabels.forWebhook(item, shows.get(item.id)) });

    if (library.type === "clips") {
      await reportClips(library, items);
      return;
    }

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

    if (library.type === "movies" || library.type === "audiobooks" || library.type === "books") {
      if (items.length > ACTIVITY_GROUP_OVER) {
        Events.activity({ kind: "added", message: `${items.length} ${{ movies: "movies", audiobooks: "audiobooks", books: "books" }[library.type]} were added to ${library.name}` });
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
   * One activity line per game that got new clips: "Counter-Strike 2 has 3 new clips in Clips".
   */
  async function reportClips(library: Library, clips: MediaItem[]) {
    const byGame = new Map<number | null, MediaItem[]>();
    for (const clip of clips) byGame.set(clip.parentId, [...byGame.get(clip.parentId) ?? [], clip]);
    for (const [gameId, list] of byGame) {
      const game = gameId ? await MediaItem.findByPk(gameId, { attributes: ["id", "title"] }) : null;
      const what = list.length === 1 ? "A clip" : `${list.length} clips`;
      const message = game ? `${what} of ${game.title} ${list.length === 1 ? "was" : "were"} added to ${library.name}` : `${what} ${list.length === 1 ? "was" : "were"} added to ${library.name}`;
      Events.activity({ kind: "added", message, itemId: list.length === 1 ? list[0].id : game?.id ?? null });
    }
  }

  /**
   * One activity line per folder that got new photos and videos, or one for the whole library on its first scan.
   * Photos come in hundreds, so they don't send a webhook each.
   */
  function reportPhotos(library: Library, items: MediaItem[], firstScan: boolean) {
    const describe = (list: MediaItem[]) => {
      const photos = list.filter((i) => i.type === "photo").length;
      const videos = list.length - photos;
      return [photos ? `${photos} ${photos === 1 ? "photo" : "photos"}` : null, videos ? `${videos} ${videos === 1 ? "video" : "videos"}` : null].filter(Boolean).join(" and ");
    };
    if (firstScan) {
      Events.activity({ kind: "added", message: `${library.name} is ready, with ${describe(items)}` });
      return;
    }
    const byFolder = new Map<number | null, MediaItem[]>();
    for (const item of items) byFolder.set(item.parentId, [...byFolder.get(item.parentId) ?? [], item]);
    (async () => {
      for (const [folderId, list] of byFolder) {
        const folder = folderId ? await MediaItem.findByPk(folderId, { attributes: ["id", "title"] }) : null;
        const place = folder ? `${folder.title} in ${library.name}` : library.name;
        const verb = list.length === 1 ? "was" : "were";
        Events.activity({ kind: "added", message: `${describe(list)} ${verb} added to ${place}`, itemId: folder?.id ?? null });
      }
    })().catch((error) => log.warn("Could not report new photos", { error }));
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
   * Dates and thumbnails for new photos and videos in a Photos library, and for ones whose file changed (or all of
   * them, when asked), then every folder's summary.
   * @param changed Items whose file was read again in this scan.
   */
  async function refreshPhotos(library: Library, task: Tasks.Handle, opts: ScanOptions, changed: number[]) {
    const where = opts.refreshMetadata ? {} : { [Op.or]: [{ metadataUpdatedAt: null }, ...(changed.length ? [{ id: changed }] : [])] };
    const items = await MediaItem.findAll({ where: { [Op.and]: [{ libraryId: library.id, type: ["photo", "video"] }, where] } });
    let done = 0;
    await forEachLimit(items, METADATA_CONCURRENCY, async (item) => {
      task.update("Making thumbnails", done / items.length);
      try {
        if (item.type === "photo") await PhotoLibrary.refreshPhoto(item, { regenerate: opts.refreshMetadata, library });
        else await PhotoLibrary.refreshVideo(item, { regenerate: opts.refreshMetadata, library });
      } catch (error) {
        log.warn(`Could not read details of "${item.title}"`, { error });
      }
      done++;
    });
    await VideoDetails.refreshFolders(library);
    return items.length;
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
   * Every file in a Videos or Photos library is its own video or photo. The folders holding them become folder
   * items, nested like on disk; files in a library folder itself have no folder. Returns the new videos and photos.
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
      const type = library.type === "photos" && PhotoLibrary.isImage(file.path) ? "photo" : "video";
      const video = MediaItem.build({ libraryId: library.id, parentId, type, folderPath: dir, title: "", sortTitle: "", matchStatus: "matched" });
      video.setTitle(VideoDetails.titleFromFile(file.path));
      await video.save();
      await file.update({ itemId: video.id });
      added.push(video.id);
    }
    return added;
  }

  /**
   * Remove movies, episodes, videos and photos whose files are all gone, then seasons, shows and folders left empty.
   */
  async function removeEmptyItems(library: Library) {
    const withFiles = new Set((await MediaFile.findAll({ where: { libraryId: library.id, itemId: { [Op.ne]: null } }, attributes: ["itemId"] })).map((f) => f.itemId!));
    const playable = await MediaItem.findAll({ where: { libraryId: library.id, type: ["movie", "episode", "video", "photo"] }, attributes: ["id"] });
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
