import { Hono } from "hono";
import type { ItemDetail } from "@shared/media.ts";
import { Credit, MediaFile, MediaItem, Person, User } from "../models/index.ts";
import LibrariesController from "./LibrariesController.ts";
import MetadataManager from "../metadata/MetadataManager.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace ItemsController {
  export const router = new Hono<AppEnv>();

  const KIND_ORDER = ["director", "writer", "cast", "composer", "producer"];

  /**
   * The item with `id`, when the signed-in user may see its library.
   */
  async function findVisible(user: User, id: number) {
    const item = await MediaItem.findByPk(id);
    return item && LibrariesController.canSee(user, item.libraryId) ? item : null;
  }

  /**
   * @swagger
   * /api/items/{id}:
   *   get:
   *     summary: Everything about a movie, show, season or episode, with its children, cast and files.
   */
  router.get("/:id", User.$middleware(), async (c) => {
    const item = await findVisible(c.get("user")!, Number(c.req.param("id")));
    if (!item) return c.json({ message: "That title doesn't exist." }, 404);

    const children = await MediaItem.findAll({
      where: { parentId: item.id },
      order: item.type === "show" ? [["seasonNumber", "ASC"]] : [["episodeNumber", "ASC"]],
    });
    // Specials (season 0) go after the regular seasons
    if (item.type === "show") children.sort((a, b) => (a.seasonNumber === 0 ? 1 : 0) - (b.seasonNumber === 0 ? 1 : 0));
    const counts = await LibrariesController.childCounts(children.map((ch) => ch.id));
    const ownCount = await LibrariesController.childCounts([item.id]);
    const credits = await Credit.findAll({ where: { itemId: item.id }, include: [{ model: Person, as: "person" }], order: [["order", "ASC"]] });
    credits.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const files = await MediaFile.findAll({ where: { itemId: item.id }, order: [["path", "ASC"]] });

    const detail: ItemDetail = {
      ...item.toSummary(ownCount.get(item.id) ?? 0),
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
      children: children.map((ch) => ch.toSummary(counts.get(ch.id) ?? 0)),
    };
    return c.json(detail);
  });

  /**
   * @swagger
   * /api/items/{id}/refresh:
   *   post:
   *     summary: Fetch details again. For seasons and episodes the whole show is refreshed.
   */
  router.post("/:id/refresh", User.$middleware({ permissions: ["LIBRARY_MANAGE"] }), async (c) => {
    const item = await findVisible(c.get("user")!, Number(c.req.param("id")));
    if (!item) return c.json({ message: "That title doesn't exist." }, 404);
    try {
      await MetadataManager.refresh(item);
      await item.reload();
      return c.json(item.toSummary());
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
    const item = await findVisible(c.get("user")!, Number(c.req.param("id")));
    if (!item || (item.type !== "movie" && item.type !== "show")) return c.json({ message: "Only movies and shows can be matched." }, 404);
    const body = await readJson<{ provider: string; id: string }>(c);
    if (!body?.provider || !body.id) return c.json({ message: "Pick a search result to match with." }, 400);
    try {
      await MetadataManager.setMatch(item, body.provider, String(body.id));
      await item.reload();
      return c.json(item.toSummary());
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });
}

export default ItemsController;
