import { Hono } from "hono";
import { encodeHex } from "@std/encoding/hex";
import type { BackupSettingsUpdate } from "@shared/admin.ts";
import { User } from "../models/index.ts";
import Backups from "../backups/Backups.ts";
import Tasks from "../lib/Tasks.ts";
import { errorMessage, readJson, sendFile } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Settings › Backups: making, downloading and deleting backups, and their schedule. Restoring happens in the setup
 * wizard or from the command line, since it replaces everything the running server has.
 */
export namespace BackupsController {
  export const router = new Hono<AppEnv>();

  /**
   * Download links, so the browser can save a backup with a plain link (which can't send a sign-in header).
   */
  const _links = new Map<string, { name: string; until: number }>();
  const LINK_LIFETIME_MS = 5 * 60 * 1000;

  /**
   * @swagger
   * /api/backups/download/{token}:
   *   get:
   *     summary: Download a backup through a link from `POST /api/backups/{name}/link`.
   */
  router.get("/download/:token", async (c) => {
    const link = _links.get(c.req.param("token"));
    if (!link || link.until < Date.now()) return c.json({ message: "This download link has run out. Start the download again from Settings › Backups." }, 404);
    const path = await Backups.pathOf(link.name);
    const response = path ? await sendFile(c, path, link.name.endsWith(".enc") ? "application/octet-stream" : "application/gzip") : null;
    if (!response) return c.json({ message: "That backup isn't there any more." }, 404);
    response.headers.set("Content-Disposition", `attachment; filename="${link.name}"`);
    return response;
  });

  router.use("*", User.$middleware({ permissions: ["SERVER_MANAGE"] }));

  /**
   * @swagger
   * /api/backups:
   *   get:
   *     summary: The backups there are, the settings, and the one being made.
   */
  router.get("/", async (c) => c.json(await Backups.overview()));

  /**
   * @swagger
   * /api/backups:
   *   post:
   *     summary: Start making a backup now. Answers straight away; the backup shows up in the list when it's done.
   */
  router.post("/", async (c) => {
    if (Tasks.get("backup")) return c.json({ message: "A backup is being made already." }, 409);
    Backups.make("manual").catch(() => { });
    return c.json(await Backups.overview());
  });

  /**
   * @swagger
   * /api/backups/settings:
   *   put:
   *     summary: Change the schedule, folder, how many to keep, whether artwork is included, and the password.
   */
  router.put("/settings", async (c) => {
    const body = await readJson<BackupSettingsUpdate>(c);
    if (!body) return c.json({ message: "Send the settings to change as JSON." }, 400);
    try {
      await Backups.updateSettings(body);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
    return c.json(await Backups.overview());
  });

  /**
   * @swagger
   * /api/backups/{name}/link:
   *   post:
   *     summary: A download link for a backup that works for five minutes.
   */
  router.post("/:name/link", async (c) => {
    const name = c.req.param("name");
    if (!(await Backups.pathOf(name))) return c.json({ message: "That backup isn't there any more." }, 404);
    for (const [token, link] of _links) if (link.until < Date.now()) _links.delete(token);
    const token = encodeHex(crypto.getRandomValues(new Uint8Array(16)));
    _links.set(token, { name, until: Date.now() + LINK_LIFETIME_MS });
    return c.json({ url: `/api/backups/download/${token}` });
  });

  /**
   * @swagger
   * /api/backups/{name}:
   *   delete:
   *     summary: Delete a backup.
   */
  router.delete("/:name", async (c) => {
    try {
      await Backups.remove(c.req.param("name"));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 404);
    }
    return c.json(await Backups.overview());
  });
}

export default BackupsController;
