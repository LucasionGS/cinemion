import { Hono } from "hono";
import type { ServerInfo } from "@shared/api.ts";
import AppSystem from "../AppSystem.ts";
import { Setting } from "../models/index.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace ServerController {
  export const router = new Hono<AppEnv>();

  /**
   * Whether the first-run setup still has to happen.
   */
  export async function needsSetup() {
    return !(await Setting.get(Setting.Keys.SETUP_COMPLETE, false));
  }

  /**
   * @swagger
   * /api/server:
   *   get:
   *     summary: Server name, version and whether setup is needed. Public.
   */
  router.get("/", async (c) => {
    const info: ServerInfo = {
      name: await Setting.get(Setting.Keys.SERVER_NAME, AppSystem.APP_NAME),
      version: AppSystem.VERSION,
      needsSetup: await needsSetup(),
    };
    return c.json(info);
  });
}

export default ServerController;
