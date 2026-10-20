import { Hono } from "hono";
import { User } from "../models/index.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace ProfilesController {
  export const router = new Hono<AppEnv>();

  /**
   * @swagger
   * /api/profiles:
   *   get:
   *     summary: Profiles shown on the "Who's watching?" screen. Public.
   */
  router.get("/", async (c) => {
    const users = await User.findAll({ where: { showOnPicker: true }, order: [["id", "ASC"]] });
    return c.json(users.map((u) => u.toProfileJSON()));
  });
}

export default ProfilesController;
