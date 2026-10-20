import { Hono } from "hono";
import type { MetadataSettings } from "@shared/api.ts";
import { Setting, User } from "../models/index.ts";
import SetupController from "./SetupController.ts";
import MetadataManager from "../metadata/MetadataManager.ts";
import Tasks from "../lib/Tasks.ts";
import { readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace SettingsController {
  export const router = new Hono<AppEnv>();

  const manage = User.$middleware({ permissions: ["SERVER_MANAGE"] });

  /**
   * @swagger
   * /api/settings/metadata:
   *   get:
   *     summary: Metadata sources, their order, language and country.
   */
  router.get("/metadata", manage, async (c) => {
    return c.json(await Setting.get<MetadataSettings>(Setting.Keys.METADATA, SetupController.DEFAULT_METADATA));
  });

  /**
   * @swagger
   * /api/settings/metadata:
   *   put:
   *     summary: Change metadata sources, their order, language or country.
   */
  router.put("/metadata", manage, async (c) => {
    const body = await readJson<MetadataSettings>(c);
    if (!body) return c.json({ message: "Nothing to change." }, 400);
    const current = await Setting.get<MetadataSettings>(Setting.Keys.METADATA, SetupController.DEFAULT_METADATA);
    const providers = body.providers ?? current.providers;
    const unknown = providers.find((p) => !MetadataManager.provider(p));
    if (unknown) return c.json({ message: `Unknown metadata source "${unknown}".` }, 400);

    const next: MetadataSettings = {
      tmdbApiKey: body.tmdbApiKey !== undefined ? (body.tmdbApiKey?.trim() || null) : current.tmdbApiKey,
      language: body.language ?? current.language,
      country: body.country ?? current.country,
      providers,
    };
    await Setting.set(Setting.Keys.METADATA, next);
    return c.json(next);
  });

  /**
   * @swagger
   * /api/settings/tasks:
   *   get:
   *     summary: Background jobs that are running, like library scans.
   */
  router.get("/tasks", User.$middleware({ permissions: ["LIBRARY_MANAGE"] }), (c) => c.json(Tasks.list()));
}

export default SettingsController;
