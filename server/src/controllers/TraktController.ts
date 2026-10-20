import { Hono } from "hono";
import type { TraktStatus } from "@shared/trakt.ts";
import { User } from "../models/index.ts";
import Trakt from "../integrations/Trakt.ts";
import { errorMessage } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * The signed-in profile's own Trakt account: linking it, unlinking it, and bringing its history in.
 */
export namespace TraktController {
  export const router = new Hono<AppEnv>();

  /**
   * @swagger
   * /api/trakt:
   *   get:
   *     summary: Whether Trakt is set up on the server, and whether this profile is linked.
   */
  router.get("/", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const status: TraktStatus = { available: await Trakt.isAvailable(), connected: !!user.trakt, username: user.trakt?.username ?? null };
    return c.json(status);
  });

  /**
   * @swagger
   * /api/trakt/link:
   *   post:
   *     summary: Start linking. Returns a code to enter at the Trakt address (`TraktLinkStart`).
   */
  router.post("/link", User.$middleware(), async (c) => {
    try {
      return c.json(await Trakt.startLink(c.get("user")!));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 502);
    }
  });

  /**
   * @swagger
   * /api/trakt/link/poll:
   *   post:
   *     summary: Whether the code was entered yet (`TraktLinkPoll`). Call it every `interval` seconds.
   */
  router.post("/link/poll", User.$middleware(), async (c) => {
    try {
      return c.json(await Trakt.pollLink(c.get("user")!));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 502);
    }
  });

  /**
   * @swagger
   * /api/trakt:
   *   delete:
   *     summary: Unlink this profile's Trakt account.
   */
  router.delete("/", User.$middleware(), async (c) => {
    await Trakt.unlink(c.get("user")!);
    return c.body(null, 204);
  });

  /**
   * @swagger
   * /api/trakt/import:
   *   post:
   *     summary: Mark everything this profile watched on Trakt as watched here too (`TraktImportResult`).
   */
  router.post("/import", User.$middleware(), async (c) => {
    try {
      return c.json(await Trakt.importHistory(c.get("user")!));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 502);
    }
  });
}

export default TraktController;
