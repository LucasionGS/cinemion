import { Hono } from "hono";
import type { HttpsSettingsUpdate } from "@shared/https.ts";
import { User } from "../models/index.ts";
import Https from "../https/Https.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Settings › HTTPS, and Cinemion's certificate authority for devices to trust.
 */
export namespace HttpsController {
  export const router = new Hono<AppEnv>();

  /**
   * @swagger
   * /api/https/cinemion-ca.crt:
   *   get:
   *     summary: Cinemion's certificate authority, to install on devices so they trust its https certificate. Public,
   *       so phones can open it straight from the setup instructions.
   */
  router.get("/cinemion-ca.crt", async (c) => {
    const pem = await Https.authorityCertificate();
    if (!pem) return c.json({ message: "Cinemion hasn't made its certificate yet. Turn on https in Settings › HTTPS first." }, 404);
    return c.body(pem, 200, { "Content-Type": "application/x-x509-ca-cert", "Content-Disposition": "attachment; filename=\"cinemion-ca.crt\"" });
  });

  router.use("*", User.$middleware({ permissions: ["SERVER_MANAGE"] }));

  function host(c: { req: { url: string } }) {
    try {
      return new URL(c.req.url).hostname;
    } catch {
      return null;
    }
  }

  /**
   * @swagger
   * /api/https:
   *   get:
   *     summary: Whether https is on, its certificate and the addresses to use.
   */
  router.get("/", async (c) => c.json(await Https.status(host(c))));

  /**
   * @swagger
   * /api/https:
   *   put:
   *     summary: Change the https settings. Answers once https was started (or failed to).
   */
  router.put("/", async (c) => {
    const body = await readJson<HttpsSettingsUpdate>(c);
    if (!body) return c.json({ message: "Send the settings to change as JSON." }, 400);
    try {
      await Https.update(body);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
    return c.json(await Https.status(host(c)));
  });

  /**
   * @swagger
   * /api/https/renew:
   *   post:
   *     summary: Get or make a new certificate now.
   */
  router.post("/renew", async (c) => {
    await Https.renew();
    return c.json(await Https.status(host(c)));
  });
}

export default HttpsController;
