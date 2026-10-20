import { Hono, type Context } from "hono";
import { Op, type WhereOptions } from "sequelize";
import type { ItemType } from "@shared/media.ts";
import AppSystem from "../AppSystem.ts";
import { Library, MediaFile, MediaItem, Setting, User } from "../models/index.ts";
import CompatApi from "../integrations/CompatApi.ts";
import ActivePlayback from "../media/ActivePlayback.ts";
import ServerController from "./ServerController.ts";
import Visibility from "../library/Visibility.ts";
import RateLimit from "../lib/RateLimit.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import log from "../lib/Logger.ts";
import { AVATAR_SIZES } from "@shared/profiles.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * The media server API that Seerr and Homepage speak, mounted at the root next to the web app (see `CompatApi`).
 * Paths and field names follow what those apps send and expect, so they don't follow Cinemion's own API style.
 */
export namespace CompatController {
  export const router = new Hono<AppEnv>();

  const signedIn = CompatApi.$middleware();
  const admin = CompatApi.$middleware({ admin: true });
  // Same as signing in to Cinemion itself: 5 wrong guesses lock that username for 30 seconds
  const limiter = new RateLimit(5, 30);

  const TICKS_PER_SECOND = 10_000_000;
  const MAX_PAGE = 1000;

  function serverName() {
    return Setting.get(Setting.Keys.SERVER_NAME, AppSystem.APP_NAME);
  }

  /**
   * A query parameter, whatever its capitalisation (the apps aren't consistent: `ParentId`, `seasonId`, `ids`).
   */
  function param(c: Context<AppEnv>, name: string) {
    const lower = name.toLowerCase();
    for (const [key, value] of new URL(c.req.url).searchParams) {
      if (key.toLowerCase() === lower) return value;
    }
    return undefined;
  }

  function listParam(c: Context<AppEnv>, name: string) {
    return (param(c, name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  }

  function intParam(c: Context<AppEnv>, name: string, fallback: number) {
    const value = parseInt(param(c, name) ?? "");
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  }

  /**
   * The seasons and shows the items belong to, and their files when `withFiles` is set.
   */
  async function contextFor(items: MediaItem[], withFiles: boolean): Promise<CompatApi.ItemContext> {
    const parents = new Map<number, MediaItem>();
    let missing = [...new Set(items.map((i) => i.parentId).filter((id): id is number => id !== null))];
    // Episode → season → show
    for (let depth = 0; depth < 2 && missing.length > 0; depth++) {
      const found = await MediaItem.findAll({ where: { id: missing } });
      for (const item of found) parents.set(item.id, item);
      missing = [...new Set(found.map((i) => i.parentId).filter((id): id is number => id !== null && !parents.has(id)))];
    }

    let files: Map<number, MediaFile[]> | null = null;
    if (withFiles) {
      files = new Map();
      const rows = await MediaFile.findAll({ where: { itemId: items.map((i) => i.id) }, order: [["id", "ASC"]] });
      for (const file of rows) {
        if (file.itemId === null) continue;
        files.set(file.itemId, [...files.get(file.itemId) ?? [], file]);
      }
    }
    return { serverId: (await CompatApi.stored()).serverId, parents, files };
  }

  async function itemsJson(items: MediaItem[], withFiles: boolean) {
    const ctx = await contextFor(items, withFiles);
    return items.map((item) => CompatApi.itemJson(item, ctx));
  }

  function wantsFiles(c: Context<AppEnv>) {
    return listParam(c, "fields").some((f) => f.toLowerCase() === "mediasources");
  }

  /**
   * Ids of everything below an item: a show's seasons and episodes, a folder's videos.
   */
  async function descendantIds(rootId: number) {
    const all: number[] = [];
    let level = [rootId];
    for (let depth = 0; depth < 8 && level.length > 0; depth++) {
      level = (await MediaItem.findAll({ where: { parentId: level }, attributes: ["id"] })).map((i) => i.id);
      all.push(...level);
    }
    return all;
  }

  //#region Server

  const systemInfo = async (c: Context<AppEnv>) => {
    const info = await CompatApi.serverInfo(await serverName(), !await ServerController.needsSetup());
    return c.json({ ...info, LocalAddress: new URL(c.req.url).origin });
  };
  router.get("/System/Info/Public", systemInfo);
  router.get("/System/Info", signedIn, systemInfo);

  //#endregion

  //#region Users

  router.post("/Users/AuthenticateByName", async (c) => {
    const body = await readJson<{ Username?: string; Pw?: string; Password?: string }>(c);
    const username = body?.Username?.trim() ?? "";
    const password = body?.Pw ?? body?.Password ?? "";
    if (!username || !password) return c.json({ message: "Username and password are required." }, 400);

    const key = `user:${username.toLowerCase()}`;
    const locked = limiter.lockedFor(key);
    if (locked) return c.json({ message: `Too many wrong attempts. Try again in ${locked} seconds.` }, 429);

    const user = await User.authenticateUser(username, password);
    if (!user) {
      limiter.fail(key);
      return c.json({ message: "That username and password don't match." }, 401);
    }
    limiter.reset(key);

    const userJson = await CompatApi.userJson(user, await serverName());
    return c.json({
      User: userJson,
      SessionInfo: { UserId: userJson.Id, UserName: userJson.Name, ServerId: userJson.ServerId },
      AccessToken: await user.createToken(),
      ServerId: userJson.ServerId,
    });
  });

  router.get("/Users", admin, async (c) => {
    const name = await serverName();
    // Profiles without a password can only be opened from the profile picker, so other apps can't sign them in
    const users = await User.findAll({ where: { password: { [Op.ne]: null } }, order: [["id", "ASC"]] });
    return c.json(await Promise.all(users.map((u) => CompatApi.userJson(u, name))));
  });

  router.get("/Users/Me", signedIn, async (c) => c.json(await CompatApi.userJson(c.get("user")!, await serverName())));

  router.get("/Users/:id", signedIn, async (c) => {
    const me = c.get("user")!;
    const id = CompatApi.decodeId("user", c.req.param("id"));
    if (id !== me.id && !me.isAdmin()) return c.json({ message: "That user doesn't exist." }, 404);
    const user = id === me.id ? me : id ? await User.findByPk(id) : null;
    if (!user) return c.json({ message: "That user doesn't exist." }, 404);
    return c.json(await CompatApi.userJson(user, await serverName()));
  });

  // Public, like Cinemion's own profile pictures
  router.get("/Users/:id/Images/Primary", async (c) => {
    const id = CompatApi.decodeId("user", c.req.param("id"));
    const user = id ? await User.findByPk(id) : null;
    if (!user?.avatar) return c.json({ message: "That user has no profile picture." }, 404);
    return c.redirect(`/api/users/${user.id}/avatar/${user.avatar}/${AVATAR_SIZES[0]}`);
  });

  router.get("/Users/:id/Views", signedIn, async (c) => {
    const user = c.get("user")!;
    const serverId = (await CompatApi.stored()).serverId;
    const libraries = (await Library.findAll({ order: [["id", "ASC"]] })).filter((l) => Visibility.canSeeLibrary(user, l.id));
    return c.json({ Items: libraries.map((l) => CompatApi.libraryJson(l, serverId)), TotalRecordCount: libraries.length, StartIndex: 0 });
  });

  //#endregion

  //#region Libraries and items

  router.get("/Library/MediaFolders", signedIn, async (c) => {
    const user = c.get("user")!;
    const serverId = (await CompatApi.stored()).serverId;
    const libraries = (await Library.findAll({ order: [["id", "ASC"]] })).filter((l) => Visibility.canSeeLibrary(user, l.id));
    return c.json({ Items: libraries.map((l) => CompatApi.libraryJson(l, serverId)), TotalRecordCount: libraries.length, StartIndex: 0 });
  });

  const counts = async (c: Context<AppEnv>) => {
    const user = c.get("user")!;
    const count = (types: ItemType[]) => MediaItem.count({ where: { [Op.and]: [Visibility.where(user), { type: types }] } });
    const [movies, shows, episodes, songs, albums, artists, books, total] = await Promise.all([
      count(["movie"]), count(["show"]), count(["episode"]), count(["track"]), count(["album"]), count(["artist"]),
      count(["book", "audiobook"]), MediaItem.count({ where: Visibility.where(user) }),
    ]);
    return c.json({
      MovieCount: movies,
      SeriesCount: shows,
      EpisodeCount: episodes,
      SongCount: songs,
      AlbumCount: albums,
      ArtistCount: artists,
      BookCount: books,
      MusicVideoCount: 0,
      BoxSetCount: 0,
      TrailerCount: 0,
      ProgramCount: 0,
      ItemCount: total,
    });
  };
  router.get("/Items/Counts", signedIn, counts);

  // Newest movies and shows of a library. New episodes count for their show, once.
  const latest = async (c: Context<AppEnv>) => {
    const user = c.get("user")!;
    const limit = Math.min(intParam(c, "Limit", 20) || 20, 100);
    const libraryId = CompatApi.decodeId("library", param(c, "ParentId"));
    const where: WhereOptions<MediaItem>[] = [Visibility.where(user), { type: ["movie", "episode", "video", "album", "audiobook", "book"] }];
    if (libraryId) where.push({ libraryId });

    const recent = await MediaItem.findAll({ where: { [Op.and]: where }, order: [["addedAt", "DESC"]], limit: limit * 10 });
    const ctx = await contextFor(recent, false);
    const ids: number[] = [];
    for (const item of recent) {
      const season = item.type === "episode" && item.parentId ? ctx.parents.get(item.parentId) : undefined;
      const id = season?.parentId ?? item.id;
      if (!ids.includes(id)) ids.push(id);
      if (ids.length >= limit) break;
    }
    const items = await MediaItem.findAll({ where: { id: ids } });
    items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    return c.json(await itemsJson(items, false));
  };
  router.get("/Items/Latest", signedIn, latest);
  router.get("/Users/:userId/Items/Latest", signedIn, latest);

  const items = async (c: Context<AppEnv>) => {
    const user = c.get("user")!;
    const where: WhereOptions<MediaItem>[] = [Visibility.where(user)];

    const ids = listParam(c, "ids").map((id) => CompatApi.decodeId("item", id)).filter((id): id is number => id !== null);
    if (param(c, "ids") !== undefined) where.push({ id: ids });

    const types = CompatApi.itemTypesFor(listParam(c, "IncludeItemTypes"));
    if (types.length > 0) where.push({ type: types });

    const recursive = param(c, "Recursive")?.toLowerCase() === "true";
    const parent = param(c, "ParentId");
    const libraryId = CompatApi.decodeId("library", parent);
    const parentItemId = CompatApi.decodeId("item", parent);
    if (libraryId) {
      where.push({ libraryId });
      if (!recursive) where.push({ parentId: null });
    }
    else if (parentItemId) {
      where.push({ id: recursive ? await descendantIds(parentItemId) : (await MediaItem.findAll({ where: { parentId: parentItemId }, attributes: ["id"] })).map((i) => i.id) });
    }
    else if (parent) {
      return c.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
    }
    else if (!recursive && ids.length === 0) {
      where.push({ parentId: null });
    }

    const start = intParam(c, "StartIndex", 0);
    const limit = Math.min(intParam(c, "Limit", MAX_PAGE) || MAX_PAGE, MAX_PAGE);
    const { rows, count } = await MediaItem.findAndCountAll({
      where: { [Op.and]: where },
      order: [["sortTitle", "ASC"], ["seasonNumber", "ASC"], ["episodeNumber", "ASC"], ["id", "ASC"]],
      offset: start,
      limit,
    });
    return c.json({ Items: await itemsJson(rows, wantsFiles(c)), TotalRecordCount: count, StartIndex: start });
  };
  router.get("/Items", signedIn, items);
  router.get("/Users/:userId/Items", signedIn, items);

  const item = async (c: Context<AppEnv>) => {
    const user = c.get("user")!;
    const id = CompatApi.decodeId("item", c.req.param("id"));
    const found = id ? await MediaItem.findByPk(id) : null;
    if (!found || !Visibility.canSee(user, found)) return c.json({ message: "That item doesn't exist." }, 404);
    return c.json((await itemsJson([found], true))[0]);
  };
  router.get("/Items/:id", signedIn, item);
  router.get("/Users/:userId/Items/:id", signedIn, item);

  /**
   * The show with the id in the path, when the signed-in user may see it.
   */
  async function findShow(c: Context<AppEnv>) {
    const id = CompatApi.decodeId("item", c.req.param("id"));
    const show = id ? await MediaItem.findByPk(id) : null;
    return show?.type === "show" && Visibility.canSee(c.get("user")!, show) ? show : null;
  }

  router.get("/Shows/:id/Seasons", signedIn, async (c) => {
    const show = await findShow(c);
    if (!show) return c.json({ message: "That show doesn't exist." }, 404);
    const seasons = await MediaItem.findAll({ where: { parentId: show.id, type: "season" }, order: [["seasonNumber", "ASC"]] });
    return c.json({ Items: await itemsJson(seasons, false), TotalRecordCount: seasons.length, StartIndex: 0 });
  });

  router.get("/Shows/:id/Episodes", signedIn, async (c) => {
    const show = await findShow(c);
    if (!show) return c.json({ message: "That show doesn't exist." }, 404);
    const seasons = await MediaItem.findAll({ where: { parentId: show.id, type: "season" } });

    const seasonId = CompatApi.decodeId("item", param(c, "seasonId"));
    const seasonNumber = param(c, "season");
    const picked = seasons.filter((s) => {
      if (seasonId) return s.id === seasonId;
      if (seasonNumber !== undefined) return s.seasonNumber === parseInt(seasonNumber);
      return true;
    });

    const episodes = await MediaItem.findAll({
      where: { parentId: picked.map((s) => s.id), type: "episode" },
      order: [["seasonNumber", "ASC"], ["episodeNumber", "ASC"], ["id", "ASC"]],
    });
    return c.json({ Items: await itemsJson(episodes, wantsFiles(c)), TotalRecordCount: episodes.length, StartIndex: 0 });
  });

  //#endregion

  //#region App keys

  router.get("/Auth/Keys", admin, async (c) => {
    const keys = (await CompatApi.stored()).keys;
    return c.json({
      Items: keys.map((k) => ({ Id: k.id, AccessToken: k.token, AppName: k.app, DateCreated: k.createdAt, IsActive: true })),
      TotalRecordCount: keys.length,
      StartIndex: 0,
    });
  });

  router.post("/Auth/Keys", admin, async (c) => {
    const app = param(c, "App") ?? "";
    try {
      const key = await CompatApi.createKey(app, c.get("user")!);
      log.info("App key made", { app: key.app, by: c.get("user")!.username });
      return c.body(null, 204);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  router.delete("/Auth/Keys/:key", admin, async (c) => {
    if (!await CompatApi.removeKey(c.req.param("key"))) return c.json({ message: "That key doesn't exist." }, 404);
    return c.body(null, 204);
  });

  //#endregion

  //#region Now playing

  router.get("/Sessions", admin, async (c) => {
    const entries = ActivePlayback.list().filter((e) => Date.now() - e.lastSeen < ActivePlayback.STALE_AFTER);
    const playing = await MediaItem.findAll({ where: { id: entries.map((e) => e.itemId) } });
    const users = await User.findAll({ where: { id: entries.map((e) => e.userId) } });
    const ctx = await contextFor(playing, false);

    return c.json(entries.flatMap((entry) => {
      const item = playing.find((i) => i.id === entry.itemId);
      if (!item) return [];
      const user = users.find((u) => u.id === entry.userId);
      return [{
        Id: entry.id,
        UserId: CompatApi.encodeId("user", entry.userId),
        UserName: user?.name ?? "Someone",
        Client: AppSystem.APP_NAME,
        DeviceName: entry.device,
        ApplicationVersion: AppSystem.VERSION,
        IsActive: true,
        LastActivityDate: new Date(entry.lastSeen).toISOString(),
        NowPlayingItem: { ...CompatApi.itemJson(item, ctx), RunTimeTicks: Math.round(entry.duration * TICKS_PER_SECOND) },
        PlayState: {
          PositionTicks: Math.round(entry.position * TICKS_PER_SECOND),
          IsPaused: entry.paused,
          IsMuted: false,
          CanSeek: true,
          PlayMethod: entry.mode === "direct" ? "DirectPlay" : entry.mode === "remux" ? "DirectStream" : "Transcode",
        },
        ...(entry.mode === "transcode" ? { TranscodingInfo: { IsVideoDirect: false, IsAudioDirect: false } } : {}),
      }];
    }));
  });

  //#endregion

  //#region Links

  // Apps link to items as /web/index.html#!/details?id=<id>. The id is in the part after #, which never reaches the
  // server, so a tiny page reads it and opens the item in the web app.
  const REDIRECT_PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${AppSystem.APP_NAME}</title>
<script>
  var match = /[?&]id=([0-9a-f]{32})/i.exec(location.hash);
  var id = match && match[1].charAt(0).toLowerCase() === "c" ? parseInt(match[1].slice(1), 16) : 0;
  location.replace(id ? "/item/" + id : "/");
</script>
</head>
<body></body>
</html>
`;
  const redirect = (c: Context<AppEnv>) => c.html(REDIRECT_PAGE, 200, { "Cache-Control": "no-cache" });
  router.get("/web", redirect);
  router.get("/web/", redirect);
  router.get("/web/index.html", redirect);

  //#endregion
}

export default CompatController;
