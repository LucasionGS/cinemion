import { Hono } from "hono";
import { literal, Op, type Order, type WhereOptions } from "sequelize";
import type { CreateLibraryRequest, LibraryInfo } from "@shared/api.ts";
import type { ItemPage, SortOrder } from "@shared/media.ts";
import { Library, MediaItem, User } from "../models/index.ts";
import MediaRoots from "../lib/MediaRoots.ts";
import Scanner from "../library/Scanner.ts";
import LibraryWatcher from "../library/LibraryWatcher.ts";
import Tasks from "../lib/Tasks.ts";
import Visibility from "../library/Visibility.ts";
import Summaries from "../library/Summaries.ts";
import CollectionsController from "./CollectionsController.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace LibrariesController {
  export const router = new Hono<AppEnv>();

  const manage = User.$middleware({ permissions: ["LIBRARY_MANAGE"] });

  /**
   * Whether `user` may see `libraryId`.
   */
  export function canSee(user: User, libraryId: number) {
    return Visibility.canSeeLibrary(user, libraryId);
  }

  async function info(library: Library, user: User): Promise<LibraryInfo> {
    const itemCount = await MediaItem.count({ where: { [Op.and]: [Visibility.where(user), { libraryId: library.id, type: library.type === "movies" ? "movie" : "show" }] } });
    return library.toInfo({ itemCount, scan: Tasks.get(Scanner.taskId(library.id)) });
  }

  /**
   * @swagger
   * /api/libraries:
   *   get:
   *     summary: Libraries the signed-in user can see, with item counts and scan progress.
   */
  router.get("/", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const libraries = (await Library.findAll({ order: [["id", "ASC"]] })).filter((l) => canSee(user, l.id));
    return c.json(await Promise.all(libraries.map((l) => info(l, user))));
  });

  /**
   * @swagger
   * /api/libraries:
   *   post:
   *     summary: Add a library and start scanning it.
   */
  router.post("/", manage, async (c) => {
    const body = await readJson<CreateLibraryRequest>(c);
    if (!body) return c.json({ message: "A name, type and folders are required." }, 400);

    for (const path of body.paths ?? []) {
      if (!(await MediaRoots.resolveAllowed(path))) {
        return c.json({ message: `The folder "${path}" isn't available. Only folders inside ${MediaRoots.roots().join(", ")} can be used.` }, 400);
      }
    }
    try {
      const library = await Library.createLibrary(body as CreateLibraryRequest);
      await LibraryWatcher.refresh();
      Scanner.queue(library.id).catch(() => { });
      return c.json(await info(library, c.get("user")!), 201);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/libraries/{id}:
   *   delete:
   *     summary: Remove a library and everything Cinemion knows about it. The files on disk are not touched.
   */
  router.delete("/:id", manage, async (c) => {
    const library = await Library.findByPk(Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    await library.destroy();
    await LibraryWatcher.refresh();
    return c.body(null, 204);
  });

  /**
   * @swagger
   * /api/libraries/{id}/scan:
   *   post:
   *     summary: Scan the library now. With `{ "refresh": true }`, details are fetched again for everything.
   */
  router.post("/:id/scan", manage, async (c) => {
    const library = await Library.findByPk(Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const body = await readJson<{ refresh: boolean }>(c);
    Scanner.queue(library.id, { refreshMetadata: !!body?.refresh }).catch(() => { });
    return c.json(await info(library, c.get("user")!));
  });

  /**
   * Conditions for "only titles with something left to watch" for `userId`.
   */
  function unwatchedWhere(userId: number, type: "movie" | "show"): WhereOptions<MediaItem> {
    const id = Number(userId);
    if (type === "movie") {
      return { id: { [Op.notIn]: literal(`(SELECT itemId FROM watch_states WHERE userId = ${id} AND watched = 1)`) } };
    }
    // A show is done when every one of its episodes is watched
    return {
      id: {
        [Op.notIn]: literal(`(SELECT s.parentId FROM media_items s
          JOIN media_items e ON e.parentId = s.id AND e.type = 'episode'
          LEFT JOIN watch_states w ON w.itemId = e.id AND w.userId = ${id} AND w.watched = 1
          WHERE s.type = 'season' GROUP BY s.parentId HAVING COUNT(e.id) = COUNT(w.id))`),
      },
    };
  }

  /**
   * @swagger
   * /api/libraries/{id}/items:
   *   get:
   *     summary: Movies or shows in a library, sorted, filtered and paged. Query `sort` (title, added, year, rating), `order` (asc, desc), `genre`, `unwatched` (1), `offset`, `limit`.
   */
  router.get("/:id/items", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await Library.findByPk(Number(c.req.param("id")));
    if (!library || !canSee(user, library.id)) return c.json({ message: "That library doesn't exist." }, 404);

    const sort = (c.req.query("sort") ?? "title") as SortOrder;
    const columns: Record<SortOrder, string> = { title: "sortTitle", added: "addedAt", year: "year", rating: "rating" };
    const column = columns[sort] ?? "sortTitle";
    const defaultDirection = sort === "title" ? "ASC" : "DESC";
    const direction = c.req.query("order") === "asc" ? "ASC" : c.req.query("order") === "desc" ? "DESC" : defaultDirection;
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "60") || 60, 1), 500);
    const offset = Math.max(parseInt(c.req.query("offset") ?? "0") || 0, 0);
    const order: Order = [[column, direction], ["sortTitle", "ASC"]];
    const type = library.type === "movies" ? "movie" : "show";

    const conditions: WhereOptions<MediaItem>[] = [Visibility.where(user), { libraryId: library.id, type }];
    const genre = c.req.query("genre");
    if (genre) conditions.push(MediaItem.genreCondition(genre));
    if (c.req.query("unwatched") === "1") conditions.push(unwatchedWhere(user.id, type));

    const { rows, count } = await MediaItem.findAndCountAll({ where: { [Op.and]: conditions }, order, limit, offset });
    const page: ItemPage = { items: await Summaries.build(rows, user), total: count };
    return c.json(page);
  });

  /**
   * @swagger
   * /api/libraries/{id}/genres:
   *   get:
   *     summary: Every genre in the library, for the filter menu.
   */
  router.get("/:id/genres", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await Library.findByPk(Number(c.req.param("id")));
    if (!library || !canSee(user, library.id)) return c.json({ message: "That library doesn't exist." }, 404);
    const items = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { libraryId: library.id, type: library.type === "movies" ? "movie" : "show" }] }, attributes: ["id", "genres"] });
    const genres = [...new Set(items.flatMap((i) => i.genres))].sort((a, b) => a.localeCompare(b));
    return c.json(genres);
  });

  /**
   * @swagger
   * /api/libraries/{id}/collections:
   *   get:
   *     summary: Collections in a movie library with at least two visible movies.
   */
  router.get("/:id/collections", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await Library.findByPk(Number(c.req.param("id")));
    if (!library || !canSee(user, library.id)) return c.json({ message: "That library doesn't exist." }, 404);
    return c.json(await CollectionsController.visibleCollections(user, { libraryId: library.id }));
  });
}

export default LibrariesController;
