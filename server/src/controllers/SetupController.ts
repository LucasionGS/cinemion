import { Hono } from "hono";
import fsp from "node:fs/promises";
import Path from "node:path";
import type { LoginResponse, SetupRequest } from "@shared/api.ts";
import AppSystem from "../AppSystem.ts";
import { Library, Role, Setting, User } from "../models/index.ts";
import ServerController from "./ServerController.ts";
import MediaRoots from "../lib/MediaRoots.ts";
import Scanner from "../library/Scanner.ts";
import LibraryWatcher from "../library/LibraryWatcher.ts";
import MetadataManager from "../metadata/MetadataManager.ts";
import Backups from "../backups/Backups.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import log from "../lib/Logger.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace SetupController {
  export const router = new Hono<AppEnv>();

  /**
   * @swagger
   * /api/setup:
   *   post:
   *     summary: Finish the first-run setup. Creates the admin, libraries and settings, and signs the admin in. Only works once.
   */
  router.post("/", async (c) => {
    if (!(await ServerController.needsSetup())) {
      return c.json({ message: "Cinemion has already been set up." }, 409);
    }

    const body = await readJson<SetupRequest>(c);
    const serverName = body?.serverName?.trim();
    const admin = body?.admin;
    if (!body || !serverName || !admin?.name || !admin.username || !admin.password) {
      return c.json({ message: "A server name and the admin's name, username and password are required." }, 400);
    }

    const libraries = body.libraries ?? [];
    for (const library of libraries) {
      for (const path of library.paths ?? []) {
        if (!(await MediaRoots.resolveAllowed(path))) {
          return c.json({ message: `The folder "${path}" isn't available. Only folders inside ${MediaRoots.roots().join(", ")} can be used.` }, 400);
        }
      }
    }

    try {
      // Validate everything first, so a bad library doesn't leave a half-finished setup behind
      const verified = libraries.map((library) => Library.verifyLibrary(library));
      for (const [i, library] of verified.entries()) {
        for (const path of library.paths) {
          const problem = Library.overlapProblem(path, verified.slice(0, i));
          if (problem) throw new Error(problem);
        }
      }
      User.verifyName(admin.name);
      User.verifyUsername(admin.username);
      User.verifyPassword(admin.password);
      if (admin.pin) User.verifyPin(admin.pin);

      const user = await User.registerUser({
        name: admin.name,
        username: admin.username,
        password: admin.password,
        pin: admin.pin || null,
        role: Role.ADMIN,
        color: "sky",
      });
      const created = [];
      for (const library of verified) created.push(await Library.createLibrary(library));

      await Setting.set(Setting.Keys.SERVER_NAME, serverName.slice(0, 60));
      await Setting.set(Setting.Keys.METADATA, MetadataManager.normalizeSettings(body.metadata ?? null));
      await Setting.set(Setting.Keys.SETUP_COMPLETE, true);
      log.info("First-run setup completed", { admin: user.username, libraries: libraries.length });

      // Start filling the libraries straight away
      await LibraryWatcher.refresh();
      for (const library of created) Scanner.queue(library.id).catch(() => { });

      const response: LoginResponse = { token: await user.createToken(), user: await user.toClientJSON() };
      return c.json(response);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  //#region Restoring a backup

  /**
   * Start restoring in the background and answer once the backup has been opened, so a wrong password or a file
   * that isn't a backup is reported straight away.
   */
  async function startRestore(path: string, password: string | null, cleanup?: () => Promise<void>) {
    try {
      await Backups.inspect(path, password);
    } catch (error) {
      await cleanup?.();
      throw error;
    }
    Backups.restore(path, password)
      .then(async () => {
        await LibraryWatcher.refresh();
      })
      .catch(() => { })
      .finally(() => cleanup?.());
  }

  function restoreError(error: unknown) {
    return { message: errorMessage(error), needsPassword: error instanceof Backups.PasswordNeeded };
  }

  /**
   * @swagger
   * /api/setup/backups:
   *   get:
   *     summary: Backups found in the backup folder, which a new server can be restored from. Only before setup.
   */
  router.get("/backups", async (c) => {
    if (!(await ServerController.needsSetup())) return c.json({ message: "Cinemion has already been set up." }, 409);
    return c.json({ folder: AppSystem.backupsDir, backups: await Backups.list(AppSystem.backupsDir) });
  });

  /**
   * @swagger
   * /api/setup/restore:
   *   get:
   *     summary: How the restore is going.
   */
  router.get("/restore", (c) => c.json(Backups.restoreStatus()));

  /**
   * @swagger
   * /api/setup/restore:
   *   post:
   *     summary: Restore a backup from the backup folder instead of setting up. Only before setup.
   */
  router.post("/restore", async (c) => {
    if (!(await ServerController.needsSetup())) return c.json({ message: "Cinemion has already been set up." }, 409);
    if (Backups.restoreStatus().state === "running") return c.json({ message: "A backup is being restored already." }, 409);
    const body = await readJson<{ name: string; password: string | null }>(c);
    const path = body?.name ? await Backups.pathOf(body.name, AppSystem.backupsDir) : null;
    if (!path) return c.json({ message: "That backup isn't in the backup folder." }, 404);
    try {
      await startRestore(path, body?.password || null);
    } catch (error) {
      return c.json(restoreError(error), 400);
    }
    return c.json(Backups.restoreStatus());
  });

  /**
   * @swagger
   * /api/setup/restore/upload:
   *   post:
   *     summary: Restore a backup sent as the request body instead of setting up. The password, if any, goes in the
   *       `X-Backup-Password` header, URL-encoded. Only before setup.
   */
  router.post("/restore/upload", async (c) => {
    if (!(await ServerController.needsSetup())) return c.json({ message: "Cinemion has already been set up." }, 409);
    if (Backups.restoreStatus().state === "running") return c.json({ message: "A backup is being restored already." }, 409);
    const body = c.req.raw.body;
    if (!body) return c.json({ message: "Send the backup file as the request body." }, 400);
    const header = c.req.header("X-Backup-Password");
    const password = header ? decodeURIComponent(header) : null;

    // Next to the database, which is where the room is needed anyway
    const path = Path.join(AppSystem.config.CONFIG_DIR, `.upload-${crypto.randomUUID()}.backup`);
    const cleanup = () => fsp.rm(path, { force: true });
    try {
      const file = await Deno.open(path, { write: true, create: true, truncate: true });
      await body.pipeTo(file.writable);
    } catch (error) {
      await cleanup();
      return c.json({ message: `The backup didn't arrive in one piece: ${errorMessage(error)}` }, 400);
    }
    try {
      await startRestore(path, password, cleanup);
    } catch (error) {
      return c.json(restoreError(error), 400);
    }
    return c.json(Backups.restoreStatus());
  });

  //#endregion
}

export default SetupController;
