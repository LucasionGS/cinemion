import { col, fn } from "sequelize";
import { isPlayable, type ItemSummary, type UserData } from "@shared/media.ts";
import type { ClipExtras } from "@shared/clips.ts";
import { MediaFile, MediaItem, type User, WatchState } from "../models/index.ts";
import FolderTree from "./FolderTree.ts";
import Visibility from "./Visibility.ts";

/**
 * Builds `ItemSummary` lists with everything an item doesn't know by itself, loaded in a few batched queries:
 * child counts, the profile's progress, the show a season or episode belongs to, and the game of a clip.
 */
export namespace Summaries {
  /**
   * Number of children (seasons of shows, episodes of seasons, clips of games) per id.
   */
  export async function childCounts(ids: number[]) {
    if (ids.length === 0) return new Map<number, number>();
    const rows = await MediaItem.findAll({
      attributes: ["parentId", [fn("COUNT", col("id")), "count"]],
      where: { parentId: ids },
      group: ["parentId"],
      raw: true,
    }) as unknown as { parentId: number; count: number }[];
    return new Map(rows.map((r) => [r.parentId, Number(r.count)]));
  }

  /**
   * The videos inside each folder in `items`, subfolders included, that `user` may see.
   */
  export async function folderVideos(items: MediaItem[], user: User | null) {
    const result = new Map<number, number[]>();
    const folders = items.filter((i) => i.type === "folder");
    if (folders.length === 0) return result;
    const tree = await FolderTree.load(folders.map((f) => f.libraryId));
    for (const folder of folders) {
      result.set(folder.id, tree.videosUnder(folder.id).filter((v) => !user || Visibility.canSee(user, v)).map((v) => v.id));
    }
    return result;
  }

  /**
   * The show each season or episode belongs to.
   */
  async function shows(items: MediaItem[]) {
    const result = new Map<number, { id: number; title: string }>();
    const seasonIds = new Set<number>();
    for (const item of items) {
      if (item.type === "season" && item.parentId) seasonIds.add(item.id);
      if (item.type === "episode" && item.parentId) seasonIds.add(item.parentId);
    }
    if (seasonIds.size === 0) return result;

    const seasons = await MediaItem.findAll({ where: { id: [...seasonIds] }, attributes: ["id", "parentId"] });
    const showIds = [...new Set(seasons.map((s) => s.parentId).filter((id): id is number => id !== null))];
    const showRows = await MediaItem.findAll({ where: { id: showIds }, attributes: ["id", "title"] });
    const showById = new Map(showRows.map((s) => [s.id, { id: s.id, title: s.title }]));
    const showBySeason = new Map(seasons.map((s) => [s.id, s.parentId ? showById.get(s.parentId) : undefined]));

    for (const item of items) {
      const show = item.type === "season" ? showBySeason.get(item.id) : item.type === "episode" && item.parentId ? showBySeason.get(item.parentId) : undefined;
      if (show) result.set(item.id, show);
    }
    return result;
  }

  /**
   * What lists show about clips: their game and when they were recorded.
   */
  async function clips(items: MediaItem[]) {
    const result = new Map<number, ClipExtras>();
    const list = items.filter((i) => i.type === "video" && i.clip);
    if (list.length === 0) return result;
    const gameIds = [...new Set(list.map((c) => c.parentId).filter((id): id is number => id !== null))];
    const games = gameIds.length ? await MediaItem.findAll({ where: { id: gameIds, type: "game" }, attributes: ["id", "title"] }) : [];
    const byId = new Map(games.map((g) => [g.id, { id: g.id, title: g.title }]));
    const seconds = new Map((await MediaFile.findAll({ where: { itemId: list.map((c) => c.id) }, attributes: ["itemId", "duration"] })).map((f) => [f.itemId, f.duration]));
    for (const clip of list) {
      result.set(clip.id, {
        game: clip.parentId ? byId.get(clip.parentId) ?? null : null,
        takenAt: clip.takenAt,
        seconds: seconds.get(clip.id) ?? null,
        titled: clip.clip!.titled || !!clip.editedAt,
        found: clip.clip!.found,
        suggestion: clip.clip!.suggestion,
      });
    }
    return result;
  }

  /**
   * The profile's progress per item. Shows and seasons count their episodes, folders every video inside them.
   * @param folderVideos The videos in each folder of `items` this profile may see, from `folderVideos()`.
   */
  export async function userData(items: MediaItem[], userId: number, folderVideos?: Map<number, number[]>) {
    const result = new Map<number, UserData>();
    const leafIds = items.filter((i) => isPlayable(i.type)).map((i) => i.id);

    // Episodes under each show and season in the list
    const episodesOf = new Map<number, number[]>();
    const seasonIdsByShow = new Map<number, number[]>();
    const showIds = items.filter((i) => i.type === "show").map((i) => i.id);
    if (showIds.length) {
      for (const season of await MediaItem.findAll({ where: { parentId: showIds, type: "season" }, attributes: ["id", "parentId"] })) {
        seasonIdsByShow.set(season.parentId!, [...seasonIdsByShow.get(season.parentId!) ?? [], season.id]);
      }
    }
    const seasonIds = [...items.filter((i) => i.type === "season").map((i) => i.id), ...[...seasonIdsByShow.values()].flat()];
    if (seasonIds.length) {
      for (const episode of await MediaItem.findAll({ where: { parentId: seasonIds, type: "episode" }, attributes: ["id", "parentId"] })) {
        episodesOf.set(episode.parentId!, [...episodesOf.get(episode.parentId!) ?? [], episode.id]);
      }
    }
    for (const [showId, seasons] of seasonIdsByShow) episodesOf.set(showId, seasons.flatMap((s) => episodesOf.get(s) ?? []));
    // Folders work like shows, with their videos as the episodes
    for (const [folderId, videos] of folderVideos ?? []) episodesOf.set(folderId, videos);

    const allIds = [...new Set([...leafIds, ...[...episodesOf.values()].flat()])];
    const states = allIds.length ? await WatchState.findAll({ where: { userId, itemId: allIds } }) : [];
    const stateById = new Map(states.map((s) => [s.itemId, s]));

    for (const item of items) {
      if (isPlayable(item.type)) {
        const state = stateById.get(item.id);
        const duration = state?.duration ?? (item.runtime ? item.runtime * 60 : null);
        result.set(item.id, {
          watched: state?.watched ?? false,
          position: state?.position ?? 0,
          progress: state && duration && state.position ? Math.min(1, state.position / duration) : null,
          unwatchedCount: null,
          lastWatchedAt: state?.lastWatchedAt?.toISOString() ?? null,
          favorite: state?.favorite ?? false,
        });
      }
      else {
        const episodes = episodesOf.get(item.id) ?? [];
        const watched = episodes.filter((id) => stateById.get(id)?.watched).length;
        const last = episodes.map((id) => stateById.get(id)?.lastWatchedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
        result.set(item.id, {
          watched: episodes.length > 0 && watched === episodes.length,
          position: 0,
          progress: episodes.length ? watched / episodes.length : null,
          unwatchedCount: episodes.length - watched,
          lastWatchedAt: last ? new Date(last).toISOString() : null,
          favorite: false,
        });
      }
    }
    return result;
  }

  /**
   * Summaries for `items`, in the same order, with the signed-in profile's progress when `user` is given.
   */
  export async function build(items: MediaItem[], user: User | null): Promise<ItemSummary[]> {
    if (items.length === 0) return [];
    const counts = await childCounts(items.filter((i) => i.type === "show" || i.type === "season" || i.type === "game").map((i) => i.id));
    const inFolders = await folderVideos(items, user);
    for (const [folderId, videos] of inFolders) counts.set(folderId, videos.length);
    const showOf = await shows(items);
    const data = user ? await userData(items, user.id, inFolders) : new Map<number, UserData>();
    const clipOf = await clips(items);
    return items.map((item) => item.toSummary({
      childCount: counts.get(item.id) ?? 0,
      userData: data.get(item.id) ?? null,
      showId: showOf.get(item.id)?.id ?? null,
      showTitle: showOf.get(item.id)?.title ?? null,
      clip: clipOf.get(item.id) ?? null,
    }));
  }

  export async function one(item: MediaItem, user: User | null) {
    return (await build([item], user))[0];
  }
}

export default Summaries;
