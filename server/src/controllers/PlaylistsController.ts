import { Hono } from "hono";
import { Op } from "sequelize";
import type { PlaylistDetail, PlaylistSummary } from "@shared/music.ts";
import { MediaItem, Playlist, PlaylistItem, User } from "../models/index.ts";
import Visibility from "../library/Visibility.ts";
import MusicSummaries from "../music/MusicSummaries.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Each profile's own playlists. Tracks the profile can't see (another library, an age limit) are left out of what
 * it gets back, but stay in the playlist.
 */
export namespace PlaylistsController {
  export const router = new Hono<AppEnv>();

  const MAX_TRACKS = 5000;

  async function own(user: User, id: number) {
    const playlist = await Playlist.findByPk(id);
    return playlist && playlist.userId === user.id ? playlist : null;
  }

  /**
   * The playlist's entries in order, with the tracks `user` may see.
   */
  async function entries(playlist: Playlist, user: User) {
    const rows = await PlaylistItem.findAll({ where: { playlistId: playlist.id }, order: [["position", "ASC"], ["id", "ASC"]] });
    const tracks = rows.length ? await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { id: [...new Set(rows.map((r) => r.itemId))], type: "track" }] } }) : [];
    const byId = new Map(tracks.map((t) => [t.id, t]));
    return rows.filter((r) => byId.has(r.itemId)).map((r) => ({ entry: r, track: byId.get(r.itemId)! }));
  }

  async function summary(playlist: Playlist, user: User): Promise<PlaylistSummary> {
    const list = await entries(playlist, user);
    const infos = await MusicSummaries.tracks(list.map((e) => e.track), user);
    return {
      id: playlist.id,
      name: playlist.name,
      trackCount: infos.length,
      duration: infos.reduce((sum, t) => sum + t.duration, 0),
      covers: [...new Set(infos.map((t) => t.cover).filter((c): c is string => !!c))].slice(0, 4),
      updatedAt: playlist.updatedAt.toISOString(),
    };
  }

  async function detail(playlist: Playlist, user: User): Promise<PlaylistDetail> {
    const list = await entries(playlist, user);
    const infos = await MusicSummaries.tracks(list.map((e) => e.track), user);
    return {
      ...await summary(playlist, user),
      tracks: infos.map((t, i) => ({ ...t, entryId: list[i].entry.id })),
    };
  }

  /**
   * Tracks from `ids` that exist and `user` may see, in the order given.
   */
  async function visibleTracks(user: User, ids: unknown) {
    const wanted = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_TRACKS);
    if (wanted.length === 0) return [];
    const found = new Set((await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { id: wanted, type: "track" }] }, attributes: ["id"] })).map((t) => t.id));
    return wanted.filter((id) => found.has(id));
  }

  async function append(playlist: Playlist, trackIds: number[]) {
    const count = await PlaylistItem.count({ where: { playlistId: playlist.id } });
    if (count + trackIds.length > MAX_TRACKS) throw new Error(`A playlist can hold up to ${MAX_TRACKS} tracks.`);
    const last = await PlaylistItem.max<number, PlaylistItem>("position", { where: { playlistId: playlist.id } });
    let position = (last ?? -1) + 1;
    await PlaylistItem.bulkCreate(trackIds.map((itemId) => ({ playlistId: playlist.id, itemId, position: position++ })));
    playlist.changed("updatedAt", true);
    await playlist.save();
  }

  /**
   * @swagger
   * /api/playlists:
   *   get:
   *     summary: The signed-in profile's playlists, most recently changed first.
   */
  router.get("/", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const playlists = await Playlist.findAll({ where: { userId: user.id }, order: [["updatedAt", "DESC"]] });
    const result: PlaylistSummary[] = [];
    for (const playlist of playlists) result.push(await summary(playlist, user));
    return c.json(result);
  });

  /**
   * @swagger
   * /api/playlists:
   *   post:
   *     summary: Make a playlist. Body `{ name, trackIds? }`.
   */
  router.post("/", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const body = await readJson<{ name: string; trackIds: number[] }>(c);
    try {
      const playlist = await Playlist.create({ userId: user.id, name: Playlist.cleanName(body?.name) });
      const tracks = await visibleTracks(user, body?.trackIds);
      if (tracks.length) await append(playlist, tracks);
      return c.json(await detail(playlist, user), 201);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/playlists/{id}:
   *   get:
   *     summary: A playlist with its tracks.
   */
  router.get("/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const playlist = await own(user, Number(c.req.param("id")));
    if (!playlist) return c.json({ message: "That playlist doesn't exist." }, 404);
    return c.json(await detail(playlist, user));
  });

  /**
   * @swagger
   * /api/playlists/{id}:
   *   patch:
   *     summary: Rename a playlist. Body `{ name }`.
   */
  router.patch("/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const playlist = await own(user, Number(c.req.param("id")));
    if (!playlist) return c.json({ message: "That playlist doesn't exist." }, 404);
    const body = await readJson<{ name: string }>(c);
    try {
      playlist.name = Playlist.cleanName(body?.name);
      await playlist.save();
      return c.json(await summary(playlist, user));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/playlists/{id}:
   *   delete:
   *     summary: Delete a playlist. The tracks stay in the library.
   */
  router.delete("/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const playlist = await own(user, Number(c.req.param("id")));
    if (!playlist) return c.json({ message: "That playlist doesn't exist." }, 404);
    await PlaylistItem.destroy({ where: { playlistId: playlist.id } });
    await playlist.destroy();
    return c.body(null, 204);
  });

  /**
   * @swagger
   * /api/playlists/{id}/tracks:
   *   post:
   *     summary: Add tracks to the end of a playlist. Body `{ trackIds }`.
   */
  router.post("/:id/tracks", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const playlist = await own(user, Number(c.req.param("id")));
    if (!playlist) return c.json({ message: "That playlist doesn't exist." }, 404);
    const body = await readJson<{ trackIds: number[] }>(c);
    const tracks = await visibleTracks(user, body?.trackIds);
    if (tracks.length === 0) return c.json({ message: "Pick at least one track to add." }, 400);
    try {
      await append(playlist, tracks);
      return c.json(await summary(playlist, user));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/playlists/{id}/entries/{entryId}:
   *   delete:
   *     summary: Take one entry out of a playlist.
   */
  router.delete("/:id/entries/:entryId", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const playlist = await own(user, Number(c.req.param("id")));
    if (!playlist) return c.json({ message: "That playlist doesn't exist." }, 404);
    await PlaylistItem.destroy({ where: { playlistId: playlist.id, id: Number(c.req.param("entryId")) } });
    playlist.changed("updatedAt", true);
    await playlist.save();
    return c.json(await detail(playlist, user));
  });

  /**
   * @swagger
   * /api/playlists/{id}/order:
   *   put:
   *     summary: Put a playlist's entries in a new order. Body `{ entryIds }`; entries left out keep their place
   *       after the ones given.
   */
  router.put("/:id/order", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const playlist = await own(user, Number(c.req.param("id")));
    if (!playlist) return c.json({ message: "That playlist doesn't exist." }, 404);
    const body = await readJson<{ entryIds: number[] }>(c);
    const wanted = (Array.isArray(body?.entryIds) ? body.entryIds : []).map(Number);
    const rows = await PlaylistItem.findAll({ where: { playlistId: playlist.id }, order: [["position", "ASC"], ["id", "ASC"]] });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = [...new Set(wanted)].map((id) => byId.get(id)).filter((r): r is PlaylistItem => !!r);
    const rest = rows.filter((r) => !ordered.includes(r));
    for (const [position, row] of [...ordered, ...rest].entries()) {
      if (row.position !== position) await row.update({ position });
    }
    playlist.changed("updatedAt", true);
    await playlist.save();
    return c.json(await detail(playlist, user));
  });
}

export default PlaylistsController;
