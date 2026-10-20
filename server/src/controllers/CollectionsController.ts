import { Hono } from "hono";
import { Op, type WhereOptions } from "sequelize";
import type { CollectionDetail, CollectionSummary } from "@shared/media.ts";
import { Collection, MediaItem, User } from "../models/index.ts";
import Visibility from "../library/Visibility.ts";
import Summaries from "../library/Summaries.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace CollectionsController {
  export const router = new Hono<AppEnv>();

  /**
   * Collections with at least two movies `user` may see, sorted by name.
   */
  export async function visibleCollections(user: User, where: WhereOptions<Collection>): Promise<CollectionSummary[]> {
    const collections = await Collection.findAll({ where, order: [["sortName", "ASC"]] });
    if (collections.length === 0) return [];
    const movies = await MediaItem.findAll({
      where: { [Op.and]: [Visibility.where(user), { collectionId: collections.map((c) => c.id) }] },
      attributes: ["id", "collectionId"],
    });
    const counts = new Map<number, number>();
    for (const movie of movies) counts.set(movie.collectionId!, (counts.get(movie.collectionId!) ?? 0) + 1);
    return collections.filter((c) => (counts.get(c.id) ?? 0) > 1).map((c) => c.toSummary(counts.get(c.id)!));
  }

  /**
   * @swagger
   * /api/collections/{id}:
   *   get:
   *     summary: A collection and its movies, oldest first.
   */
  router.get("/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const collection = await Collection.findByPk(Number(c.req.param("id")));
    if (!collection || !Visibility.canSeeLibrary(user, collection.libraryId)) return c.json({ message: "That collection doesn't exist." }, 404);
    const movies = await MediaItem.findAll({
      where: { [Op.and]: [Visibility.where(user), { collectionId: collection.id }] },
      order: [["releaseDate", "ASC"], ["year", "ASC"], ["sortTitle", "ASC"]],
    });
    if (movies.length === 0) return c.json({ message: "That collection doesn't exist." }, 404);
    const detail: CollectionDetail = { ...collection.toSummary(movies.length), items: await Summaries.build(movies, user) };
    return c.json(detail);
  });
}

export default CollectionsController;
