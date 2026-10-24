import { Hono } from "hono";
import { col, literal, Op, type Order, type WhereOptions, where } from "sequelize";
import type { ClipSort, ClipsOverview, ClipsSettings, GameCandidate, GameSort, GameSummary, SetGameRequest, ShareCopyRequest, TrimRequest } from "@shared/clips.ts";
import type { ItemPage } from "@shared/media.ts";
import { Library, MediaFile, MediaItem, User, WatchState } from "../models/index.ts";
import Visibility from "../library/Visibility.ts";
import Summaries from "../library/Summaries.ts";
import ClipLibrary from "../clips/ClipLibrary.ts";
import ClipNames from "../clips/ClipNames.ts";
import ClipSettings from "../clips/ClipSettings.ts";
import ClipTools from "../clips/ClipTools.ts";
import GameInfo from "../clips/GameInfo.ts";
import Recognition from "../clips/Recognition.ts";
import { errorMessage, readJson, sendFile } from "../lib/http.ts";
import log from "../lib/Logger.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Clips libraries: games with their clips, setting games by hand, picture recognition's suggestions, favourites,
 * cutting clips and making small copies to share.
 */
export namespace ClipsController {
  export const router = new Hono<AppEnv>();

  const PAGE_LIMIT = 200;
  const RECENT_COUNT = 12;
  const MAX_SET = 5000;
  const manage = User.$middleware({ permissions: ["LIBRARY_MANAGE"] });
  const serverManage = User.$middleware({ permissions: ["SERVER_MANAGE"] });

  async function clipsLibrary(user: User, id: number) {
    const library = await Library.findByPk(id);
    return library?.type === "clips" && Visibility.canSeeLibrary(user, library.id) ? library : null;
  }

  /**
   * A clip in a Clips library that `user` may see.
   */
  async function visibleClip(user: User, id: number) {
    const clip = await MediaItem.findByPk(id);
    if (!clip || clip.type !== "video" || !clip.clip || !Visibility.canSee(user, clip)) return null;
    return clip;
  }

  async function visibleGame(user: User, id: number) {
    const game = await MediaItem.findByPk(id);
    return game?.type === "game" && Visibility.canSee(user, game) ? game : null;
  }

  async function firstFile(clip: MediaItem) {
    return await MediaFile.findOne({ where: { itemId: clip.id }, order: [["path", "ASC"]] });
  }

  /**
   * Run recognition again after games changed by hand, since the clips with games are what the others are compared
   * with.
   */
  async function recognizeAgain(library: Library) {
    if ((await Recognition.status()).state === "ready") Recognition.queue(library.id).catch(() => { });
  }

  //#region Browsing

  /**
   * @swagger
   * /api/clips/libraries/{id}:
   *   get:
   *     summary: A Clips library's games with their clips counted, and its newest clips. Query `sort` (recent, title, clips).
   */
  router.get("/libraries/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await clipsLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const sort = (["recent", "title", "clips"].includes(c.req.query("sort") ?? "") ? c.req.query("sort") : "recent") as GameSort;

    const visible = { [Op.and]: [Visibility.where(user), { libraryId: library.id, type: "video" }] };
    const clips = await MediaItem.findAll({ where: visible, attributes: ["id", "parentId", "takenAt", "clip"] });
    const seconds = new Map((await MediaFile.findAll({ where: { libraryId: library.id }, attributes: ["itemId", "duration"] })).map((f) => [f.itemId, f.duration ?? 0]));
    const stats = new Map<number, { count: number; newest: string | null; seconds: number }>();
    for (const clip of clips) {
      if (clip.parentId === null) continue;
      const entry = stats.get(clip.parentId) ?? { count: 0, newest: null, seconds: 0 };
      entry.count++;
      if (clip.takenAt && (!entry.newest || clip.takenAt > entry.newest)) entry.newest = clip.takenAt;
      entry.seconds += seconds.get(clip.id) ?? 0;
      stats.set(clip.parentId, entry);
    }

    const games = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { libraryId: library.id, type: "game", id: [...stats.keys()] }] } });
    const summaries: GameSummary[] = (await Summaries.build(games, user)).map((g) => {
      const entry = stats.get(g.id)!;
      return { ...g, childCount: entry.count, clipCount: entry.count, newestClipAt: entry.newest, totalSeconds: Math.round(entry.seconds) };
    });
    if (sort === "title") summaries.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    else if (sort === "clips") summaries.sort((a, b) => b.clipCount - a.clipCount || a.title.localeCompare(b.title));
    else summaries.sort((a, b) => (b.newestClipAt ?? "").localeCompare(a.newestClipAt ?? "") || a.title.localeCompare(b.title));

    const recent = await MediaItem.findAll({ where: visible, order: [["takenAt", "DESC"], ["id", "DESC"]], limit: RECENT_COUNT });
    const noGame = clips.filter((clip) => clip.parentId === null);
    const overview: ClipsOverview = {
      clipCount: clips.length,
      gameCount: summaries.length,
      noGameCount: noGame.length,
      suggestedCount: noGame.filter((clip) => clip.clip?.suggestion).length,
      games: summaries,
      recent: await Summaries.build(recent, user),
    };
    return c.json(overview);
  });

  /**
   * @swagger
   * /api/clips/libraries/{id}/clips:
   *   get:
   *     summary: Clips of a library, paged. Query `game` (a game id, or `none`), `tag`, `favorites` (1), `suggested` (1, clips without a game that have a
   *       suggestion), `sort` (newest, oldest, longest), `offset`, `limit`.
   */
  router.get("/libraries/:id/clips", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await clipsLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const sort = (["newest", "oldest", "longest"].includes(c.req.query("sort") ?? "") ? c.req.query("sort") : "newest") as ClipSort;
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "60") || 60, 1), PAGE_LIMIT);
    const offset = Math.max(parseInt(c.req.query("offset") ?? "0") || 0, 0);

    const conditions: WhereOptions<MediaItem>[] = [Visibility.where(user), { libraryId: library.id, type: "video" }];
    const game = c.req.query("game");
    if (game === "none") conditions.push({ parentId: null });
    else if (game) conditions.push({ parentId: Number(game) || -1 });
    const tag = c.req.query("tag");
    if (tag) conditions.push(MediaItem.genreCondition(tag));
    if (c.req.query("favorites") === "1") conditions.push({ id: { [Op.in]: literal(`(SELECT itemId FROM watch_states WHERE userId = ${Number(user.id)} AND favorite = 1)`) } });
    // Suggestions are stored in the clip's JSON; one without has `"suggestion":null`
    if (c.req.query("suggested") === "1") conditions.push({ parentId: null }, where(col("clip"), { [Op.notLike]: "%\"suggestion\":null%" }));

    const order: Order = sort === "oldest" ? [["takenAt", "ASC"], ["id", "ASC"]] : sort === "longest" ? [["runtime", "DESC"], ["takenAt", "DESC"]] : [["takenAt", "DESC"], ["id", "DESC"]];
    const { rows, count } = await MediaItem.findAndCountAll({ where: { [Op.and]: conditions }, order, limit, offset });
    const page: ItemPage = { items: await Summaries.build(rows, user), total: count };
    return c.json(page);
  });

  /**
   * @swagger
   * /api/clips/libraries/{id}/tags:
   *   get:
   *     summary: Every tag on the library's clips, for the filter menu. Query `game` like for the clips list.
   */
  router.get("/libraries/:id/tags", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await clipsLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const game = c.req.query("game");
    const clips = await MediaItem.findAll({
      where: { [Op.and]: [Visibility.where(user), { libraryId: library.id, type: "video" }, ...(game ? [{ parentId: game === "none" ? null : Number(game) || -1 }] : [])] },
      attributes: ["id", "genres"],
    });
    return c.json([...new Set(clips.flatMap((clip) => clip.genres))].sort((a, b) => a.localeCompare(b)));
  });
  //#endregion

  //#region Games

  /**
   * @swagger
   * /api/clips/libraries/{id}/games/search:
   *   get:
   *     summary: Games to pick for "Set game": the library's own that match `q`, then games found on Steam and SteamGridDB.
   */
  router.get("/libraries/:id/games/search", manage, async (c) => {
    const user = c.get("user")!;
    const library = await clipsLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const query = (c.req.query("q") ?? "").trim();
    const key = ClipNames.key(ClipNames.alias(query) ?? query);

    const games = await MediaItem.findAll({ where: { libraryId: library.id, type: "game" }, order: [["sortTitle", "ASC"]] });
    const counts = await Summaries.childCounts(games.map((g) => g.id));
    const own: GameCandidate[] = games
      .filter((g) => !key || ClipNames.key(g.title).includes(key) || g.sortTitle.includes(MediaItem.sortTitleFor(query)))
      .map((g) => ({ gameId: g.id, provider: null, id: null, title: g.title, year: g.year, cover: g.artwork.poster, clipCount: counts.get(g.id) ?? 0 }));

    let online: GameCandidate[] = [];
    let message: string | null = null;
    if (query.length >= 2 && (await ClipSettings.get()).lookups) {
      try {
        const ownIds = new Set(games.flatMap((g) => Object.entries(g.externalIds).map(([p, id]) => `${p}:${id}`)));
        const ownNames = new Set(games.map((g) => ClipNames.key(g.title)));
        online = (await GameInfo.search(query)).filter((r) => !ownIds.has(`${r.provider}:${r.id}`) && !ownNames.has(ClipNames.key(r.title)));
      } catch (error) {
        message = errorMessage(error);
      }
    }
    return c.json({ results: [...own, ...online], message });
  });

  /**
   * @swagger
   * /api/clips/libraries/{id}/game:
   *   put:
   *     summary: Put clips in a game by hand, or in none. Body is a `SetGameRequest`.
   */
  router.put("/libraries/:id/game", manage, async (c) => {
    const user = c.get("user")!;
    const library = await clipsLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const body = await readJson<SetGameRequest>(c);
    const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((id): id is number => Number.isInteger(id)))].slice(0, MAX_SET) : [];
    if (ids.length === 0 || body?.game === undefined) return c.json({ message: "Say which clips and which game: { \"ids\": [1, 2], \"game\": { \"gameId\": 3 } }." }, 400);

    const clips: MediaItem[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      clips.push(...await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { id: ids.slice(i, i + 500), libraryId: library.id, type: "video" }] } }));
    }
    if (clips.length === 0) return c.json({ message: "None of those clips are in this library." }, 404);
    try {
      const game = await ClipLibrary.setGame(library, clips, body.game);
      await recognizeAgain(library);
      return c.json({ game: game ? await Summaries.one(game, user) : null });
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/clips/games/{id}:
   *   put:
   *     summary: Rename a game (`{ "title": "…" }`), match it with one found online (`{ "provider": "steam", "id": "730" }`) or put its clips in
   *       another game (`{ "gameId": 3 }`). When the library already has the matched game, the clips move there; the response is the game they're in.
   */
  router.put("/games/:id", manage, async (c) => {
    const user = c.get("user")!;
    const game = await visibleGame(user, Number(c.req.param("id")));
    if (!game) return c.json({ message: "That game doesn't exist." }, 404);
    const body = await readJson<{ title: string; provider: string; id: string; gameId: number }>(c);
    if (!body) return c.json({ message: "Send a new title, or a game found online to match with." }, 400);
    try {
      const result = await ClipLibrary.editGame(game, { title: body.title, provider: body.provider, id: body.id === undefined ? undefined : String(body.id), gameId: Number(body.gameId) || undefined });
      return c.json(await Summaries.one(result, user));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/clips/games/{id}:
   *   delete:
   *     summary: Remove a game. Its clips stay, without a game.
   */
  router.delete("/games/:id", manage, async (c) => {
    const game = await visibleGame(c.get("user")!, Number(c.req.param("id")));
    if (!game) return c.json({ message: "That game doesn't exist." }, 404);
    await ClipLibrary.removeGame(game);
    return c.body(null, 204);
  });
  //#endregion

  //#region Clips

  /**
   * @swagger
   * /api/clips/{id}/suggestion:
   *   post:
   *     summary: Take the suggested game for a clip (`{ "accept": true }`), or say it's not that game (`{ "accept": false }`).
   */
  router.post("/:id/suggestion", manage, async (c) => {
    const user = c.get("user")!;
    const clip = await visibleClip(user, Number(c.req.param("id")));
    const suggestion = clip?.clip?.suggestion;
    if (!clip || !suggestion) return c.json({ message: "That clip has no suggested game." }, 404);
    const body = await readJson<{ accept: boolean }>(c);
    if (typeof body?.accept !== "boolean") return c.json({ message: "Say whether to take the suggestion: { \"accept\": true }." }, 400);
    const library = await Library.findByPk(clip.libraryId);
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);

    if (!body.accept) {
      await Recognition.dismiss(clip);
      return c.json(await Summaries.one(clip, user));
    }
    try {
      // A game the library doesn't have yet is looked up, so it comes with its artwork
      const match = suggestion.gameId ? null : await GameInfo.find(suggestion.title).catch(() => null);
      const choice = suggestion.gameId ? { gameId: suggestion.gameId } : match ? { provider: match.provider, id: match.id, title: match.title } : { title: suggestion.title };
      await ClipLibrary.setGame(library, [clip], choice);
      await recognizeAgain(library);
      await clip.reload();
      return c.json(await Summaries.one(clip, user));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/clips/favorite:
   *   put:
   *     summary: Star clips for the signed-in profile, or take the star off. Body `{ "ids": [1, 2], "favorite": true }`.
   */
  router.put("/favorite", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const body = await readJson<{ ids: number[]; favorite: boolean }>(c);
    const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((id): id is number => Number.isInteger(id)))].slice(0, MAX_SET) : [];
    if (ids.length === 0 || typeof body?.favorite !== "boolean") return c.json({ message: "Say which clips and whether to star them: { \"ids\": [1], \"favorite\": true }." }, 400);
    const clips = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { id: ids, type: "video" }] }, attributes: ["id"] });
    await WatchState.setFavorite(user.id, clips.map((clip) => clip.id), body.favorite);
    return c.body(null, 204);
  });

  /**
   * @swagger
   * /api/clips/{id}/keyframes:
   *   get:
   *     summary: Where the clip's keyframes are, in seconds, for cutting without converting.
   */
  router.get("/:id/keyframes", manage, async (c) => {
    const clip = await visibleClip(c.get("user")!, Number(c.req.param("id")));
    const file = clip ? await firstFile(clip) : null;
    if (!file) return c.json({ message: "That clip doesn't exist." }, 404);
    try {
      return c.json(await ClipTools.keyframes(file));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, error instanceof ClipTools.Problem ? error.status : 500);
    }
  });

  /**
   * @swagger
   * /api/clips/{id}/trim:
   *   post:
   *     summary: Cut a clip down without converting it. Body is a `TrimRequest`. Returns the clip with the cut (the same one when replacing).
   */
  router.post("/:id/trim", manage, async (c) => {
    const user = c.get("user")!;
    const clip = await visibleClip(user, Number(c.req.param("id")));
    const file = clip ? await firstFile(clip) : null;
    if (!clip || !file) return c.json({ message: "That clip doesn't exist." }, 404);
    const body = await readJson<TrimRequest>(c);
    if (typeof body?.start !== "number" || typeof body.end !== "number") return c.json({ message: "Say where the cut starts and ends, in seconds: { \"start\": 2.5, \"end\": 30, \"replace\": false }." }, 400);
    try {
      const result = await ClipTools.trim(clip, file, { start: body.start, end: body.end, replace: !!body.replace });
      return c.json(await Summaries.one(result, user));
    } catch (error) {
      if (!(error instanceof ClipTools.Problem)) log.error("Cutting a clip failed", { error });
      return c.json({ message: errorMessage(error) }, error instanceof ClipTools.Problem ? error.status : 500);
    }
  });

  /**
   * @swagger
   * /api/clips/{id}/share:
   *   post:
   *     summary: Start making a small copy of a clip that fits a size limit. Body is a `ShareCopyRequest`; the response is a `ShareCopyInfo` to follow.
   */
  router.post("/:id/share", User.$middleware({ permissions: ["MEDIA_DOWNLOAD"] }), async (c) => {
    const user = c.get("user")!;
    const clip = await visibleClip(user, Number(c.req.param("id")));
    const file = clip ? await firstFile(clip) : null;
    if (!clip || !file) return c.json({ message: "That clip doesn't exist." }, 404);
    try {
      return c.json(await ClipTools.startShare(clip, file, user.id, await readJson<ShareCopyRequest>(c) ?? {}));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, error instanceof ClipTools.Problem ? error.status : 500);
    }
  });

  /**
   * @swagger
   * /api/clips/shares/{id}:
   *   get:
   *     summary: How a small copy is coming along.
   */
  router.get("/shares/:id", User.$middleware(), (c) => {
    const info = ClipTools.share(c.req.param("id"), c.get("user")!.id);
    return info ? c.json(info) : c.json({ message: "That copy doesn't exist anymore. Make a new one." }, 404);
  });

  /**
   * @swagger
   * /api/clips/shares/{id}/file:
   *   get:
   *     summary: Download a finished small copy. The id works without signing in, for a day.
   */
  router.get("/shares/:id/file", async (c) => {
    const share = /^[0-9a-f]{32}$/.test(c.req.param("id")) ? ClipTools.shareFile(c.req.param("id")) : null;
    const res = share ? await sendFile(c, share.path, "video/mp4") : null;
    if (!share || !res) return c.json({ message: "That copy doesn't exist anymore. Make a new one." }, 404);
    if (c.req.query("download") === "1") res.headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(share.fileName)}`);
    return res;
  });
  //#endregion

  //#region Settings and picture recognition

  /**
   * @swagger
   * /api/clips/settings:
   *   get:
   *     summary: Online game lookups and picture recognition settings.
   */
  router.get("/settings", serverManage, async (c) => c.json(await ClipSettings.get()));

  /**
   * @swagger
   * /api/clips/settings:
   *   put:
   *     summary: Change online game lookups and picture recognition settings. Body is a partial `ClipsSettings`.
   */
  router.put("/settings", serverManage, async (c) => {
    const body = await readJson<ClipsSettings>(c);
    if (!body) return c.json({ message: "Nothing to change." }, 400);
    return c.json(await ClipSettings.update(body));
  });

  /**
   * @swagger
   * /api/clips/recognition:
   *   get:
   *     summary: Whether picture recognition is downloaded, and how many clips it has yet to look at.
   */
  router.get("/recognition", serverManage, async (c) => c.json(await Recognition.status()));

  /**
   * @swagger
   * /api/clips/recognition:
   *   post:
   *     summary: Download picture recognition (about 166 MB) in the background.
   */
  router.post("/recognition", serverManage, async (c) => {
    Recognition.install();
    return c.json(await Recognition.status());
  });

  /**
   * @swagger
   * /api/clips/recognition:
   *   delete:
   *     summary: Remove the downloaded picture recognition.
   */
  router.delete("/recognition", serverManage, async (c) => {
    try {
      await Recognition.uninstall();
      return c.json(await Recognition.status());
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 409);
    }
  });

  /**
   * @swagger
   * /api/clips/recognition/run:
   *   post:
   *     summary: Look at new clips and suggest games now, for every Clips library or the one in `{ "libraryId": 3 }`.
   */
  router.post("/recognition/run", manage, async (c) => {
    if ((await Recognition.status()).state !== "ready") return c.json({ message: "Download picture recognition first, in Settings › Metadata." }, 409);
    const body = await readJson<{ libraryId: number }>(c);
    const libraries = await Library.findAll({ where: { type: "clips", ...(body?.libraryId ? { id: body.libraryId } : {}) } });
    for (const library of libraries) Recognition.queue(library.id).catch(() => { });
    return c.body(null, 204);
  });
  //#endregion
}

export default ClipsController;
