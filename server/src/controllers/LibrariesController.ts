import { Hono } from "hono";
import { literal, Op, type Order, type WhereOptions } from "sequelize";
import type { CreateLibraryRequest, LibraryInfo, UpdateLibraryRequest } from "@shared/api.ts";
import type { ItemPage, SortOrder } from "@shared/media.ts";
import { Library, MediaItem, User } from "../models/index.ts";
import MediaRoots from "../lib/MediaRoots.ts";
import Scanner from "../library/Scanner.ts";
import LibraryWatcher from "../library/LibraryWatcher.ts";
import Tasks from "../lib/Tasks.ts";
import Visibility from "../library/Visibility.ts";
import Summaries from "../library/Summaries.ts";
import VideoDetails from "../library/VideoDetails.ts";
import CollectionsController from "./CollectionsController.ts";
import MusicLibrary from "../music/MusicLibrary.ts";
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

  /**
   * The item type a library counts and lists: its movies, shows, videos or albums.
   */
  function mainType(library: Library) {
    return ({ movies: "movie", shows: "show", videos: "video", music: "album", audiobooks: "audiobook", books: "book" } as const)[library.type];
  }

  /**
   * @param all Every library, when the caller has them already; used to spot shared folders.
   */
  async function info(library: Library, user: User, all?: Library[]): Promise<LibraryInfo> {
    const itemCount = await MediaItem.count({ where: { [Op.and]: [Visibility.where(user), { libraryId: library.id, type: mainType(library) }] } });
    const others = (all ?? await Library.findAll()).filter((l) => l.id !== library.id);
    const conflict = library.paths.map((p) => Library.overlapProblem(p, others)).find((p) => p !== null) ?? null;
    return library.toInfo({ itemCount, scan: Tasks.get(Scanner.taskId(library.id)), conflict });
  }

  /**
   * @swagger
   * /api/libraries:
   *   get:
   *     summary: Libraries the signed-in user can see, with item counts and scan progress.
   */
  router.get("/", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const all = await Library.findAll({ order: [["id", "ASC"]] });
    const libraries = all.filter((l) => canSee(user, l.id));
    return c.json(await Promise.all(libraries.map((l) => info(l, user, all))));
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
  /**
   * @swagger
   * /api/libraries/{id}:
   *   put:
   *     summary: Rename a library, change its folders, or change a Videos library's rating for unrated videos. Body is an
   *       `UpdateLibraryRequest`. New folders are checked like new libraries: allowed, and not in another library.
   */
  router.put("/:id", manage, async (c) => {
    const library = await Library.findByPk(Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const body = await readJson<UpdateLibraryRequest>(c);
    if (!body) return c.json({ message: "Nothing to change." }, 400);
    try {
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name || name.length > 60) throw new Error("The library name must be between 1 and 60 characters long.");
        library.name = name;
      }
      const ratingChanged = body.defaultRating !== undefined && Library.hasDefaultRating(library.type) && Library.verifyDefaultRating(body.defaultRating) !== library.defaultRating;
      if (ratingChanged) library.defaultRating = Library.verifyDefaultRating(body.defaultRating);

      let pathsChanged = false;
      if (body.paths !== undefined) {
        const paths = Library.verifyPaths(body.paths, library.name);
        const others = (await Library.findAll()).filter((l) => l.id !== library.id);
        for (const path of paths) {
          if (!(await MediaRoots.resolveAllowed(path))) throw new Error(`The folder "${path}" isn't available. Only folders inside ${MediaRoots.roots().join(", ")} can be used.`);
          const problem = Library.overlapProblem(path, others);
          if (problem) throw new Error(problem);
        }
        pathsChanged = JSON.stringify(paths) !== JSON.stringify(library.paths);
        library.paths = paths;
      }

      await library.save();
      if (ratingChanged && library.type === "videos") await VideoDetails.applyDefaultRating(library);
      if (ratingChanged && library.type !== "videos") await MusicLibrary.applyDefaultRating(library);
      if (pathsChanged) {
        await LibraryWatcher.refresh();
        // This library lets go of files in folders it no longer has; then the others can pick them up
        Scanner.queue(library.id).catch(() => { });
        for (const other of await Library.findAll()) {
          if (other.id !== library.id) Scanner.queue(other.id).catch(() => { });
        }
      }
      return c.json(await info(library, c.get("user")!));
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
  function unwatchedWhere(userId: number, type: "movie" | "show" | "video"): WhereOptions<MediaItem> {
    const id = Number(userId);
    if (type === "movie" || type === "video") {
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
   *       Videos libraries list the folders and videos at the top level (folders first), or every unwatched video with `unwatched`; `year` sorts by date.
   */
  router.get("/:id/items", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await Library.findByPk(Number(c.req.param("id")));
    if (!library || !canSee(user, library.id)) return c.json({ message: "That library doesn't exist." }, 404);
    if (library.type === "music") return c.json({ message: "Music libraries list their albums, artists and tracks under /api/music." }, 400);
    if (library.type === "audiobooks" || library.type === "books") return c.json({ message: "Audiobooks and Books libraries list their books under /api/books." }, 400);

    const sort = (c.req.query("sort") ?? "title") as SortOrder;
    const isVideos = library.type === "videos";
    const columns: Record<SortOrder, string> = { title: "sortTitle", added: "addedAt", year: isVideos ? "releaseDate" : "year", rating: "rating" };
    const column = columns[sort] ?? "sortTitle";
    const defaultDirection = sort === "title" ? "ASC" : "DESC";
    const direction = c.req.query("order") === "asc" ? "ASC" : c.req.query("order") === "desc" ? "DESC" : defaultDirection;
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "60") || 60, 1), 500);
    const offset = Math.max(parseInt(c.req.query("offset") ?? "0") || 0, 0);
    const unwatched = c.req.query("unwatched") === "1";
    const genre = c.req.query("genre");
    const type = mainType(library) as "movie" | "show" | "video";
    // Folders stay together in front, like in a file manager; filtering looks at videos wherever they are
    const flat = !isVideos || unwatched || !!genre;
    const order: Order = isVideos && !flat ? [["type", "ASC"], [column, direction], ["sortTitle", "ASC"]] : [[column, direction], ["sortTitle", "ASC"]];

    const conditions: WhereOptions<MediaItem>[] = [Visibility.where(user), flat ? { libraryId: library.id, type } : { libraryId: library.id, type: ["folder", "video"], parentId: null }];
    if (genre) conditions.push(MediaItem.genreCondition(genre));
    if (unwatched) conditions.push(unwatchedWhere(user.id, type));

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
    const items = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { libraryId: library.id, type: mainType(library) }] }, attributes: ["id", "genres"] });
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
