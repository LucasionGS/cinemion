import { type Context, Hono } from "hono";
import AppSystem from "../AppSystem.ts";
import { Setting } from "../models/index.ts";
import Podium from "../integrations/Podium.ts";
import Uploads from "../library/Uploads.ts";
import RateLimit from "../lib/RateLimit.ts";
import Network from "../lib/Network.ts";
import log from "../lib/Logger.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Podium's upload protocol, at `/api/podium` (the "Server URL" in Podium). Errors are Podium's
 * `{ "error": { "code", "message" } }` rather than Cinemion's own shape. Upload targets are made in
 * Settings › Integrations (see `IntegrationsController`).
 */
export namespace PodiumController {
  export const router = new Hono<AppEnv>();

  const limiter = new RateLimit(10, 60);
  const MAX_JSON_BYTES = 64 * 1024;

  /**
   * Where links back to Cinemion start: `SITE_URL`, or the address the request came in on (through a reverse
   * proxy's forwarded headers when there is one).
   */
  export function originOf(c: Context<AppEnv>) {
    const site = AppSystem.config.SITE_URL.replace(/\/+$/, "");
    if (site) return site;
    const url = new URL(c.req.url);
    const proto = c.req.header("X-Forwarded-Proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
    const host = c.req.header("X-Forwarded-Host")?.split(",")[0].trim() || c.req.header("Host") || url.host;
    return `${proto}://${host}`;
  }

  function fail(c: Context<AppEnv>, error: unknown) {
    if (error instanceof Podium.Problem) {
      if (error.status === 401) c.header("WWW-Authenticate", "Bearer");
      // deno-lint-ignore no-explicit-any
      return c.json({ error: { code: error.code, message: error.message }, ...error.extra }, error.status as any);
    }
    log.error("A Podium upload request failed", { error });
    return c.json({ error: { code: "server_error", message: "Something went wrong in Cinemion. Its log has the details." } }, 500);
  }

  /**
   * The upload target behind the request's token, with wrong tokens slowed down per address.
   */
  async function caller(c: Context<AppEnv>) {
    const key = `podium:${Network.clientAddress(c) ?? "unknown"}`;
    const locked = limiter.lockedFor(key);
    if (locked) {
      c.header("Retry-After", String(locked));
      throw new Podium.Problem(429, "rate_limited", `Too many wrong tokens. Try again in ${locked} seconds.`);
    }
    const token = c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1].trim() ?? null;
    try {
      const result = await Podium.authenticate(token);
      limiter.reset(key);
      return result;
    } catch (error) {
      if (error instanceof Podium.Problem && error.status === 401) limiter.fail(key);
      throw error;
    }
  }

  async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
    const text = await c.req.text().catch(() => "");
    if (text.length > MAX_JSON_BYTES) throw new Podium.Problem(413, "invalid_request", "The request body is too large.");
    if (!text.trim()) return {};
    try {
      const value = JSON.parse(text);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // Falls through to the error below
    }
    throw new Podium.Problem(400, "invalid_request", "The request body must be a JSON object.");
  }

  /**
   * @swagger
   * /api/podium/server:
   *   get:
   *     summary: Podium upload protocol. What this target is and whether the token is good.
   */
  router.get("/server", async (c) => {
    try {
      const { target, user, library } = await caller(c);
      const serverName = await Setting.get<string>(Setting.Keys.SERVER_NAME, AppSystem.APP_NAME);
      const maxFileSize = Uploads.maxSize();
      return c.json({
        protocol: "podium-upload",
        versions: Podium.VERSIONS,
        name: target.name === library.name ? `${serverName} · ${library.name}` : target.name,
        account: { name: user.name },
        ...(maxFileSize !== null ? { maxFileSize } : {}),
        accept: Podium.acceptedTypes(library),
      });
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * @swagger
   * /api/podium/uploads:
   *   post:
   *     summary: Podium upload protocol. Open an upload for one file, or answer with the clip when the library already has it.
   */
  router.post("/uploads", async (c) => {
    try {
      const result = await Podium.start(await caller(c), await readBody(c), originOf(c));
      return c.json(result.body, result.status);
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * @swagger
   * /api/podium/uploads/{id}:
   *   put:
   *     summary: Podium upload protocol. One piece of the file, at the byte `Content-Range` says.
   */
  router.put("/uploads/:id", async (c) => {
    try {
      const who = await caller(c);
      // Example: Content-Range: bytes 0-8388607/187465321
      const range = c.req.header("Content-Range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (!range) throw new Podium.Problem(400, "invalid_request", "Send a `Content-Range: bytes a-b/size` header.");
      return c.json(await Podium.receive(who, c.req.param("id"), { first: Number(range[1]), last: Number(range[2]), size: Number(range[3]) }, c.req.raw.body));
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * @swagger
   * /api/podium/uploads/{id}:
   *   get:
   *     summary: Podium upload protocol. How many bytes of an upload have arrived.
   */
  router.get("/uploads/:id", async (c) => {
    try {
      const { info } = Podium.upload(await caller(c), c.req.param("id"));
      return c.json({ id: info.id, offset: info.received, size: info.size });
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * @swagger
   * /api/podium/uploads/{id}/complete:
   *   post:
   *     summary: Podium upload protocol. Every byte is there; check it, add it to the library and answer with its link.
   */
  router.post("/uploads/:id/complete", async (c) => {
    try {
      return c.json(await Podium.complete(await caller(c), c.req.param("id"), originOf(c)), 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * @swagger
   * /api/podium/uploads/{id}:
   *   delete:
   *     summary: Podium upload protocol. Stop an upload and delete what arrived.
   */
  router.delete("/uploads/:id", async (c) => {
    try {
      await Podium.cancel(await caller(c), c.req.param("id"));
      return c.body(null, 204);
    } catch (error) {
      return fail(c, error);
    }
  });
}

export default PodiumController;
