import Path from "node:path";
import { col, fn, Op } from "sequelize";
import type { BrokenFile, DuplicateGroup, SpaceUsage, UpkeepFile, UpkeepItemRef, UpkeepOverview } from "@shared/upkeep.ts";
import { Library, MediaFile, MediaItem } from "../models/index.ts";
import ItemLabels from "./ItemLabels.ts";
import SystemStats from "../lib/SystemStats.ts";
import Tasks from "../lib/Tasks.ts";

/**
 * What the upkeep page shows: where the space goes, the same title more than once, and broken files.
 */
export namespace Upkeep {
  const BIGGEST = 20;

  function resolution(height: number | null, width: number | null) {
    if (!height) return null;
    // Wide films are short for their class, so the width decides too
    if (height >= 2000 || (width ?? 0) >= 3800) return "4K";
    if (height >= 1000 || (width ?? 0) >= 1900) return "1080p";
    if (height >= 700 || (width ?? 0) >= 1200) return "720p";
    return `${height}p`;
  }

  export function fileInfo(file: MediaFile): UpkeepFile {
    return {
      id: file.id,
      path: file.path,
      size: Number(file.size),
      resolution: resolution(file.height, file.width),
      videoCodec: file.videoCodec,
      hdr: file.hdr,
      bitrate: file.bitrate,
      duration: file.duration,
      modifiedAt: new Date(Number(file.mtime)).toISOString(),
      problem: file.problem,
    };
  }

  /**
   * Short descriptions of items, with the library names, for lists.
   */
  async function refs(items: MediaItem[]): Promise<Map<number, UpkeepItemRef>> {
    const libraries = new Map((await Library.findAll({ attributes: ["id", "name"] })).map((l) => [l.id, l.name]));
    const result = new Map<number, UpkeepItemRef>();
    for (const item of items) {
      const label = await ItemLabels.describe(item);
      result.set(item.id, { id: item.id, title: label.title, type: item.type, image: label.poster ?? item.artwork.thumb, libraryName: libraries.get(item.libraryId) ?? "" });
    }
    return result;
  }

  export async function space(): Promise<SpaceUsage> {
    const libraries = await Library.findAll({ order: [["id", "ASC"]] });
    const perLibrary = new Map((await MediaFile.findAll({
      attributes: ["libraryId", [fn("SUM", col("size")), "size"], [fn("COUNT", col("id")), "files"]],
      group: ["libraryId"],
      raw: true,
    }) as unknown as { libraryId: number; size: number; files: number }[]).map((r) => [r.libraryId, r]));

    // Extensions come from the paths; one pass over every file's path and size
    const types = new Map<string, { size: number; files: number }>();
    for (const row of await MediaFile.findAll({ attributes: ["path", "size"], raw: true }) as unknown as { path: string; size: number }[]) {
      const type = Path.extname(row.path).slice(1).toLowerCase() || "other";
      const entry = types.get(type) ?? { size: 0, files: 0 };
      entry.size += Number(row.size);
      entry.files++;
      types.set(type, entry);
    }

    // Shows: episodes → seasons → shows
    const episodeSizes = await MediaFile.findAll({
      attributes: ["itemId", [fn("SUM", col("size")), "size"], [fn("COUNT", col("id")), "files"]],
      where: { libraryId: libraries.filter((l) => l.type === "shows").map((l) => l.id), itemId: { [Op.ne]: null } },
      group: ["itemId"],
      raw: true,
    }) as unknown as { itemId: number; size: number; files: number }[];
    const episodes = episodeSizes.length ? await MediaItem.findAll({ where: { id: episodeSizes.map((e) => e.itemId), type: "episode" }, attributes: ["id", "parentId"] }) : [];
    const seasons = episodes.length ? await MediaItem.findAll({ where: { id: [...new Set(episodes.map((e) => e.parentId!))] }, attributes: ["id", "parentId"] }) : [];
    const showOfSeason = new Map(seasons.map((s) => [s.id, s.parentId!]));
    const showOfEpisode = new Map(episodes.map((e) => [e.id, showOfSeason.get(e.parentId!)]));
    const showTotals = new Map<number, { size: number; files: number }>();
    for (const row of episodeSizes) {
      const show = showOfEpisode.get(row.itemId);
      if (!show) continue;
      const entry = showTotals.get(show) ?? { size: 0, files: 0 };
      entry.size += Number(row.size);
      entry.files += Number(row.files);
      showTotals.set(show, entry);
    }
    const topShows = [...showTotals].sort((a, b) => b[1].size - a[1].size).slice(0, BIGGEST);
    const showItems = topShows.length ? await MediaItem.findAll({ where: { id: topShows.map(([id]) => id) } }) : [];
    const showRefs = await refs(showItems);

    const biggestFiles = await MediaFile.findAll({ order: [["size", "DESC"]], limit: BIGGEST });
    const biggestItems = await MediaItem.findAll({ where: { id: biggestFiles.map((f) => f.itemId).filter((id): id is number => id !== null) } });
    const biggestRefs = await refs(biggestItems);

    const free = new Map<number, number | null>();
    for (const library of libraries) free.set(library.id, library.paths[0] ? await SystemStats.freeSpace(library.paths[0]) : null);

    return {
      total: [...perLibrary.values()].reduce((sum, r) => sum + Number(r.size), 0),
      libraries: libraries.map((l) => ({ id: l.id, name: l.name, type: l.type, size: Number(perLibrary.get(l.id)?.size ?? 0), files: Number(perLibrary.get(l.id)?.files ?? 0), free: free.get(l.id) ?? null })),
      types: [...types].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.size - a.size),
      shows: topShows.filter(([id]) => showRefs.has(id)).map(([id, v]) => ({ item: showRefs.get(id)!, ...v })),
      biggest: biggestFiles.map((file) => ({ item: file.itemId !== null ? biggestRefs.get(file.itemId) ?? null : null, file: fileInfo(file) })),
    };
  }

  /**
   * Movies and episodes with more than one file, and movies or shows that are in the libraries twice (the same TMDB,
   * TheTVDB or IMDb id on two titles).
   */
  async function duplicates(): Promise<DuplicateGroup[]> {
    const groups: DuplicateGroup[] = [];
    const multi = await MediaFile.findAll({
      attributes: ["itemId", [fn("COUNT", col("id")), "files"]],
      where: { itemId: { [Op.ne]: null } },
      group: ["itemId"],
      having: { files: { [Op.gt]: 1 } },
      raw: true,
    }) as unknown as { itemId: number }[];
    const multiItems = multi.length ? await MediaItem.findAll({ where: { id: multi.map((m) => m.itemId), type: ["movie", "episode"] } }) : [];

    // The same title twice, by its ids
    const titles = await MediaItem.findAll({ where: { type: ["movie", "show"] }, attributes: ["id", "type", "title", "externalIds", "libraryId", "parentId", "artwork", "seasonNumber", "episodeNumber"] });
    const byKey = new Map<string, MediaItem[]>();
    for (const title of titles) {
      const ids = title.externalIds;
      const key = ids.tmdb ? `${title.type}:tmdb:${ids.tmdb}` : ids.tvdb ? `${title.type}:tvdb:${ids.tvdb}` : ids.imdb ? `imdb:${ids.imdb}` : null;
      if (key) byKey.set(key, [...byKey.get(key) ?? [], title]);
    }
    const twice = [...byKey].filter(([, items]) => items.length > 1);

    const all = [...multiItems, ...twice.flatMap(([, items]) => items)];
    const ref = await refs(all);
    const filesOf = async (ids: number[]) => await MediaFile.findAll({ where: { itemId: ids }, order: [["size", "DESC"]] });

    for (const item of multiItems) {
      const files = await filesOf([item.id]);
      groups.push({ key: `item:${item.id}`, title: ref.get(item.id)!.title, copies: files.map((f) => ({ item: ref.get(item.id)!, file: fileInfo(f) })), extra: files.slice(1).reduce((sum, f) => sum + Number(f.size), 0) });
    }
    for (const [key, items] of twice) {
      if (items[0].type === "movie") {
        const files = await filesOf(items.map((i) => i.id));
        groups.push({ key, title: items[0].title, copies: files.map((f) => ({ item: ref.get(f.itemId!)!, file: fileInfo(f) })), extra: files.slice(1).reduce((sum, f) => sum + Number(f.size), 0) });
      }
      else {
        // A show twice: compare the shows, not every episode
        groups.push({ key, title: items[0].title, copies: [], extra: 0 });
        const last = groups[groups.length - 1];
        for (const show of items) {
          const seasonIds = (await MediaItem.findAll({ where: { parentId: show.id }, attributes: ["id"] })).map((s) => s.id);
          const episodeIds = seasonIds.length ? (await MediaItem.findAll({ where: { parentId: seasonIds }, attributes: ["id"] })).map((e) => e.id) : [];
          const files = episodeIds.length ? await MediaFile.findAll({ where: { itemId: episodeIds } }) : [];
          const size = files.reduce((sum, f) => sum + Number(f.size), 0);
          const first = files[0];
          if (first) last.copies.push({ item: ref.get(show.id)!, file: { ...fileInfo(first), path: Path.dirname(Path.dirname(first.path)), size, duration: null } });
        }
        last.extra = last.copies.slice(1).reduce((sum, c) => sum + c.file.size, 0);
        if (last.copies.length < 2) groups.pop();
      }
    }
    return groups.sort((a, b) => b.extra - a.extra);
  }

  async function broken(): Promise<BrokenFile[]> {
    const files = await MediaFile.findAll({ where: { problem: { [Op.ne]: null } }, order: [["path", "ASC"]], limit: 500 });
    const items = await MediaItem.findAll({ where: { id: files.map((f) => f.itemId).filter((id): id is number => id !== null) } });
    const ref = await refs(items);
    return files.map((file) => ({ item: file.itemId !== null ? ref.get(file.itemId) ?? null : null, file: fileInfo(file) }));
  }

  export async function overview(canDelete: boolean): Promise<UpkeepOverview> {
    const running = Tasks.list().find((t) => t.id.startsWith("check-files-"));
    return {
      duplicates: await duplicates(),
      broken: await broken(),
      unchecked: await MediaFile.count({ where: { checkedAt: null } }),
      checking: running ? { status: running.status, progress: running.progress } : null,
      canDelete,
    };
  }
}

export default Upkeep;
