import { Hono } from "hono";
import type { SaveWebhookRequest } from "@shared/admin.ts";
import { User, Webhook } from "../models/index.ts";
import Webhooks from "../integrations/Webhooks.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Outgoing webhooks: addresses that get JSON when things happen.
 */
export namespace WebhooksController {
  export const router = new Hono<AppEnv>();

  router.use("*", User.$middleware({ permissions: ["SERVER_MANAGE"] }));

  async function find(id: string) {
    return await Webhook.findByPk(Number(id));
  }

  /**
   * @swagger
   * /api/webhooks:
   *   get:
   *     summary: Every webhook, with how its last send went.
   */
  router.get("/", async (c) => {
    return c.json((await Webhook.findAll({ order: [["id", "ASC"]] })).map((w) => w.toClientJSON()));
  });

  /**
   * @swagger
   * /api/webhooks:
   *   post:
   *     summary: Add a webhook. Body is a `SaveWebhookRequest`. A signing secret is made for it.
   */
  router.post("/", async (c) => {
    try {
      const data = Webhook.validate(await readJson<SaveWebhookRequest>(c) ?? {});
      const hook = await Webhook.create({ ...data, secret: Webhook.newSecret() });
      return c.json(hook.toClientJSON(), 201);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/webhooks/{id}:
   *   put:
   *     summary: Change a webhook. Body is a `SaveWebhookRequest`.
   */
  router.put("/:id", async (c) => {
    const hook = await find(c.req.param("id"));
    if (!hook) return c.json({ message: "That webhook doesn't exist." }, 404);
    try {
      const body = await readJson<SaveWebhookRequest>(c) ?? {};
      await hook.update(Webhook.validate({ ...hook.toClientJSON(), ...body }));
      return c.json(hook.toClientJSON());
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/webhooks/{id}:
   *   delete:
   *     summary: Remove a webhook.
   */
  router.delete("/:id", async (c) => {
    const hook = await find(c.req.param("id"));
    if (!hook) return c.json({ message: "That webhook doesn't exist." }, 404);
    await hook.destroy();
    return c.body(null, 204);
  });

  /**
   * @swagger
   * /api/webhooks/{id}/test:
   *   post:
   *     summary: Send a `test` event now and say how it went.
   */
  router.post("/:id/test", async (c) => {
    const hook = await find(c.req.param("id"));
    if (!hook) return c.json({ message: "That webhook doesn't exist." }, 404);
    await Webhooks.test(hook);
    await hook.reload();
    return c.json(hook.toClientJSON());
  });

  /**
   * @swagger
   * /api/webhooks/{id}/secret:
   *   post:
   *     summary: Make a new signing secret. Receivers checking the old one will reject sends until they're updated.
   */
  router.post("/:id/secret", async (c) => {
    const hook = await find(c.req.param("id"));
    if (!hook) return c.json({ message: "That webhook doesn't exist." }, 404);
    await hook.update({ secret: Webhook.newSecret() });
    return c.json(hook.toClientJSON());
  });
}

export default WebhooksController;
