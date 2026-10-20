import { Hono } from "hono";
import { fn, col, type Order } from "sequelize";
import type { CreateLibraryRequest, LibraryInfo } from "@shared/api.ts";
import type { ItemPage, SortOrder } from "@shared/media.ts";
import { Library, MediaItem, User } from "../models/index.ts";
import MediaRoots from "../lib/MediaRoots.ts";
import Scanner from "../library/Scanner.ts";
import LibraryWatcher from "../library/LibraryWatcher.ts";
import Tasks from "../lib/Tasks.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace LibrariesController {
  export const router = new Hono<AppEnv>();

  const manage = User.$middleware({ permissions: ["LIBRARY_MANAGE"] });

  /**
   * Whether `user` may see `libraryId`.
   */
  export function canSee(user: User, libraryId: number) {
    return user.libraryAccess === null || user.libraryAccess.includes(libraryId);
  }

  async function info(library: Library): Promise<LibraryInfo> {
    const itemCount = await MediaItem.count({ where: { libraryId: library.id, type: library.type === "movies" ? "movie" : "show" } });
    return library.toInfo({ itemCount, scan: Tasks.get(Scanner.taskId(library.id)) });
  }

  /**
   * Number of children (seasons of shows, episodes of seasons) for each id.
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
   * @swagger
   * /api/libraries:
   *   get:
   *     summary: Libraries the signed-in user can see, with item counts and scan progress.
   */
  router.get("/", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const libraries = (await Library.findAll({ order: [["id", "ASC"]] })).filter((l) => canSee(user, l.id));
    return c.json(await Promise.all(libraries.map(info)));
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
      return c.json(await info(library), 201);
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
    return c.json(await info(library));
  });

  /**
   * @swagger
   * /api/libraries/{id}/items:
   *   get:
   *     summary: Movies or shows in a library, sorted and paged. Query `sort` (title, added, year, rating), `order` (asc, desc), `offset`, `limit`.
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

    const { rows, count } = await MediaItem.findAndCountAll({
      where: { libraryId: library.id, type: library.type === "movies" ? "movie" : "show" },
      order,
      limit,
      offset,
    });
    const counts = await childCounts(rows.map((r) => r.id));
    const page: ItemPage = { items: rows.map((r) => r.toSummary(counts.get(r.id) ?? 0)), total: count };
    return c.json(page);
  });
}

export default LibrariesController;
