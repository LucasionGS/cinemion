import { Hono } from "hono";
import { Op, type Order, type WhereOptions } from "sequelize";
import type { AlbumDetail, ArtistDetail, AudioFormat, MusicOverview, MusicPage, MusicSort, TrackInfo, TrackStream, TrackStreamRequest } from "@shared/music.ts";
import { Library, MediaFile, MediaItem, User, WatchState } from "../models/index.ts";
import PlayLog from "../stats/PlayLog.ts";
import Visibility from "../library/Visibility.ts";
import MusicSummaries from "../music/MusicSummaries.ts";
import AudioStream from "../music/AudioStream.ts";
import Lyrics from "../music/Lyrics.ts";
import StreamGrants from "../media/StreamGrants.ts";
import { errorMessage, readJson, sendFile } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Browsing Music libraries (albums, artists, tracks), playing tracks, and their lyrics.
 */
export namespace MusicController {
  export const router = new Hono<AppEnv>();

  const AUDIO_FORMATS: AudioFormat[] = ["mp3", "aac", "flac", "opus", "vorbis", "alac", "wav"];
  const ROW_SIZE = 18;

  function paging(c: { req: { query(name: string): string | undefined } }, defaultLimit = 60) {
    return {
      limit: Math.min(Math.max(parseInt(c.req.query("limit") ?? String(defaultLimit)) || defaultLimit, 1), 500),
      offset: Math.max(parseInt(c.req.query("offset") ?? "0") || 0, 0),
    };
  }

  async function musicLibrary(user: User, id: number) {
    const library = await Library.findByPk(id);
    return library && library.type === "music" && Visibility.canSeeLibrary(user, library.id) ? library : null;
  }

  async function visibleItem(user: User, id: number, type: "artist" | "album" | "track") {
    const item = await MediaItem.findByPk(id);
    return item && item.type === type && Visibility.canSee(user, item) ? item : null;
  }

  /**
   * Every track of `albums`, in album order.
   */
  async function tracksOf(albums: MediaItem[], user: User) {
    if (albums.length === 0) return [];
    const tracks = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { parentId: albums.map((a) => a.id), type: "track" }] } });
    const albumOrder = new Map(albums.map((a, i) => [a.id, i]));
    return tracks.sort((a, b) => albumOrder.get(a.parentId!)! - albumOrder.get(b.parentId!)! || MusicSummaries.compareTracks(a, b));
  }

  //#region Libraries

  /**
   * @swagger
   * /api/music/libraries/{id}/albums:
   *   get:
   *     summary: Albums in a Music library. Query `sort` (title, artist, added, year), `genre`, `offset`, `limit`.
   */
  router.get("/libraries/:id/albums", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await musicLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const sort = (c.req.query("sort") ?? "title") as MusicSort;
    const { limit, offset } = paging(c);
    const conditions: WhereOptions<MediaItem>[] = [Visibility.where(user), { libraryId: library.id, type: "album" }];
    const genre = c.req.query("genre");
    if (genre) conditions.push(MediaItem.genreCondition(genre));
    const where = { [Op.and]: conditions };
    const total = await MediaItem.count({ where });

    let albums: MediaItem[];
    if (sort === "artist") {
      // By artist name, then year: needs the artists, so sorted here rather than in the query
      const all = await MediaItem.findAll({ where });
      const artists = new Map((await MediaItem.findAll({ where: { id: [...new Set(all.map((a) => a.parentId!))] }, attributes: ["id", "sortTitle"] })).map((a) => [a.id, a.sortTitle]));
      all.sort((a, b) => (artists.get(a.parentId!) ?? "").localeCompare(artists.get(b.parentId!) ?? "") || (a.year ?? 0) - (b.year ?? 0) || a.sortTitle.localeCompare(b.sortTitle));
      albums = all.slice(offset, offset + limit);
    }
    else {
      const order: Order = sort === "added" ? [["addedAt", "DESC"], ["sortTitle", "ASC"]] : sort === "year" ? [["year", "DESC"], ["sortTitle", "ASC"]] : [["sortTitle", "ASC"]];
      albums = await MediaItem.findAll({ where, order, limit, offset });
    }
    const page: MusicPage<unknown> = { items: await MusicSummaries.albums(albums), total };
    return c.json(page);
  });

  /**
   * @swagger
   * /api/music/libraries/{id}/artists:
   *   get:
   *     summary: Artists in a Music library, by name. Query `offset`, `limit`.
   */
  router.get("/libraries/:id/artists", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await musicLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const { limit, offset } = paging(c, 120);
    const where = { [Op.and]: [Visibility.where(user), { libraryId: library.id, type: "artist" }] };
    const total = await MediaItem.count({ where });
    const artists = await MediaItem.findAll({ where, order: [["sortTitle", "ASC"]], limit, offset });
    const page: MusicPage<unknown> = { items: await MusicSummaries.artists(artists), total };
    return c.json(page);
  });

  /**
   * @swagger
   * /api/music/libraries/{id}/tracks:
   *   get:
   *     summary: Every track in a Music library. Query `sort` (title, artist, added), `offset`, `limit`.
   */
  router.get("/libraries/:id/tracks", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await musicLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const { limit, offset } = paging(c, 200);
    const sort = c.req.query("sort") as MusicSort;
    const where = { [Op.and]: [Visibility.where(user), { libraryId: library.id, type: "track" }] };
    const total = await MediaItem.count({ where });
    const order: Order = sort === "added" ? [["addedAt", "DESC"], ["sortTitle", "ASC"]] : [["sortTitle", "ASC"]];
    const tracks = await MediaItem.findAll({ where, order, limit, offset });
    const page: MusicPage<TrackInfo> = { items: await MusicSummaries.tracks(tracks, user), total };
    return c.json(page);
  });

  /**
   * @swagger
   * /api/music/libraries/{id}/overview:
   *   get:
   *     summary: Albums the profile played lately and the newest albums, for the top of a Music library.
   */
  router.get("/libraries/:id/overview", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await musicLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const visible = Visibility.where(user);

    const plays = await WatchState.findAll({ where: { userId: user.id, playCount: { [Op.gt]: 0 } }, order: [["lastWatchedAt", "DESC"]], limit: 300, attributes: ["itemId"] });
    const played = plays.length ? await MediaItem.findAll({ where: { id: plays.map((p) => p.itemId), libraryId: library.id, type: "track" }, attributes: ["id", "parentId"] }) : [];
    const albumOf = new Map(played.map((t) => [t.id, t.parentId!]));
    const albumOrder = [...new Set(plays.map((p) => albumOf.get(p.itemId)).filter((id): id is number => !!id))].slice(0, ROW_SIZE);
    const recentAlbums = albumOrder.length ? await MediaItem.findAll({ where: { [Op.and]: [visible, { id: albumOrder }] } }) : [];
    const byId = new Map(recentAlbums.map((a) => [a.id, a]));

    const newest = await MediaItem.findAll({ where: { [Op.and]: [visible, { libraryId: library.id, type: "album" }] }, order: [["addedAt", "DESC"]], limit: ROW_SIZE });
    const overview: MusicOverview = {
      recentlyPlayed: await MusicSummaries.albums(albumOrder.map((id) => byId.get(id)).filter((a): a is MediaItem => !!a)),
      recentlyAdded: await MusicSummaries.albums(newest),
    };
    return c.json(overview);
  });

  /**
   * @swagger
   * /api/music/libraries/{id}/genres:
   *   get:
   *     summary: Genres of the albums in a Music library.
   */
  router.get("/libraries/:id/genres", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await musicLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const albums = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { libraryId: library.id, type: "album" }] }, attributes: ["genres"] });
    return c.json([...new Set(albums.flatMap((a) => a.genres))].sort((a, b) => a.localeCompare(b)));
  });

  /**
   * @swagger
   * /api/music/libraries/{id}/shuffle:
   *   get:
   *     summary: Random tracks from a Music library, for shuffling everything. Query `limit` (default 100).
   */
  router.get("/libraries/:id/shuffle", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await musicLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const { limit } = paging(c, 100);
    // RANDOM() on SQLite, RAND() on MariaDB
    const tracks = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { libraryId: library.id, type: "track" }] }, order: MediaItem.sequelize!.random(), limit });
    return c.json(await MusicSummaries.tracks(tracks, user));
  });

  //#endregion

  //#region Albums and artists

  /**
   * @swagger
   * /api/music/albums/{id}:
   *   get:
   *     summary: An album with its tracks and the artist's other albums.
   */
  router.get("/albums/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const album = await visibleItem(user, Number(c.req.param("id")), "album");
    if (!album) return c.json({ message: "That album doesn't exist." }, 404);
    const [summary] = await MusicSummaries.albums([album]);
    const tracks = await MusicSummaries.tracks(await tracksOf([album], user), user);
    const others = album.parentId
      ? await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { parentId: album.parentId, type: "album", id: { [Op.ne]: album.id } }] }, order: [["year", "DESC"], ["sortTitle", "ASC"]], limit: ROW_SIZE })
      : [];
    const detail: AlbumDetail = {
      ...summary,
      trackCount: tracks.length,
      tracks,
      duration: tracks.reduce((sum, t) => sum + t.duration, 0),
      moreByArtist: await MusicSummaries.albums(others),
    };
    return c.json(detail);
  });

  /**
   * @swagger
   * /api/music/artists/{id}:
   *   get:
   *     summary: An artist with their albums, albums they appear on, and the profile's most played tracks by them.
   */
  router.get("/artists/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const artist = await visibleItem(user, Number(c.req.param("id")), "artist");
    if (!artist) return c.json({ message: "That artist doesn't exist." }, 404);
    const visible = Visibility.where(user);
    const [summary] = await MusicSummaries.artists([artist]);
    const albums = await MediaItem.findAll({ where: { [Op.and]: [visible, { parentId: artist.id, type: "album" }] }, order: [["year", "DESC"], ["sortTitle", "ASC"]] });

    // Tracks this artist performs on other artists' albums, like compilations
    const guestTracks = await MediaItem.findAll({ where: { [Op.and]: [visible, { libraryId: artist.libraryId, type: "track", artist: { [Op.like]: `%${artist.title}%` } }] }, attributes: ["parentId"] });
    const ownIds = new Set(albums.map((a) => a.id));
    const appearsOnIds = [...new Set(guestTracks.map((t) => t.parentId!))].filter((id) => !ownIds.has(id));
    const appearsOn = appearsOnIds.length ? await MediaItem.findAll({ where: { [Op.and]: [visible, { id: appearsOnIds }] }, order: [["sortTitle", "ASC"]] }) : [];

    const allTracks = await tracksOf(albums, user);
    const plays = allTracks.length ? await WatchState.findAll({ where: { userId: user.id, itemId: allTracks.map((t) => t.id), playCount: { [Op.gt]: 0 } }, order: [["playCount", "DESC"], ["lastWatchedAt", "DESC"]], limit: 5 }) : [];
    const byId = new Map(allTracks.map((t) => [t.id, t]));

    const detail: ArtistDetail = {
      ...summary,
      albums: await MusicSummaries.albums(albums),
      appearsOn: await MusicSummaries.albums(appearsOn),
      topTracks: await MusicSummaries.tracks(plays.map((p) => byId.get(p.itemId)).filter((t): t is MediaItem => !!t), user),
    };
    return c.json(detail);
  });

  /**
   * @swagger
   * /api/music/artists/{id}/tracks:
   *   get:
   *     summary: Every track on an artist's albums, newest album first, for playing or shuffling them all.
   */
  router.get("/artists/:id/tracks", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const artist = await visibleItem(user, Number(c.req.param("id")), "artist");
    if (!artist) return c.json({ message: "That artist doesn't exist." }, 404);
    const albums = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { parentId: artist.id, type: "album" }] }, order: [["year", "DESC"], ["sortTitle", "ASC"]] });
    return c.json(await MusicSummaries.tracks(await tracksOf(albums, user), user));
  });

  //#endregion

  //#region Playing

  /**
   * @swagger
   * /api/music/tracks/{id}/stream:
   *   post:
   *     summary: A URL to play a track. The body lists the audio formats the browser plays (`TrackStreamRequest`);
   *       others are converted. The URL works without a sign-in header, for audio elements.
   */
  router.post("/tracks/:id/stream", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const track = await visibleItem(user, Number(c.req.param("id")), "track");
    const file = track ? await MediaFile.findOne({ where: { itemId: track.id }, order: [["path", "ASC"]] }) : null;
    if (!track || !file) return c.json({ message: "That track doesn't exist." }, 404);
    const body = await readJson<TrackStreamRequest>(c);
    const formats = (Array.isArray(body?.formats) ? body.formats : ["mp3", "aac"]).filter((f): f is AudioFormat => AUDIO_FORMATS.includes(f as AudioFormat));
    const direct = AudioStream.canPlayDirect(file, formats);
    if (!direct) {
      // Converted before answering, so the player gets a file it can seek in right away
      try {
        await AudioStream.converted(file);
      } catch (error) {
        return c.json({ message: errorMessage(error) }, 500);
      }
    }
    const token = StreamGrants.grant(file.id, user.id);
    const stream: TrackStream = { url: `/api/music/stream/${token}${direct ? "" : "?converted=1"}`, direct, duration: file.duration ?? 0 };
    return c.json(stream);
  });

  /**
   * @swagger
   * /api/music/stream/{token}:
   *   get:
   *     summary: The track's file, or its converted version with `converted=1`, with range requests for seeking.
   */
  router.get("/stream/:token", async (c) => {
    const g = StreamGrants.use(c.req.param("token"));
    const file = g ? await MediaFile.findByPk(g.fileId) : null;
    if (!file) return c.json({ message: "This stream has expired. Play the track again." }, 404);
    try {
      const response = c.req.query("converted")
        ? await sendFile(c, await AudioStream.converted(file), "audio/mp4")
        : await sendFile(c, file.path, AudioStream.contentType(file));
      return response ?? c.json({ message: "The music file can't be found on disk." }, 404);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 500);
    }
  });

  /**
   * @swagger
   * /api/music/tracks/{id}/played:
   *   post:
   *     summary: Count a play of a track for the signed-in profile, once it played for a while.
   */
  router.post("/tracks/:id/played", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const track = await visibleItem(user, Number(c.req.param("id")), "track");
    if (!track) return c.json({ message: "That track doesn't exist." }, 404);
    await WatchState.recordPlay(user.id, track.id);
    // The client counts a play after half the track or 30 seconds; most plays are listened to the end
    const file = await MediaFile.findOne({ where: { itemId: track.id }, attributes: ["duration"] });
    await PlayLog.add(user.id, track.id, Math.min(file?.duration ?? 0, 20 * 60)).catch(() => { });
    return c.body(null, 204);
  });

  /**
   * @swagger
   * /api/music/tracks/{id}/lyrics:
   *   get:
   *     summary: The words to a track, timed when there's an LRC file or timed lyrics tag.
   */
  router.get("/tracks/:id/lyrics", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const track = await visibleItem(user, Number(c.req.param("id")), "track");
    const file = track ? await MediaFile.findOne({ where: { itemId: track.id }, order: [["path", "ASC"]] }) : null;
    if (!track || !file) return c.json({ message: "That track doesn't exist." }, 404);
    return c.json(await Lyrics.read(file));
  });

  /**
   * @swagger
   * /api/music/tracks:
   *   get:
   *     summary: Several tracks by id, in the order asked, like a saved queue. Query `ids` (comma-separated).
   */
  router.get("/tracks", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const ids = (c.req.query("ids") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
    const tracks = ids.length ? await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { id: ids, type: "track" }] } }) : [];
    const byId = new Map(tracks.map((t) => [t.id, t]));
    return c.json(await MusicSummaries.tracks(ids.map((id) => byId.get(id)).filter((t): t is MediaItem => !!t), user));
  });

  //#endregion

}

export default MusicController;
