import { Hono } from "hono";
import { upgradeWebSocket } from "hono/deno";
import type { TogetherPreview } from "@shared/together.ts";
import { parseRoomCode } from "@shared/together.ts";
import { MediaItem, User } from "../models/index.ts";
import Visibility from "../library/Visibility.ts";
import Summaries from "../library/Summaries.ts";
import WatchTogether from "../together/WatchTogether.ts";
import ItemLabels from "../library/ItemLabels.ts";
import Events from "../integrations/Events.ts";
import { readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace TogetherController {
  export const router = new Hono<AppEnv>();

  /**
   * @swagger
   * /api/together:
   *   post:
   *     summary: Start watching a movie or episode together. Body `{ "itemId": 12, "position": 0 }`. Returns the room code.
   */
  router.post("/", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const body = await readJson<{ itemId: number; position: number }>(c);
    const item = body?.itemId ? await MediaItem.findByPk(Number(body.itemId)) : null;
    if (!item || !Visibility.canSee(user, item)) return c.json({ message: "That title doesn't exist." }, 404);
    if (item.type !== "movie" && item.type !== "episode") return c.json({ message: "Only movies and episodes can be watched together." }, 400);
    const room = WatchTogether.create(user, item.id, Math.max(0, Number(body?.position) || 0));
    const label = await ItemLabels.describe(item);
    Events.emit("together.started", { host: { id: user.id, name: user.name }, item: await ItemLabels.forWebhook(item, label.show), code: room.code }, {
      kind: "together",
      message: `${user.name} started watching ${label.inline} together`,
      userId: user.id,
      itemId: item.id,
    });
    return c.json({ code: room.code });
  });

  /**
   * @swagger
   * /api/together/ws:
   *   get:
   *     summary: The WebSocket for a room. The first message must be `{ "type": "hello", "token", "code", "device" }`.
   */
  router.get("/ws", upgradeWebSocket(() => {
    let connection: WatchTogether.Connection | null = null;
    return {
      onOpen(_event, ws) {
        connection = new WatchTogether.Connection({
          send: (data) => ws.send(data),
          close: (code, reason) => ws.close(code, reason),
        });
      },
      onMessage(event) {
        if (typeof event.data === "string") connection?.receive(event.data);
      },
      onClose() {
        connection?.close();
        connection = null;
      },
    };
  }));

  /**
   * @swagger
   * /api/together/{code}:
   *   get:
   *     summary: What's playing in a room and who's there, for the join page.
   */
  router.get("/:code", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const room = WatchTogether.get(parseRoomCode(c.req.param("code")));
    if (!room) return c.json({ message: "There's no session with that code. It may have ended; ask for a new one." }, 404);
    const item = await MediaItem.findByPk(room.itemId);
    if (!item || !Visibility.canSee(user, item)) return c.json({ message: "This profile can't watch what's playing in that session." }, 403);
    const host = await User.findByPk(room.hostUserId);
    const info = WatchTogether.info(room);
    const preview: TogetherPreview = {
      code: room.code,
      item: await Summaries.one(item, user),
      host: host!.toProfileJSON(),
      state: room.state,
      members: info.members,
      serverTime: Date.now(),
    };
    return c.json(preview);
  });
}

export default TogetherController;
