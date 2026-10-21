import { Hono } from "hono";
import { Op } from "sequelize";
import type { HomeData } from "@shared/media.ts";
import { Library, MediaItem, User, WatchState } from "../models/index.ts";
import ItemsController from "./ItemsController.ts";
import Visibility from "../library/Visibility.ts";
import Summaries from "../library/Summaries.ts";
import MusicSummaries from "../music/MusicSummaries.ts";
import BooksController from "./BooksController.ts";
import PhotoSummaries from "../photos/PhotoSummaries.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace HomeController {
  export const router = new Hono<AppEnv>();

  const ROW_SIZE = 16;

  /**
   * Movies and episodes the profile started but didn't finish.
   */
  async function continueWatching(user: User) {
    const states = await WatchState.findAll({
      where: { userId: user.id, watched: false, position: { [Op.gt]: 0 } },
      order: [["lastWatchedAt", "DESC"]],
      limit: 40,
    });
    // Books and audiobooks have their own row
    const items = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { id: states.map((s) => s.itemId), type: ["movie", "episode", "video"] }] } });
    const byId = new Map(items.map((i) => [i.id, i]));
    return states.map((s) => byId.get(s.itemId)).filter((i): i is MediaItem => !!i).slice(0, ROW_SIZE);
  }

  /**
   * Every episode of a show in watching order, specials left out.
   */
  async function episodesOf(showId: number) {
    const seasons = await MediaItem.findAll({ where: { parentId: showId, type: "season", seasonNumber: { [Op.gt]: 0 } }, attributes: ["id"] });
    return await MediaItem.findAll({
      where: { parentId: seasons.map((s) => s.id), type: "episode" },
      order: [["seasonNumber", "ASC"], ["episodeNumber", "ASC"]],
    });
  }

  /**
   * The next unwatched episode of each show the profile watched recently.
   * @param skip Episodes already in "Continue watching".
   */
  async function nextUp(user: User, skip: Set<number>) {
    const recent = await WatchState.findAll({ where: { userId: user.id, watched: true }, order: [["lastWatchedAt", "DESC"]], limit: 200, attributes: ["itemId"] });
    const episodes = await MediaItem.findAll({ where: { id: recent.map((r) => r.itemId), type: "episode" }, attributes: ["id", "parentId"] });
    const seasonOf = new Map(episodes.map((e) => [e.id, e.parentId!]));
    const seasons = await MediaItem.findAll({ where: { id: [...new Set(seasonOf.values())] }, attributes: ["id", "parentId"] });
    const showOf = new Map(seasons.map((s) => [s.id, s.parentId!]));

    // Shows in the order they were last watched
    const showIds: number[] = [];
    for (const r of recent) {
      const season = seasonOf.get(r.itemId);
      const show = season ? showOf.get(season) : undefined;
      if (show && !showIds.includes(show)) showIds.push(show);
    }

    const result: MediaItem[] = [];
    for (const showId of showIds.slice(0, 30)) {
      const show = await MediaItem.findByPk(showId);
      if (!show || !Visibility.canSee(user, show)) continue;
      const all = await episodesOf(showId);
      const watched = new Set((await WatchState.findAll({ where: { userId: user.id, itemId: all.map((e) => e.id), watched: true }, attributes: ["itemId"] })).map((s) => s.itemId));
      // After the furthest episode watched, so rewatching an old one doesn't send you back
      let lastWatched = -1;
      all.forEach((e, i) => {
        if (watched.has(e.id)) lastWatched = i;
      });
      const next = all.slice(lastWatched + 1).find((e) => !watched.has(e.id));
      if (next && !skip.has(next.id)) result.push(next);
      if (result.length >= ROW_SIZE) break;
    }
    return result;
  }

  /**
   * Newest movies or videos, or shows ordered by their newest episode, per library.
   */
  async function recentlyAdded(user: User) {
    const rows: HomeData["recentlyAdded"] = [];
    for (const library of await Library.findAll({ order: [["id", "ASC"]] })) {
      if (!Visibility.canSeeLibrary(user, library.id) || !["movies", "shows", "videos"].includes(library.type)) continue;
      let items: MediaItem[];
      if (library.type === "movies" || library.type === "videos") {
        const type = library.type === "movies" ? "movie" : "video";
        items = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { libraryId: library.id, type }] }, order: [["addedAt", "DESC"]], limit: ROW_SIZE });
      }
      else {
        const episodes = await MediaItem.findAll({ where: { libraryId: library.id, type: "episode" }, order: [["addedAt", "DESC"]], limit: 300, attributes: ["parentId"] });
        const seasons = await MediaItem.findAll({ where: { id: [...new Set(episodes.map((e) => e.parentId!))] }, attributes: ["id", "parentId"] });
        const showOf = new Map(seasons.map((s) => [s.id, s.parentId!]));
        const order = [...new Set(episodes.map((e) => showOf.get(e.parentId!)).filter((id): id is number => !!id))];
        const shows = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { id: order.slice(0, 60) }] } });
        const byId = new Map(shows.map((s) => [s.id, s]));
        items = order.map((id) => byId.get(id)).filter((s): s is MediaItem => !!s).slice(0, ROW_SIZE);
      }
      if (items.length) rows.push({ libraryId: library.id, libraryName: library.name, libraryType: library.type, items: await Summaries.build(items, user) });
    }
    return rows;
  }

  /**
   * Newest albums per Music library.
   */
  async function recentlyAddedMusic(user: User) {
    const rows: HomeData["recentlyAddedMusic"] = [];
    for (const library of await Library.findAll({ where: { type: "music" }, order: [["id", "ASC"]] })) {
      if (!Visibility.canSeeLibrary(user, library.id)) continue;
      const albums = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { libraryId: library.id, type: "album" }] }, order: [["addedAt", "DESC"]], limit: ROW_SIZE });
      if (albums.length) rows.push({ libraryId: library.id, libraryName: library.name, albums: await MusicSummaries.albums(albums) });
    }
    return rows;
  }

  /**
   * Newest folders per Photos library, leaving out ones with nothing this profile may see.
   */
  async function recentlyAddedPhotos(user: User) {
    const rows: HomeData["recentlyAddedPhotos"] = [];
    for (const library of await Library.findAll({ where: { type: "photos" }, order: [["id", "ASC"]] })) {
      if (!Visibility.canSeeLibrary(user, library.id)) continue;
      const folders = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { libraryId: library.id, type: "folder" }] }, order: [["addedAt", "DESC"]], limit: ROW_SIZE * 2 });
      const albums = (await PhotoSummaries.folders(folders, user)).filter((a) => a.photoCount + a.videoCount > 0).slice(0, ROW_SIZE);
      if (albums.length) rows.push({ libraryId: library.id, libraryName: library.name, albums });
    }
    return rows;
  }

  /**
   * Titles like the one the profile watched last. Music doesn't count.
   */
  async function becauseYouWatched(user: User): Promise<HomeData["becauseYouWatched"]> {
    const recent = await WatchState.findAll({ where: { userId: user.id }, order: [["lastWatchedAt", "DESC"]], limit: 30, attributes: ["itemId"] });
    const watchable = recent.length ? await MediaItem.findAll({ where: { id: recent.map((s) => s.itemId), type: ["movie", "episode", "video"] }, attributes: ["id"] }) : [];
    const last = recent.find((s) => watchable.some((i) => i.id === s.itemId));
    let item = last ? await MediaItem.findByPk(last.itemId) : null;
    // For an episode, recommend from its show
    while (item && (item.type === "episode" || item.type === "season")) item = item.parentId ? await MediaItem.findByPk(item.parentId) : null;
    if (!item || !Visibility.canSee(user, item)) return null;
    const items = await ItemsController.similar(item, user);
    return items.length >= 3 ? { title: item.title, items } : null;
  }

  /**
   * @swagger
   * /api/home:
   *   get:
   *     summary: The rows of the home screen for the signed-in profile.
   */
  router.get("/", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const resume = await continueWatching(user);
    const next = await nextUp(user, new Set(resume.map((i) => i.id)));
    const data: HomeData = {
      continueWatching: await Summaries.build(resume, user),
      nextUp: await Summaries.build(next, user),
      recentlyAdded: await recentlyAdded(user),
      recentlyAddedMusic: await recentlyAddedMusic(user),
      recentlyAddedPhotos: await recentlyAddedPhotos(user),
      continueBooks: await BooksController.continueBooks(user),
      becauseYouWatched: await becauseYouWatched(user),
    };
    return c.json(data);
  });
}

export default HomeController;
