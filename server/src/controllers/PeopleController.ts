import { Hono } from "hono";
import { Op } from "sequelize";
import type { PersonDetail } from "@shared/media.ts";
import { Credit, MediaItem, Person, User } from "../models/index.ts";
import Visibility from "../library/Visibility.ts";
import Summaries from "../library/Summaries.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace PeopleController {
  export const router = new Hono<AppEnv>();

  /**
   * @swagger
   * /api/people/{id}:
   *   get:
   *     summary: A person and the titles they're in (that the profile may see), newest first.
   */
  router.get("/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const person = await Person.findByPk(Number(c.req.param("id")));
    if (!person) return c.json({ message: "That person doesn't exist." }, 404);

    const credits = await Credit.findAll({ where: { personId: person.id } });
    const items = await MediaItem.findAll({
      where: { [Op.and]: [Visibility.where(user), { id: [...new Set(credits.map((cr) => cr.itemId))] }] },
      order: [["year", "DESC"], ["sortTitle", "ASC"]],
    });
    const summaries = new Map((await Summaries.build(items, user)).map((s) => [s.id, s]));

    const detail: PersonDetail = {
      id: person.id,
      name: person.name,
      photo: person.photo,
      credits: items.map((item) => {
        // Someone can be both director and actor; acting roles come first
        const own = credits.filter((cr) => cr.itemId === item.id).sort((a, b) => (a.kind === "cast" ? 0 : 1) - (b.kind === "cast" ? 0 : 1));
        return { item: summaries.get(item.id)!, kind: own[0].kind, character: own[0].character };
      }),
    };
    return c.json(detail);
  });
}

export default PeopleController;
