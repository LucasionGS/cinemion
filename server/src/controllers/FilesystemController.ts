import { Hono } from "hono";
import { User } from "../models/index.ts";
import ServerController from "./ServerController.ts";
import MediaRoots from "../lib/MediaRoots.ts";
import { errorMessage } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace FilesystemController {
  export const router = new Hono<AppEnv>();

  const optionalUser = User.$middleware({ required: false });

  /**
   * @swagger
   * /api/fs:
   *   get:
   *     summary: List the folders inside `path` (or the allowed roots without one). Open during first-run setup, then library managers only.
   */
  router.get("/", optionalUser, async (c) => {
    const user = c.get("user");
    const allowed = await ServerController.needsSetup() || (user && await user.hasPermission("LIBRARY_MANAGE"));
    if (!allowed) return c.json({ message: "Only library managers can browse folders." }, 403);

    const path = c.req.query("path") || null;
    try {
      return c.json(await MediaRoots.list(path));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });
}

export default FilesystemController;
