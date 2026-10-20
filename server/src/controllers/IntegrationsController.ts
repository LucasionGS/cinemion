import { Hono } from "hono";
import type { PathMapping } from "@shared/admin.ts";
import { User } from "../models/index.ts";
import ArrWebhook from "../integrations/ArrWebhook.ts";
import RateLimit from "../lib/RateLimit.ts";
import Network from "../lib/Network.ts";
import { readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Sonarr and Radarr: the address they send to, and the path mappings between their folders and ours.
 */
export namespace IntegrationsController {
  export const router = new Hono<AppEnv>();

  const manage = User.$middleware({ permissions: ["SERVER_MANAGE"] });
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
