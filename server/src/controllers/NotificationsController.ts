import { Hono } from "hono";
import type { EmailSettingsUpdate } from "@shared/notifications.ts";
import { User } from "../models/index.ts";
import Notifications from "../notifications/Notifications.ts";
import Mailer from "../notifications/Mailer.ts";
import UserAgent from "../lib/UserAgent.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * The bell in the top bar, push notifications on this profile's devices, and the server's email settings.
 */
export namespace NotificationsController {
  export const router = new Hono<AppEnv>();
  const manage = User.$middleware({ permissions: ["SERVER_MANAGE"] });

  router.use("*", User.$middleware());

  /**
   * @swagger
   * /api/notifications:
   *   get:
   *     summary: The profile's latest notifications and how many are unread.
   */
  router.get("/", async (c) => c.json(await Notifications.list(c.get("user")!)));

  /**
   * @swagger
   * /api/notifications/read:
   *   post:
   *     summary: Mark notifications read, by `ids`, or all of them without.
   */
  router.post("/read", async (c) => {
    const user = c.get("user")!;
    const body = await readJson<{ ids: number[] }>(c);
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => Number.isInteger(id)) : undefined;
    await Notifications.markRead(user, ids);
    return c.json(await Notifications.list(user));
  });

  /**
   * @swagger
   * /api/notifications/setup:
   *   get:
   *     summary: The push key, whether email works, and this profile's devices. `?endpoint=` marks the asking browser.
   */
  router.get("/setup", async (c) => c.json(await Notifications.setup(c.get("user")!, c.req.query("endpoint"))));

  /**
   * @swagger
   * /api/notifications/push:
   *   post:
   *     summary: Send push notifications to this browser, from its `PushSubscription` as JSON.
   */
  router.post("/push", async (c) => {
    const user = c.get("user")!;
    const body = await readJson<{ endpoint: string; keys: { p256dh: string; auth: string } }>(c);
    try {
      await Notifications.subscribe(user, body ?? {}, UserAgent.fromRequest(c));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
    return c.json(await Notifications.setup(user, body?.endpoint));
  });

  /**
   * @swagger
   * /api/notifications/push:
   *   delete:
   *     summary: Stop push notifications to a device, by `?id=` or `?endpoint=`.
   */
  router.delete("/push", async (c) => {
    const user = c.get("user")!;
    const id = c.req.query("id");
    const endpoint = c.req.query("endpoint");
    await Notifications.unsubscribe(user, id ? { id: Number(id) } : { endpoint });
    return c.json(await Notifications.setup(user, endpoint));
  });

  /**
   * @swagger
   * /api/notifications/push/test:
   *   post:
   *     summary: Send a test notification to every device of this profile.
   */
  router.post("/push/test", async (c) => c.json({ sent: await Notifications.testPush(c.get("user")!) }));

  /**
   * @swagger
   * /api/notifications/email:
   *   get:
   *     summary: How the server sends email. `null` when it doesn't.
   */
  router.get("/email", manage, async (c) => c.json(await Mailer.settings()));

  /**
   * @swagger
   * /api/notifications/email:
   *   put:
   *     summary: Change how the server sends email. An empty host turns email off.
   */
  router.put("/email", manage, async (c) => {
    const body = await readJson<EmailSettingsUpdate>(c);
    if (!body) return c.json({ message: "Send the settings as JSON." }, 400);
    try {
      await Mailer.update(body);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
    return c.json(await Mailer.settings());
  });

  /**
   * @swagger
   * /api/notifications/email/test:
   *   post:
   *     summary: Send a test email to `to`.
   */
  router.post("/email/test", manage, async (c) => {
    const body = await readJson<{ to: string }>(c);
    if (!body?.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.to)) return c.json({ message: "Enter the address to send the test to." }, 400);
    try {
      await Mailer.send({ to: body.to, subject: "Cinemion can send email", text: "This is a test from Cinemion. Notification emails will arrive like this one." });
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 502);
    }
    return c.json({ sent: true });
  });
}

export default NotificationsController;
