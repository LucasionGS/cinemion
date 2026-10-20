import { Hono } from "hono";
import type { LoginResponse, MetadataSettings, SetupRequest } from "@shared/api.ts";
import { Library, Role, Setting, User } from "../models/index.ts";
import ServerController from "./ServerController.ts";
import MediaRoots from "../lib/MediaRoots.ts";
import Scanner from "../library/Scanner.ts";
import LibraryWatcher from "../library/LibraryWatcher.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import log from "../lib/Logger.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace SetupController {
  export const router = new Hono<AppEnv>();

  export const DEFAULT_METADATA: MetadataSettings = {
    tmdbApiKey: null,
    language: "en",
    country: "US",
    providers: ["local", "tmdb"],
  };

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
      await Setting.set(Setting.Keys.METADATA, { ...DEFAULT_METADATA, ...body.metadata });
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
}

export default SetupController;
