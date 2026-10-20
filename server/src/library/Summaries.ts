import { col, fn } from "sequelize";
import type { ItemSummary, UserData } from "@shared/media.ts";
import { MediaItem, type User, WatchState } from "../models/index.ts";

/**
 * Builds `ItemSummary` lists with everything an item doesn't know by itself, loaded in a few batched queries:
 * child counts, the profile's progress, and the show a season or episode belongs to.
 */
export namespace Summaries {
  /**
   * Number of children (seasons of shows, episodes of seasons) per id.
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
   * The profile's progress per item. Shows and seasons count their episodes.
   */
  export async function userData(items: MediaItem[], userId: number) {
    const result = new Map<number, UserData>();
    const leafIds = items.filter((i) => i.type === "movie" || i.type === "episode").map((i) => i.id);

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

    const allIds = [...new Set([...leafIds, ...[...episodesOf.values()].flat()])];
    const states = allIds.length ? await WatchState.findAll({ where: { userId, itemId: allIds } }) : [];
    const stateById = new Map(states.map((s) => [s.itemId, s]));

    for (const item of items) {
      if (item.type === "movie" || item.type === "episode") {
        const state = stateById.get(item.id);
        const duration = state?.duration ?? (item.runtime ? item.runtime * 60 : null);
        result.set(item.id, {
          watched: state?.watched ?? false,
          position: state?.position ?? 0,
          progress: state && duration && state.position ? Math.min(1, state.position / duration) : null,
          unwatchedCount: null,
          lastWatchedAt: state?.lastWatchedAt?.toISOString() ?? null,
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
    const counts = await childCounts(items.filter((i) => i.type === "show" || i.type === "season").map((i) => i.id));
    const showOf = await shows(items);
    const data = user ? await userData(items, user.id) : new Map<number, UserData>();
    return items.map((item) => item.toSummary({
      childCount: counts.get(item.id) ?? 0,
      userData: data.get(item.id) ?? null,
      showId: showOf.get(item.id)?.id ?? null,
      showTitle: showOf.get(item.id)?.title ?? null,
    }));
  }

  export async function one(item: MediaItem, user: User | null) {
    return (await build([item], user))[0];
  }
}

export default Summaries;
