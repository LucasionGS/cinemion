import { Hono } from "hono";
import type { StatsPeriod } from "@shared/stats.ts";
import { User } from "../models/index.ts";
import Statistics from "../stats/Statistics.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Statistics: the profile's own, the whole server's for people who manage it, and a year in review.
 */
export namespace StatsController {
  export const router = new Hono<AppEnv>();
  const PERIODS: StatsPeriod[] = ["week", "month", "year", "all"];

  router.use("*", User.$middleware());

  function period(value: string | undefined): StatsPeriod {
    return PERIODS.includes(value as StatsPeriod) ? value as StatsPeriod : "month";
  }

  /**
   * @swagger
   * /api/stats/me:
   *   get:
   *     summary: The signed-in profile's statistics for `?period=week|month|year|all`.
   */
  router.get("/me", async (c) => c.json(await Statistics.forProfile(c.get("user")!, period(c.req.query("period")))));

  /**
   * @swagger
   * /api/stats/server:
   *   get:
   *     summary: Everyone's statistics, and what nobody watches. Profiles that keep theirs private only count in the totals.
   */
  router.get("/server", User.$middleware({ permissions: ["SERVER_MANAGE"] }), async (c) => c.json(await Statistics.forServer(period(c.req.query("period")))));

  /**
   * @swagger
   * /api/stats/year/{year}:
   *   get:
   *     summary: A year in review for the profile, or with `?scope=household` for everyone.
   */
  router.get("/year/:year", async (c) => {
    const year = Number(c.req.param("year"));
    if (!Number.isInteger(year) || year < 2000 || year > new Date().getFullYear()) return c.json({ message: "Pick a year up to this one." }, 400);
    return c.json(await Statistics.yearInReview(c.get("user")!, year, c.req.query("scope") === "household" ? "household" : "me"));
  });
}

export default StatsController;
