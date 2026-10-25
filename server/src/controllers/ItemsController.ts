import { Hono } from "hono";
import { Op } from "sequelize";
import { type EditDetailsRequest, type ItemDetail, isPlayable } from "@shared/media.ts";
import { Collection, Credit, Library, MediaFile, MediaItem, Person, User, WatchState } from "../models/index.ts";
import MetadataManager from "../metadata/MetadataManager.ts";
import Visibility from "../library/Visibility.ts";
import Summaries from "../library/Summaries.ts";
import ItemLabels from "../library/ItemLabels.ts";
import Watchlist from "../library/Watchlist.ts";
import MissingEpisodes from "../library/MissingEpisodes.ts";
import VideoDetails from "../library/VideoDetails.ts";
import ClipLibrary from "../clips/ClipLibrary.ts";
import FolderTree from "../library/FolderTree.ts";
import ContentRatings from "../library/ContentRatings.ts";
import Events from "../integrations/Events.ts";
import Trakt from "../integrations/Trakt.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace ItemsController {
  export const router = new Hono<AppEnv>();

  const KIND_ORDER = ["director", "writer", "cast", "composer", "producer"];
  const SIMILAR_COUNT = 16;

  /**
   * The item with `id`, when the signed-in profile may see it.
   */
  async function findVisible(user: User, id: number) {
    const item = await MediaItem.findByPk(id);
    return item && Visibility.canSee(user, item) ? item : null;
  }

  /**
   * Movies, episodes and videos under an item: itself for those, every episode for shows and seasons, every video
   * for folders, every clip for games.
   */
  export async function playableIds(item: MediaItem): Promise<number[]> {
    if (isPlayable(item.type)) return [item.id];
    if (item.type === "folder") return (await FolderTree.load([item.libraryId])).videosUnder(item.id).map((v) => v.id);
    if (item.type === "game") return (await MediaItem.findAll({ where: { parentId: item.id, type: "video" }, attributes: ["id"] })).map((c) => c.id);
    const seasons = item.type === "show" ? (await MediaItem.findAll({ where: { parentId: item.id }, attributes: ["id"] })).map((s) => s.id) : [item.id];
    return (await MediaItem.findAll({ where: { parentId: seasons, type: "episode" }, attributes: ["id"] })).map((e) => e.id);
  }

  /**
   * Titles in the same library that share the most genres with `item`.
   */
  export async function similar(item: MediaItem, user: User) {
    if (item.type === "video") return await Summaries.build(await siblings(item, user, SIMILAR_COUNT + 1).then((s) => s.filter((v) => v.id !== item.id).slice(0, SIMILAR_COUNT)), user);
    if (item.type !== "movie" && item.type !== "show") return [];
    if (item.genres.length === 0) return [];
    const candidates = await MediaItem.findAll({
      where: {
        [Op.and]: [
          Visibility.where(user),
          { libraryId: item.libraryId, type: item.type, id: { [Op.ne]: item.id } },
          { [Op.or]: item.genres.map((g) => MediaItem.genreCondition(g)) },
        ],
      },
      limit: 200,
    });
    const shared = (other: MediaItem) => other.genres.filter((g) => item.genres.includes(g)).length;
    candidates.sort((a, b) => shared(b) - shared(a) || (b.rating ?? 0) - (a.rating ?? 0));
    return await Summaries.build(candidates.slice(0, SIMILAR_COUNT), user);
  }

  /**
   * Videos in the same folder as `video` (itself included), in folder order. For clips, the clips of the same game,
   * newest first.
   */
  async function siblings(video: MediaItem, user: User, limit?: number) {
    return await MediaItem.findAll({
      where: { [Op.and]: [Visibility.where(user), { libraryId: video.libraryId, parentId: video.parentId, type: "video" }] },
      order: video.clip ? [["takenAt", "DESC"], ["id", "DESC"]] : [["sortTitle", "ASC"], ["id", "ASC"]],
      limit,
    });
  }

  /**
   * @swagger
   * /api/items/{id}:
   *   get:
   *     summary: Everything about a movie, show, season, episode, video or folder, with its children, cast, files and similar titles.
   */
  /**
   * @swagger
   * /api/items/{id}/missing:
   *   get:
   *     summary: For a show, the aired episodes TMDB or TheTVDB list that aren't in the library, per season.
   */
  router.get("/:id/missing", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const show = await findVisible(user, Number(c.req.param("id")));
    if (!show || show.type !== "show") return c.json({ message: "Only shows have missing episodes." }, 404);
    return c.json({ seasons: await MissingEpisodes.forShow(show, { force: c.req.query("refresh") === "1" }), source: show.episodeGuide?.source ?? null, checkedAt: show.episodeGuide?.fetchedAt ?? null });
  });

  router.get("/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const item = await findVisible(user, Number(c.req.param("id")));
    if (!item) return c.json({ message: "That title doesn't exist." }, 404);

    // A game's clips can be thousands; its page loads them a page at a time from /api/clips
    const children = item.type === "game" ? [] : await MediaItem.findAll({
      where: item.type === "folder" ? { [Op.and]: [Visibility.where(user), { parentId: item.id }] } : { parentId: item.id },
      // Folders hold subfolders ("folder" sorts before "video") and then videos, by title
      order: item.type === "show" ? [["seasonNumber", "ASC"]] : item.type === "folder" ? [["type", "ASC"], ["sortTitle", "ASC"]] : [["episodeNumber", "ASC"]],
    });
    // Specials (season 0) go after the regular seasons
    if (item.type === "show") children.sort((a, b) => (a.seasonNumber === 0 ? 1 : 0) - (b.seasonNumber === 0 ? 1 : 0));

    const credits = await Credit.findAll({ where: { itemId: item.id }, include: [{ model: Person, as: "person" }], order: [["order", "ASC"]] });
    credits.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const files = await MediaFile.findAll({ where: { itemId: item.id }, order: [["path", "ASC"]] });
    const collection = item.collectionId ? await Collection.findByPk(item.collectionId) : null;
    const collectionSize = collection ? await MediaItem.count({ where: { collectionId: collection.id } }) : 0;

    const detail: ItemDetail = {
      ...await Summaries.one(item, user),
      originalTitle: item.originalTitle,
      overview: item.overview,
      tagline: item.tagline,
      runtime: item.runtime ?? (files[0]?.duration ? Math.round(files[0].duration / 60) : null),
      releaseDate: item.releaseDate,
      rating: item.rating,
      genres: item.genres,
      studios: item.studios,
      externalIds: item.externalIds,
      ratings: item.ratings,
      parentId: item.parentId,
      credits: credits.map((cr) => cr.toInfo()),
      files: files.map((f) => f.toInfo()),
      children: await Summaries.build(children, user),
      collection: collection && collectionSize > 1 ? collection.toSummary(collectionSize) : null,
      similar: await similar(item, user),
      folders: await VideoDetails.ancestors(item),
      edited: { details: !!item.editedAt, thumbnail: item.customArtwork },
      onList: await Watchlist.contains(user.id, item.id),
    };
    return c.json(detail);
  });

  /**
   * The episode that follows `episode`, crossing into the next season. Specials only lead to other specials.
   */
  async function episodeAfter(episode: MediaItem, user: User) {
    const season = episode.parentId ? await MediaItem.findByPk(episode.parentId) : null;
    if (!season?.parentId) return null;
    const seasons = await MediaItem.findAll({ where: { parentId: season.parentId, type: "season" }, attributes: ["id", "seasonNumber"] });
    const isSpecial = season.seasonNumber === 0;
    const seasonIds = seasons.filter((s) => (s.seasonNumber === 0) === isSpecial).map((s) => s.id);
    const episodes = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { parentId: seasonIds, type: "episode" }] }, order: [["seasonNumber", "ASC"], ["episodeNumber", "ASC"]] });
    const index = episodes.findIndex((e) => e.id === episode.id);
    const next = index >= 0 ? episodes[index + 1] : null;
    return next ? await Summaries.one(next, user) : null;
  }

  /**
   * What "Play" starts on a show, season or folder: something in progress first, then the next one after the
   * furthest watched, then the first one.
   */
  async function startingPoint(list: MediaItem[], user: User) {
    const states = await WatchState.findAll({ where: { userId: user.id, itemId: list.map((e) => e.id) } });
    const inProgress = states.filter((s) => !s.watched && s.position > 0).sort((a, b) => (b.lastWatchedAt?.getTime() ?? 0) - (a.lastWatchedAt?.getTime() ?? 0))[0];
    const watched = new Set(states.filter((s) => s.watched).map((s) => s.itemId));
    let furthest = -1;
    list.forEach((e, i) => {
      if (watched.has(e.id)) furthest = i;
    });
    return inProgress
      ? list.find((e) => e.id === inProgress.itemId)!
      : list.slice(furthest + 1).find((e) => !watched.has(e.id)) ?? list[0];
  }

  /**
   * @swagger
   * /api/items/{id}/next:
   *   get:
   *     summary: For an episode, the one after it; for a video, the next one in its folder (or game). For a show, season, folder or game, what "Play" starts:
   *       something in progress first, then the next one after the furthest watched, then the first one. `null` when there's nothing.
   */
  router.get("/:id/next", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const item = await findVisible(user, Number(c.req.param("id")));
    if (item?.type === "episode") return c.json(await episodeAfter(item, user));
    if (item?.type === "video") {
      const list = await siblings(item, user);
      const next = list[list.findIndex((v) => v.id === item.id) + 1];
      return c.json(next ? await Summaries.one(next, user) : null);
    }
    if (!item || (item.type !== "show" && item.type !== "season" && item.type !== "folder" && item.type !== "game")) return c.json({ message: "Only shows, seasons, episodes, videos, folders and games have a next one." }, 404);

    let list: MediaItem[];
    if (item.type === "game") {
      list = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { parentId: item.id, type: "video" }] }, order: [["takenAt", "DESC"], ["id", "DESC"]] });
    }
    else if (item.type === "folder") {
      const ids = (await FolderTree.load([item.libraryId])).videosUnder(item.id).map((v) => v.id);
      const videos = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { id: ids }] } });
      const byId = new Map(videos.map((v) => [v.id, v]));
      list = ids.map((id) => byId.get(id)).filter((v): v is MediaItem => !!v);
    }
    else {
      const seasonIds = item.type === "show"
        ? (await MediaItem.findAll({ where: { parentId: item.id, type: "season" }, attributes: ["id", "seasonNumber"] })).filter((s) => s.seasonNumber !== 0).map((s) => s.id)
        : [item.id];
      list = await MediaItem.findAll({ where: { parentId: seasonIds, type: "episode" }, order: [["seasonNumber", "ASC"], ["episodeNumber", "ASC"]] });
    }
    if (list.length === 0) return c.json(null);
    return c.json(await Summaries.one(await startingPoint(list, user), user));
  });

  /**
   * @swagger
   * /api/items/{id}/watched:
   *   put:
   *     summary: Mark as watched or not. Shows and seasons mark all their episodes. Body `{ "watched": true }`.
   */
  router.put("/:id/watched", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const item = await findVisible(user, Number(c.req.param("id")));
    if (!item) return c.json({ message: "That title doesn't exist." }, 404);
    const body = await readJson<{ watched: boolean }>(c);
    if (typeof body?.watched !== "boolean") return c.json({ message: "Say whether it's watched: { \"watched\": true }." }, 400);

    const ids = await playableIds(item);
    await WatchState.markWatched(user.id, ids, body.watched);
    Trakt.syncHistory(user, ids, body.watched);
    return c.json(await Summaries.one(item, user));
  });

  /**
   * @swagger
   * /api/items/{id}/progress:
   *   put:
   *     summary: Remember where playback is, in seconds. Body `{ "position": 123, "duration": 5400 }`.
   */
  router.put("/:id/progress", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const item = await findVisible(user, Number(c.req.param("id")));
    if (!item || !isPlayable(item.type)) return c.json({ message: "Only movies, episodes and videos have progress." }, 404);
    const body = await readJson<{ position: number; duration: number | null }>(c);
    if (typeof body?.position !== "number" || body.position < 0) return c.json({ message: "A position in seconds is required." }, 400);

    const { finished } = await WatchState.saveProgress(user.id, item.id, body.position, typeof body.duration === "number" ? body.duration : null);
    if (finished) {
      const label = await ItemLabels.describe(item);
      Events.emit("item.watched", { user: { id: user.id, name: user.name }, item: await ItemLabels.forWebhook(item, label.show) }, {
        kind: "watched",
        message: `${user.name} finished ${label.inline}`,
        userId: user.id,
        itemId: item.id,
      });
    }
    return c.json(await Summaries.one(item, user));
  });

  /**
   * @swagger
   * /api/items/{id}/refresh:
   *   post:
   *     summary: Fetch details again. For seasons and episodes the whole show is refreshed.
   */
  router.post("/:id/refresh", User.$middleware({ permissions: ["LIBRARY_MANAGE"] }), async (c) => {
    const user = c.get("user")!;
    const item = await findVisible(user, Number(c.req.param("id")));
    if (!item) return c.json({ message: "That title doesn't exist." }, 404);
    try {
      await MetadataManager.refresh(item);
      await item.reload();
      return c.json(await Summaries.one(item, user));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/items/{id}/match:
   *   get:
   *     summary: Search for the right title, for "Fix match". Query `query` (defaults to the current title) and `year`.
   */
  router.get("/:id/match", User.$middleware({ permissions: ["LIBRARY_MANAGE"] }), async (c) => {
    const item = await findVisible(c.get("user")!, Number(c.req.param("id")));
    if (!item || (item.type !== "movie" && item.type !== "show")) return c.json({ message: "Only movies and shows can be matched." }, 404);
    const query = c.req.query("query")?.trim() || item.title;
    const year = c.req.query("year") ? parseInt(c.req.query("year")!) || null : null;
    try {
      return c.json(await MetadataManager.search(item.type, query, year));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/items/{id}/match:
   *   post:
   *     summary: Use the chosen search result for this movie or show, and fetch its details.
   */
  router.post("/:id/match", User.$middleware({ permissions: ["LIBRARY_MANAGE"] }), async (c) => {
    const user = c.get("user")!;
    const item = await findVisible(user, Number(c.req.param("id")));
    if (!item || (item.type !== "movie" && item.type !== "show")) return c.json({ message: "Only movies and shows can be matched." }, 404);
    const body = await readJson<{ provider: string; id: string }>(c);
    if (!body?.provider || !body.id) return c.json({ message: "Pick a search result to match with." }, 400);
    try {
      await MetadataManager.setMatch(item, body.provider, String(body.id));
      await item.reload();
      return c.json(await Summaries.one(item, user));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  //#region Editing videos, photos and folders
  const manage = User.$middleware({ permissions: ["LIBRARY_MANAGE"] });
  const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

  /**
   * A video, photo or folder the profile may see. Other types get their details from files and providers.
   */
  async function findEditable(user: User, id: number) {
    const item = await findVisible(user, id);
    return item && (item.type === "video" || item.type === "photo" || item.type === "folder") ? item : null;
  }

  /**
   * Check what "Edit details" sent.
   * @throws With a message that says which field is wrong.
   */
  function verifyDetails(body: Partial<EditDetailsRequest>): EditDetailsRequest {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 200) throw new Error("The title must be between 1 and 200 characters long.");

    let releaseDate: string | null = null;
    if (body.releaseDate) {
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(body.releaseDate) && !isNaN(new Date(`${body.releaseDate}T00:00:00`).getTime());
      if (!valid) throw new Error("The date must look like 2024-07-12.");
      releaseDate = body.releaseDate;
    }

    const overview = typeof body.overview === "string" ? body.overview.trim().slice(0, 5000) || null : null;
    const tags = [...new Set((Array.isArray(body.tags) ? body.tags : []).filter((t) => typeof t === "string").map((t) => t.trim()).filter(Boolean))];
    if (tags.length > 20) throw new Error("Use at most 20 tags.");
    if (tags.some((t) => t.length > 40)) throw new Error("Keep each tag under 40 characters.");

    const contentRating = typeof body.contentRating === "string" && body.contentRating.trim() ? body.contentRating.trim() : null;
    if (contentRating && ContentRatings.ageFor(contentRating) === null) throw new Error(`"${contentRating}" isn't a rating Cinemion knows. Use one like "G", "PG", "12" or "16".`);
    return { title, releaseDate, overview, tags, contentRating };
  }

  /**
   * @swagger
   * /api/items/{id}/details:
   *   put:
   *     summary: Set a video's, photo's or folder's details by hand. Body is an `EditDetailsRequest`. Refreshing keeps them.
   */
  router.put("/:id/details", manage, async (c) => {
    const user = c.get("user")!;
    const item = await findEditable(user, Number(c.req.param("id")));
    if (!item) return c.json({ message: "Only videos, photos and folders can be edited." }, 404);
    let details: EditDetailsRequest;
    try {
      details = verifyDetails(await readJson<EditDetailsRequest>(c) ?? {});
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }

    const library = await Library.findByPk(item.libraryId);
    item.setTitle(details.title);
    item.overview = details.overview;
    if (item.type === "video" || item.type === "photo") {
      // Photos keep the time they were taken on the new day, so they stay in order within it
      if (item.takenAt !== null || item.type === "photo") {
        item.takenAt = details.releaseDate ? `${details.releaseDate}T${item.takenAt?.slice(11) ?? "00:00:00"}` : item.takenAt;
      }
      item.releaseDate = details.releaseDate;
      item.year = details.releaseDate ? parseInt(details.releaseDate.slice(0, 4)) : null;
      item.genres = details.tags;
      item.contentRating = details.contentRating;
      item.ageRating = ContentRatings.ageFor(details.contentRating) ?? library?.defaultAge() ?? null;
    }
    item.editedAt = new Date();
    await item.save();
    // A folder's date and rating come from what's inside it, and so does a game's rating
    if (item.type !== "folder" && library) await VideoDetails.refreshFolders(library);
    if (library?.type === "clips") await ClipLibrary.summarizeGames(library);
    return c.json(await Summaries.one(item, user));
  });

  /**
   * @swagger
   * /api/items/{id}/frame:
   *   get:
   *     summary: One frame of a video as a JPEG, for picking a thumbnail. Query `t` in seconds.
   */
  router.get("/:id/frame", manage, async (c) => {
    const item = await findEditable(c.get("user")!, Number(c.req.param("id")));
    const file = item?.type === "video" ? await MediaFile.findOne({ where: { itemId: item.id }, order: [["path", "ASC"]] }) : null;
    if (!file) return c.json({ message: "That video doesn't exist." }, 404);
    const frame = await VideoDetails.frame(file, Math.max(0, Number(c.req.query("t")) || 0));
    if (!frame) return c.json({ message: "That moment of the video couldn't be read." }, 500);
    return c.body(new Uint8Array(frame), 200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" });
  });

  /**
   * @swagger
   * /api/items/{id}/thumbnail:
   *   put:
   *     summary: Set the thumbnail by hand. For videos, JSON `{ "time": 12.5 }` takes that frame; for videos and folders, a multipart
   *       "file" field uploads a picture.
   */
  router.put("/:id/thumbnail", manage, async (c) => {
    const user = c.get("user")!;
    const item = await findEditable(user, Number(c.req.param("id")));
    if (!item || item.type === "photo") return c.json({ message: "Only videos and folders can get a thumbnail by hand." }, 404);

    let key: string | null;
    try {
      if ((c.req.header("Content-Type") ?? "").includes("multipart/form-data")) {
        if (Number(c.req.header("Content-Length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) return c.json({ message: "The picture is too large. The limit is 15 MB." }, 413);
        const upload = (await c.req.parseBody().catch(() => null))?.["file"];
        if (!(upload instanceof File)) return c.json({ message: "Send the picture as a \"file\" field in a multipart form." }, 400);
        key = await VideoDetails.storeUpload(new Uint8Array(await upload.arrayBuffer()));
      }
      else {
        const body = await readJson<{ time: number }>(c);
        const file = item.type === "video" ? await MediaFile.findOne({ where: { itemId: item.id }, order: [["path", "ASC"]] }) : null;
        if (!file || typeof body?.time !== "number") return c.json({ message: "Send a picture, or for a video the moment to use: { \"time\": 12.5 }." }, 400);
        key = await VideoDetails.makeThumbnail(file, Math.max(0, body.time));
        if (!key) return c.json({ message: "That moment of the video couldn't be read." }, 500);
      }
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }

    await VideoDetails.setThumbnail(item, key);
    item.customArtwork = true;
    await item.save();
    const library = await Library.findByPk(item.libraryId);
    // Folders without a picture of their own show their newest video's
    if (item.type === "video" && library) await VideoDetails.refreshFolders(library);
    return c.json(await Summaries.one(item, user));
  });

  /**
   * @swagger
   * /api/items/{id}/thumbnail:
   *   delete:
   *     summary: Go back to the automatic thumbnail.
   */
  router.delete("/:id/thumbnail", manage, async (c) => {
    const user = c.get("user")!;
    const item = await findEditable(user, Number(c.req.param("id")));
    if (!item || item.type === "photo") return c.json({ message: "Only videos and folders have a thumbnail set by hand." }, 404);
    const library = await Library.findByPk(item.libraryId);
    item.customArtwork = false;
    if (item.type === "video") await VideoDetails.refreshVideo(item, { regenerate: true, library });
    else await item.save();
    if (library) await VideoDetails.refreshFolders(library);
    await item.reload();
    return c.json(await Summaries.one(item, user));
  });
  //#endregion
}

export default ItemsController;
