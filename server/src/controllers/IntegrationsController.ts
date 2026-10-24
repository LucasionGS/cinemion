import { Hono } from "hono";
import type { CreatePodiumTargetRequest, PathMapping, PodiumTargets } from "@shared/admin.ts";
import type { SaveTraktAppRequest } from "@shared/trakt.ts";
import { User } from "../models/index.ts";
import ArrWebhook from "../integrations/ArrWebhook.ts";
import CompatApi from "../integrations/CompatApi.ts";
import Podium from "../integrations/Podium.ts";
import PodiumController from "./PodiumController.ts";
import Trakt from "../integrations/Trakt.ts";
import RateLimit from "../lib/RateLimit.ts";
import Network from "../lib/Network.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Sonarr and Radarr (the address they send to, and the path mappings between their folders and ours), keys for apps
 * like Seerr and Homepage, and the server's Trakt app.
 */
export namespace IntegrationsController {
  export const router = new Hono<AppEnv>();

  const manage = User.$middleware({ permissions: ["SERVER_MANAGE"] });
  // App keys act as the admin who made them, so only admins see and make them
  const admin = User.$middleware({ admin: true });
  // Wrong tokens from one address are slowed down, so the address can't be guessed
  const limiter = new RateLimit(10, 60);

  /**
   * @swagger
   * /api/integrations:
   *   get:
   *     summary: The Sonarr/Radarr address, path mappings and the last event received.
   */
  router.get("/", manage, async (c) => c.json(ArrWebhook.toClient(await ArrWebhook.stored())));

  /**
   * @swagger
   * /api/integrations:
   *   put:
   *     summary: Change the path mappings. Body `{ "pathMappings": [{ "from": "/tv", "to": "/media/shows" }] }`.
   */
  router.put("/", manage, async (c) => {
    const body = await readJson<{ pathMappings: PathMapping[] }>(c);
    if (!Array.isArray(body?.pathMappings)) return c.json({ message: "Send the full list of path mappings." }, 400);
    const mappings: PathMapping[] = [];
    for (const m of body.pathMappings) {
      const from = typeof m?.from === "string" ? m.from.trim() : "";
      const to = typeof m?.to === "string" ? m.to.trim() : "";
      if (!from && !to) continue;
      if (!from || !to) return c.json({ message: "Each path mapping needs both folders." }, 400);
      if (!to.startsWith("/") && !/^[a-z]:[\\/]/i.test(to)) return c.json({ message: `"${to}" must be a full path, like /media/shows.` }, 400);
      mappings.push({ from, to });
    }
    return c.json(ArrWebhook.toClient(await ArrWebhook.save({ pathMappings: mappings })));
  });

  /**
   * @swagger
   * /api/integrations/trakt:
   *   get:
   *     summary: The server's Trakt app (client ID, and whether there's a secret).
   */
  router.get("/trakt", manage, async (c) => c.json(await Trakt.appSettings()));

  /**
   * @swagger
   * /api/integrations/trakt:
   *   put:
   *     summary: Set the Trakt app's client ID and secret (`SaveTraktAppRequest`).
   */
  router.put("/trakt", manage, async (c) => {
    const body = await readJson<SaveTraktAppRequest>(c);
    if (!body) return c.json({ message: "Nothing to change." }, 400);
    return c.json(await Trakt.saveApp(body));
  });

  /**
   * @swagger
   * /api/integrations/keys:
   *   get:
   *     summary: Keys that apps like Seerr and Homepage use to reach Cinemion. Admins only.
   */
  router.get("/keys", admin, async (c) => c.json(await CompatApi.keysForClient()));

  /**
   * @swagger
   * /api/integrations/keys:
   *   post:
   *     summary: Make a key for an app. Body `{ "app": "Homepage" }`. The key acts as the signed-in admin.
   */
  router.post("/keys", admin, async (c) => {
    const user = c.get("user")!;
    const body = await readJson<{ app: string }>(c);
    try {
      const key = await CompatApi.createKey(typeof body?.app === "string" ? body.app : "", user);
      return c.json((await CompatApi.keysForClient()).find((k) => k.id === key.id));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/integrations/keys/{id}:
   *   delete:
   *     summary: Remove an app key. The app using it can't reach Cinemion anymore.
   */
  router.delete("/keys/:id", admin, async (c) => {
    if (!await CompatApi.removeKey(c.req.param("id"))) return c.json({ message: "That key doesn't exist." }, 404);
    return c.json(await CompatApi.keysForClient());
  });

  async function podiumTargets(c: Parameters<typeof PodiumController.originOf>[0]): Promise<PodiumTargets> {
    return { serverUrl: `${PodiumController.originOf(c)}/api/podium`, targets: await Podium.targetsForClient() };
  }

  /**
   * @swagger
   * /api/integrations/podium:
   *   get:
   *     summary: Upload targets for Podium, and the server URL to paste into it.
   */
  router.get("/podium", manage, async (c) => c.json(await podiumTargets(c)));

  /**
   * @swagger
   * /api/integrations/podium:
   *   post:
   *     summary: Make an upload target for Podium. Body is a `CreatePodiumTargetRequest`. Uploads act as the signed-in profile.
   */
  router.post("/podium", manage, async (c) => {
    const body = await readJson<CreatePodiumTargetRequest>(c);
    try {
      await Podium.createTarget(c.get("user")!, body ?? {});
      return c.json(await podiumTargets(c), 201);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/integrations/podium/{id}:
   *   delete:
   *     summary: Remove a Podium upload target. Podium can't upload with its token anymore.
   */
  router.delete("/podium/:id", manage, async (c) => {
    if (!await Podium.removeTarget(c.req.param("id"))) return c.json({ message: "That upload target doesn't exist." }, 404);
    return c.json(await podiumTargets(c));
  });

  /**
   * @swagger
   * /api/integrations/arr/token:
   *   post:
   *     summary: Make a new receiver address. The old one stops working.
   */
  router.post("/arr/token", manage, async (c) => c.json(ArrWebhook.toClient(await ArrWebhook.save({ arrToken: ArrWebhook.newToken() }))));

  /**
   * @swagger
   * /api/integrations/arr/{token}:
   *   post:
   *     summary: Where Sonarr and Radarr send their webhooks. Imports, renames and deletes rescan the folders they touched.
   */
  router.post("/arr/:token", async (c) => {
    const key = `arr:${Network.clientAddress(c) ?? "unknown"}`;
    const locked = limiter.lockedFor(key);
    if (locked) return c.json({ message: `Too many wrong addresses. Try again in ${locked} seconds.` }, 429);
    if (!await ArrWebhook.checkToken(c.req.param("token"))) {
      limiter.fail(key);
      return c.json({ message: "This address isn't valid anymore. Copy the current one from Cinemion's Settings › Integrations." }, 404);
    }

    const body = await c.req.json().catch(() => null);
    const event = await ArrWebhook.handle(body);
    if (!event) return c.json({ message: "That isn't a Sonarr or Radarr webhook." }, 400);
    return c.json({ message: event.result });
  });
}

export default IntegrationsController;
