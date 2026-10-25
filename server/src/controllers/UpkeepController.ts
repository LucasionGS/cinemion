import { Hono } from "hono";
import { MediaFile, User } from "../models/index.ts";
import Upkeep from "../library/Upkeep.ts";
import FileHealth from "../library/FileHealth.ts";
import Tasks from "../lib/Tasks.ts";
import { readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Settings › Upkeep: space used, duplicates and broken files, for people who manage libraries.
 */
export namespace UpkeepController {
  export const router = new Hono<AppEnv>();

  router.use("*", User.$middleware({ permissions: ["LIBRARY_MANAGE"] }));

  /**
   * @swagger
   * /api/upkeep:
   *   get:
   *     summary: Duplicates and broken files.
   */
  router.get("/", async (c) => c.json(await Upkeep.overview(false)));

  /**
   * @swagger
   * /api/upkeep/space:
   *   get:
   *     summary: Space used per library, file type and show, and the biggest files.
   */
  router.get("/space", async (c) => c.json(await Upkeep.space()));

  /**
   * @swagger
   * /api/upkeep/check:
   *   post:
   *     summary: Play every file through ffmpeg to find damaged ones, as a background task. `{ "onlyNew": true }` skips
   *       files checked before.
   */
  router.post("/check", async (c) => {
    if (Tasks.list().some((t) => t.id.startsWith("check-files-"))) return c.json({ message: "Files are being checked already." }, 409);
    const body = await readJson<{ libraryId: number; onlyNew: boolean }>(c);
    FileHealth.checkAll(typeof body?.libraryId === "number" ? body.libraryId : null, !!body?.onlyNew).catch(() => { });
    return c.json(await Upkeep.overview(false));
  });

  /**
   * @swagger
   * /api/upkeep/files/{id}/check:
   *   post:
   *     summary: Check one file again now.
   */
  router.post("/files/:id/check", async (c) => {
    const file = await MediaFile.findByPk(Number(c.req.param("id")));
    if (!file) return c.json({ message: "That file isn't in a library any more." }, 404);
    const problem = await FileHealth.check(file);
    await file.update({ problem, checkedAt: new Date() });
    return c.json({ problem });
  });
}

export default UpkeepController;
