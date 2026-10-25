import { Hono, type Context } from "hono";
import type { LoginResponse } from "@shared/api.ts";
import { User } from "../models/index.ts";
import RateLimit from "../lib/RateLimit.ts";
import Network from "../lib/Network.ts";
import UserAgent from "../lib/UserAgent.ts";
import Events from "../integrations/Events.ts";
import { readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace AuthController {
  export const router = new Hono<AppEnv>();

  // 5 wrong guesses lock that profile (or username) for 30 seconds
  const limiter = new RateLimit(5, 30);

  async function respond(c: Context<AppEnv>, user: User): Promise<LoginResponse> {
    const device = UserAgent.fromRequest(c);
    const isRemote = Network.isRemote(c);
    // Switching profiles on the same TV all evening is one line in the feed, not ten
    Events.emit("user.signedIn", { user: { id: user.id, name: user.name }, device, isRemote }, {
      kind: "signIn",
      message: isRemote ? `${user.name} signed in away from home (${device})` : `${user.name} signed in (${device})`,
      userId: user.id,
      dedupeHours: 6,
    });
    return { token: await user.createToken(), user: await user.toClientJSON() };
  }

  function lockedMessage(seconds: number) {
    return { message: `Too many wrong attempts. Try again in ${seconds} seconds.` };
  }

  /**
   * @swagger
   * /api/auth/login:
   *   post:
   *     summary: Sign in with a username and password.
   */
  router.post("/login", async (c) => {
    const body = await readJson<{ username: string; password: string }>(c);
    if (!body?.username || !body.password) {
      return c.json({ message: "Username and password are required." }, 400);
    }

    const key = `user:${body.username.trim().toLowerCase()}`;
    const locked = limiter.lockedFor(key);
    if (locked) return c.json(lockedMessage(locked), 429);

    const user = await User.authenticateUser(body.username, body.password);
    if (!user) {
      limiter.fail(key);
      return c.json({ message: "That username and password don't match." }, 401);
    }
    limiter.reset(key);
    return c.json(await respond(c, user));
  });

  /**
   * @swagger
   * /api/auth/profile:
   *   post:
   *     summary: Sign in from the profile picker. Needs the PIN when the profile has one, and the password for admins without a PIN.
   */
  router.post("/profile", async (c) => {
    const body = await readJson<{ userId: number; pin?: string; password?: string }>(c);
    const user = body?.userId ? await User.findByPk(Number(body.userId)) : null;
    if (!user || !user.showOnPicker) return c.json({ message: "That profile doesn't exist." }, 404);

    const key = `profile:${user.id}`;
    const locked = limiter.lockedFor(key);
    if (locked) return c.json(lockedMessage(locked), 429);

    let ok: boolean;
    if (user.pin !== null) ok = typeof body?.pin === "string" && await user.checkPin(body.pin);
    // An admin profile without a PIN must never open with a single click
    else if (user.isAdmin()) ok = typeof body?.password === "string" && await user.checkPassword(body.password);
    else ok = true;

    if (!ok) {
      limiter.fail(key);
      return c.json({ message: user.pin !== null ? "That PIN isn't right." : "That password isn't right." }, 401);
    }
    limiter.reset(key);
    return c.json(await respond(c, user));
  });

  /**
   * @swagger
   * /api/auth/me:
   *   get:
   *     summary: The signed-in user.
   */
  router.get("/me", User.$middleware(), async (c) => {
    return c.json(await c.get("user")!.toClientJSON());
  });
}

export default AuthController;
