import type { User } from "../models/User.ts";

/**
 * Hono environment shared by every route. `user` is set by `User.$middleware()`.
 */
export type AppEnv = {
  Variables: {
    user: User | undefined;
  };
};
