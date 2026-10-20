import fsp from "node:fs/promises";
import Path from "node:path";
import { Hono, type Context } from "hono";
import AppSystem from "./AppSystem.ts";
import ApiController from "./controllers/ApiController.ts";
import log from "./lib/Logger.ts";
import type { AppEnv } from "./lib/types.ts";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * In development, everything outside `/api` comes from the Vite dev server, so the whole app runs on one port.
 */
async function proxyToVite(c: Context<AppEnv>) {
  const url = new URL(c.req.url);
  const target = AppSystem.config.VITE_DEV_URL + url.pathname + url.search;
  try {
    const response = await fetch(target, { method: c.req.method, headers: c.req.raw.headers, redirect: "manual" });
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch {
    return c.text(`The Vite dev server isn't reachable at ${AppSystem.config.VITE_DEV_URL}. Start it with "deno task dev:client".`, 502);
  }
}

/**
 * In production, serve the built client, falling back to `index.html` for client-side routes.
 */
async function serveClient(c: Context<AppEnv>) {
  const root = AppSystem.clientDir;
  const requested = Path.normalize(Path.join(root, decodeURIComponent(new URL(c.req.url).pathname)));
  const insideRoot = requested.startsWith(root + Path.sep);
  const file = insideRoot && (await fsp.stat(requested).catch(() => null))?.isFile() ? requested : Path.join(root, "index.html");

  const data = await fsp.readFile(file).catch(() => null);
  if (!data) return c.text("The web client hasn't been built. Run \"deno task build\" first.", 500);

  const isAsset = file.startsWith(Path.join(root, "assets") + Path.sep);
  return c.body(new Uint8Array(data), 200, {
    "Content-Type": CONTENT_TYPES[Path.extname(file)] ?? "application/octet-stream",
    // Built assets have content hashes in their names; index.html must always be fresh
    "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
  });
}

export function createApp() {
  const app = new Hono<AppEnv>();

  app.onError((error, c) => {
    log.error(`${c.req.method} ${c.req.path} failed`, { error });
    return c.json({ message: "Something went wrong on the server. The server log has the details." }, 500);
  });

  app.route("/api", ApiController.router);
  if (AppSystem.isDev()) app.all("*", proxyToVite);
  else app.get("*", serveClient);

  return app;
}

export default createApp;
