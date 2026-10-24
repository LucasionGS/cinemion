import { Hono } from "hono";
import { MediaItem, User } from "../models/index.ts";
import Watchlist from "../library/Watchlist.ts";
import Visibility from "../library/Visibility.ts";
import { errorMessage } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * "My list" for the signed-in profile.
 */
export namespace WatchlistController {
  export const router = new Hono<AppEnv>();

  router.use("*", User.$middleware());

  /**
   * @swagger
   * /api/watchlist:
   *   get:
   *     summary: The profile's list, newest first, and how it stands with Trakt.
   */
  router.get("/", async (c) => c.json(await Watchlist.overview(c.get("user")!)));

  /**
   * @swagger
   * /api/watchlist/sync:
   *   post:
   *     summary: Bring the list in step with the profile's Trakt watchlist now.
   */
  router.post("/sync", async (c) => {
    const user = c.get("user")!;
    if (!user.trakt) return c.json({ message: "This profile isn't linked to Trakt. Link it in Settings › Your profile." }, 400);
    await Watchlist.sync(user, true);
    return c.json(await Watchlist.overview(user));
  });

  /**
   * @swagger
   * /api/watchlist/items/{itemId}:
   *   put:
   *     summary: Put a movie, show or video on the list.
   */
  router.put("/items/:itemId", async (c) => {
    const user = c.get("user")!;
    const item = await MediaItem.findByPk(Number(c.req.param("itemId")));
    if (!item || !Visibility.canSee(user, item)) return c.json({ message: "That title doesn't exist." }, 404);
    try {
      await Watchlist.add(user, item);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
    return c.json({ onList: true });
  });

  /**
   * @swagger
   * /api/watchlist/items/{itemId}:
   *   delete:
   *     summary: Take a title off the list.
   */
  router.delete("/items/:itemId", async (c) => {
    await Watchlist.remove(c.get("user")!, { itemId: Number(c.req.param("itemId")) });
    return c.json({ onList: false });
  });

  /**
   * @swagger
   * /api/watchlist/entries/{id}:
   *   delete:
   *     summary: Take an entry off the list, also one for a title that isn't here.
   */
  router.delete("/entries/:id", async (c) => {
    const user = c.get("user")!;
    if (!(await Watchlist.remove(user, { entryId: Number(c.req.param("id")) }))) return c.json({ message: "That isn't on your list." }, 404);
    return c.json(await Watchlist.overview(user));
  });
}

export default WatchlistController;
