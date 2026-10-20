import { Hono } from "hono";
import { Op } from "sequelize";
import type { ItemDetail } from "@shared/media.ts";
import { Collection, Credit, MediaFile, MediaItem, Person, User, WatchState } from "../models/index.ts";
import MetadataManager from "../metadata/MetadataManager.ts";
import Visibility from "../library/Visibility.ts";
import Summaries from "../library/Summaries.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace ItemsController {
  export const router = new Hono<AppEnv>();

  const KIND_ORDER = ["director", "writer", "cast", "composer", "producer"];
  const SIMILAR_COUNT = 16;

  /**
   * The item with `id`, when the signed-in profile may see it.
   */
  async function findVisible(user: User, id: number) {
    const item = await MediaItem.findByPk(id);
    return item && Visibility.canSee(user, item) ? item : null;
  }

  /**
   * Movies and episodes under an item: itself for those, every episode for shows and seasons.
   */
  export async function playableIds(item: MediaItem): Promise<number[]> {
    if (item.type === "movie" || item.type === "episode") return [item.id];
    const seasons = item.type === "show" ? (await MediaItem.findAll({ where: { parentId: item.id }, attributes: ["id"] })).map((s) => s.id) : [item.id];
    return (await MediaItem.findAll({ where: { parentId: seasons, type: "episode" }, attributes: ["id"] })).map((e) => e.id);
  }

  /**
   * Titles in the same library that share the most genres with `item`.
   */
  export async function similar(item: MediaItem, user: User) {
    if (item.type !== "movie" && item.type !== "show") return [];
    if (item.genres.length === 0) return [];
    const candidates = await MediaItem.findAll({
      where: {
        [Op.and]: [
          Visibility.where(user),
          { libraryId: item.libraryId, type: item.type, id: { [Op.ne]: item.id } },
          { [Op.or]: item.genres.map((g) => MediaItem.genreCondition(g)) },
        ],
      },
      limit: 200,
    });
    const shared = (other: MediaItem) => other.genres.filter((g) => item.genres.includes(g)).length;
    candidates.sort((a, b) => shared(b) - shared(a) || (b.rating ?? 0) - (a.rating ?? 0));
    return await Summaries.build(candidates.slice(0, SIMILAR_COUNT), user);
  }

  /**
   * @swagger
   * /api/items/{id}:
   *   get:
   *     summary: Everything about a movie, show, season or episode, with its children, cast, files and similar titles.
   */
  router.get("/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const item = await findVisible(user, Number(c.req.param("id")));
    if (!item) return c.json({ message: "That title doesn't exist." }, 404);

    const children = await MediaItem.findAll({
      where: { parentId: item.id },
      order: item.type === "show" ? [["seasonNumber", "ASC"]] : [["episodeNumber", "ASC"]],
    });
    // Specials (season 0) go after the regular seasons
    if (item.type === "show") children.sort((a, b) => (a.seasonNumber === 0 ? 1 : 0) - (b.seasonNumber === 0 ? 1 : 0));

    const credits = await Credit.findAll({ where: { itemId: item.id }, include: [{ model: Person, as: "person" }], order: [["order", "ASC"]] });
    credits.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const files = await MediaFile.findAll({ where: { itemId: item.id }, order: [["path", "ASC"]] });
    const collection = item.collectionId ? await Collection.findByPk(item.collectionId) : null;
    const collectionSize = collection ? await MediaItem.count({ where: { collectionId: collection.id } }) : 0;

    const detail: ItemDetail = {
      ...await Summaries.one(item, user),
      originalTitle: item.originalTitle,
      overview: item.overview,
      tagline: item.tagline,
      runtime: item.runtime ?? (files[0]?.duration ? Math.round(files[0].duration / 60) : null),
      releaseDate: item.releaseDate,
      rating: item.rating,
      genres: item.genres,
      studios: item.studios,
      externalIds: item.externalIds,
      parentId: item.parentId,
      credits: credits.map((cr) => cr.toInfo()),
      files: files.map((f) => f.toInfo()),
      children: await Summaries.build(children, user),
      collection: collection && collectionSize > 1 ? collection.toSummary(collectionSize) : null,
      similar: await similar(item, user),
    };
    return c.json(detail);
  });

  /**
   * @swagger
   * /api/items/{id}/next:
   *   get:
   *     summary: The episode "Play" starts for a show or season. An episode in progress first, then the next one after
   *       the furthest watched, then the first episode. `null` when there are no episodes.
   */
  router.get("/:id/next", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const item = await findVisible(user, Number(c.req.param("id")));
    if (!item || (item.type !== "show" && item.type !== "season")) return c.json({ message: "Only shows and seasons have a next episode." }, 404);

    const seasonIds = item.type === "show"
      ? (await MediaItem.findAll({ where: { parentId: item.id, type: "season" }, attributes: ["id", "seasonNumber"] })).filter((s) => s.seasonNumber !== 0).map((s) => s.id)
      : [item.id];
    const episodes = await MediaItem.findAll({ where: { parentId: seasonIds, type: "episode" }, order: [["seasonNumber", "ASC"], ["episodeNumber", "ASC"]] });
    if (episodes.length === 0) return c.json(null);

    const states = await WatchState.findAll({ where: { userId: user.id, itemId: episodes.map((e) => e.id) } });
    const inProgress = states.filter((s) => !s.watched && s.position > 0).sort((a, b) => (b.lastWatchedAt?.getTime() ?? 0) - (a.lastWatchedAt?.getTime() ?? 0))[0];
    const watched = new Set(states.filter((s) => s.watched).map((s) => s.itemId));
    let furthest = -1;
    episodes.forEach((e, i) => {
      if (watched.has(e.id)) furthest = i;
    });
    const next = inProgress
      ? episodes.find((e) => e.id === inProgress.itemId)!
      : episodes.slice(furthest + 1).find((e) => !watched.has(e.id)) ?? episodes[0];
    return c.json(await Summaries.one(next, user));
  });

  /**
   * @swagger
   * /api/items/{id}/watched:
   *   put:
   *     summary: Mark as watched or not. Shows and seasons mark all their episodes. Body `{ "watched": true }`.
   */
  router.put("/:id/watched", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const item = await findVisible(user, Number(c.req.param("id")));
    if (!item) return c.json({ message: "That title doesn't exist." }, 404);
    const body = await readJson<{ watched: boolean }>(c);
    if (typeof body?.watched !== "boolean") return c.json({ message: "Say whether it's watched: { \"watched\": true }." }, 400);

    await WatchState.markWatched(user.id, await playableIds(item), body.watched);
    return c.json(await Summaries.one(item, user));
  });

  /**
   * @swagger
   * /api/items/{id}/progress:
   *   put:
   *     summary: Remember where playback is, in seconds. Body `{ "position": 123, "duration": 5400 }`.
   */
  router.put("/:id/progress", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const item = await findVisible(user, Number(c.req.param("id")));
    if (!item || (item.type !== "movie" && item.type !== "episode")) return c.json({ message: "Only movies and episodes have progress." }, 404);
    const body = await readJson<{ position: number; duration: number | null }>(c);
    if (typeof body?.position !== "number" || body.position < 0) return c.json({ message: "A position in seconds is required." }, 400);

    await WatchState.saveProgress(user.id, item.id, body.position, typeof body.duration === "number" ? body.duration : null);
    return c.json(await Summaries.one(item, user));
  });

  /**
   * @swagger
   * /api/items/{id}/refresh:
   *   post:
   *     summary: Fetch details again. For seasons and episodes the whole show is refreshed.
   */
  router.post("/:id/refresh", User.$middleware({ permissions: ["LIBRARY_MANAGE"] }), async (c) => {
    const user = c.get("user")!;
    const item = await findVisible(user, Number(c.req.param("id")));
    if (!item) return c.json({ message: "That title doesn't exist." }, 404);
    try {
      await MetadataManager.refresh(item);
      await item.reload();
      return c.json(await Summaries.one(item, user));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/items/{id}/match:
   *   get:
   *     summary: Search for the right title, for "Fix match". Query `query` (defaults to the current title) and `year`.
   */
  router.get("/:id/match", User.$middleware({ permissions: ["LIBRARY_MANAGE"] }), async (c) => {
    const item = await findVisible(c.get("user")!, Number(c.req.param("id")));
    if (!item || (item.type !== "movie" && item.type !== "show")) return c.json({ message: "Only movies and shows can be matched." }, 404);
    const query = c.req.query("query")?.trim() || item.title;
    const year = c.req.query("year") ? parseInt(c.req.query("year")!) || null : null;
    try {
      return c.json(await MetadataManager.search(item.type, query, year));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/items/{id}/match:
   *   post:
   *     summary: Use the chosen search result for this movie or show, and fetch its details.
   */
  router.post("/:id/match", User.$middleware({ permissions: ["LIBRARY_MANAGE"] }), async (c) => {
    const user = c.get("user")!;
    const item = await findVisible(user, Number(c.req.param("id")));
    if (!item || (item.type !== "movie" && item.type !== "show")) return c.json({ message: "Only movies and shows can be matched." }, 404);
    const body = await readJson<{ provider: string; id: string }>(c);
    if (!body?.provider || !body.id) return c.json({ message: "Pick a search result to match with." }, 400);
    try {
      await MetadataManager.setMatch(item, body.provider, String(body.id));
      await item.reload();
      return c.json(await Summaries.one(item, user));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });
}

export default ItemsController;
