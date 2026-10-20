import fsp from "node:fs/promises";
import { Hono } from "hono";
import ImageCache from "../images/ImageCache.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace ImagesController {
  export const router = new Hono<AppEnv>();

  /**
   * @swagger
   * /api/images/{key}:
   *   get:
   *     summary: Artwork, resized to at most `w` pixels wide (default 500). Public, so `<img>` tags can load it; keys are unguessable hashes.
   */
  router.get("/:key", async (c) => {
    const width = parseInt(c.req.query("w") ?? "500") || 500;
    const path = await ImageCache.variant(c.req.param("key"), width);
    const data = path ? await fsp.readFile(path).catch(() => null) : null;
    if (!data) return c.json({ message: "Unknown image." }, 404);
    // Keys change whenever the artwork does, so a key's image never changes
    return c.body(new Uint8Array(data), 200, {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });
}

export default ImagesController;
