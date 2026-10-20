import { Hono } from "hono";
import { Op } from "sequelize";
import type { SearchResults } from "@shared/media.ts";
import { Credit, MediaItem, Person, User } from "../models/index.ts";
import CollectionsController from "./CollectionsController.ts";
import Visibility from "../library/Visibility.ts";
import Summaries from "../library/Summaries.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace SearchController {
  export const router = new Hono<AppEnv>();

  /**
   * A "contains" LIKE pattern. SQLite has no default escape character, so `%` and `_` act as wildcards,
   * which is harmless for searching.
   */
  function likePattern(query: string) {
    return `%${query}%`;
  }

  /**
   * @swagger
   * /api/search:
   *   get:
   *     summary: Find movies, shows, episodes, videos, people and collections by name. Query `q`.
   */
  router.get("/", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const query = (c.req.query("q") ?? "").trim();
    if (query.length < 2) {
      const empty: SearchResults = { titles: [], episodes: [], videos: [], people: [], collections: [] };
      return c.json(empty);
    }

    const pattern = likePattern(query);
    // Sort titles match "the matrix" from "matrix"; plain titles cover punctuation and originals
    const nameMatch = {
      [Op.or]: [
        { title: { [Op.like]: pattern } },
        { originalTitle: { [Op.like]: pattern } },
        { sortTitle: { [Op.like]: likePattern(MediaItem.sortTitleFor(query)) } },
      ],
    };
    const visible = Visibility.where(user);

    const titles = await MediaItem.findAll({ where: { [Op.and]: [visible, nameMatch, { type: ["movie", "show"] }] }, limit: 40 });
    // Exact and prefix matches first, then the rest by title
    const lower = query.toLowerCase();
    const rank = (item: MediaItem) => item.title.toLowerCase() === lower ? 0 : item.title.toLowerCase().startsWith(lower) ? 1 : 2;
    titles.sort((a, b) => rank(a) - rank(b) || a.sortTitle.localeCompare(b.sortTitle));

    const episodes = await MediaItem.findAll({ where: { [Op.and]: [visible, { title: { [Op.like]: pattern } }, { type: "episode" }] }, limit: 12, order: [["sortTitle", "ASC"]] });
    // Folders before videos, then by title
    const videos = await MediaItem.findAll({ where: { [Op.and]: [visible, nameMatch, { type: ["folder", "video"] }] }, limit: 24, order: [["type", "ASC"], ["sortTitle", "ASC"]] });

    // People only count when they're in something this profile can see
    const people = await Person.findAll({ where: { name: { [Op.like]: pattern } }, limit: 40, order: [["name", "ASC"]] });
    const credits = people.length ? await Credit.findAll({ where: { personId: people.map((p) => p.id) }, attributes: ["personId", "itemId"] }) : [];
    const visibleItems = credits.length
      ? new Set((await MediaItem.findAll({ where: { [Op.and]: [visible, { id: [...new Set(credits.map((cr) => cr.itemId))] }] }, attributes: ["id"] })).map((i) => i.id))
      : new Set<number>();
    const peopleWithTitles = people
      .filter((person) => credits.some((cr) => cr.personId === person.id && visibleItems.has(cr.itemId)))
      .slice(0, 12)
      .map((person) => ({ id: person.id, name: person.name, photo: person.photo }));

    const collections = await CollectionsController.visibleCollections(user, {
      name: { [Op.like]: pattern },
      ...(user.libraryAccess !== null ? { libraryId: user.libraryAccess } : {}),
    });

    const results: SearchResults = {
      titles: await Summaries.build(titles.slice(0, 24), user),
      episodes: await Summaries.build(episodes, user),
      videos: await Summaries.build(videos, user),
      people: peopleWithTitles,
      collections: collections.slice(0, 12),
    };
    return c.json(results);
  });
}

export default SearchController;
