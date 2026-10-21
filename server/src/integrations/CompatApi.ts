import { encodeHex } from "@std/encoding/hex";
import type { Context, MiddlewareHandler } from "hono";
import type { AppKeyInfo } from "@shared/admin.ts";
import type { LibraryType } from "@shared/api.ts";
import type { ItemType } from "@shared/media.ts";
import AppSystem from "../AppSystem.ts";
import { type Library, type MediaFile, type MediaItem, Setting, User } from "../models/index.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * The media server API that request apps (Seerr) and dashboards (Homepage) already speak, so they can use Cinemion
 * without knowing about it. Only the parts those apps call are there: sign-in, users, libraries, items, seasons and
 * episodes with their provider ids, app keys, item counts and who's watching.
 */
export namespace CompatApi {
  /**
   * What's stored in the `compatApi` setting.
   */
  export interface Stored {
    /**
     * The id apps store to recognise this server. Made once.
     */
    serverId: string;
    keys: StoredKey[];
  }

  export interface StoredKey {
    id: string;
    app: string;
    token: string;
    userId: number;
    createdAt: string;
  }

  // Ids are 32 lowercase hex characters, which the apps check for. The first one says what the id is for.
  const ID_PREFIX = { user: "a", library: "b", item: "c", file: "d" } as const;
  export type IdKind = keyof typeof ID_PREFIX;

  const TICKS_PER_SECOND = 10_000_000;

  //#region Ids

  /**
   * Turn a Cinemion id into the apps' id format, like `c0000000000000000000000000000012` for item 18.
   */
  export function encodeId(kind: IdKind, id: number) {
    return ID_PREFIX[kind] + id.toString(16).padStart(31, "0");
  }

  /**
   * The Cinemion id inside an id from `encodeId()`, or `null` when it's for something else.
   */
  export function decodeId(kind: IdKind, value: string | undefined | null) {
    if (!value) return null;
    const id = value.replace(/-/g, "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(id) || id[0] !== ID_PREFIX[kind]) return null;
    const number = parseInt(id.slice(1), 16);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  //#endregion

  //#region Stored settings and keys

  export async function stored(): Promise<Stored> {
    const value = await Setting.get<Partial<Stored> | null>(Setting.Keys.COMPAT_API, null);
    const result: Stored = { serverId: value?.serverId || "", keys: value?.keys ?? [] };
    if (!result.serverId) {
      result.serverId = randomHex();
      await Setting.set(Setting.Keys.COMPAT_API, result);
    }
    return result;
  }

  async function save(patch: Partial<Stored>) {
    const next = { ...await stored(), ...patch };
    await Setting.set(Setting.Keys.COMPAT_API, next);
    return next;
  }

  /**
   * Make a key for `app` that acts as `user`.
   */
  export async function createKey(app: string, user: User) {
    const name = app.trim().slice(0, 60);
    if (!name) throw new Error("Give the key a name, like the app that will use it.");
    const key: StoredKey = { id: randomHex(4), app: name, token: randomHex(), userId: user.id, createdAt: new Date().toISOString() };
    await save({ keys: [...(await stored()).keys, key] });
    return key;
  }

  /**
   * Remove the key with this id or token.
   * @returns `false` when there was no such key.
   */
  export async function removeKey(idOrToken: string) {
    const keys = (await stored()).keys;
    const remaining = keys.filter((k) => k.id !== idOrToken && k.token !== idOrToken);
    if (remaining.length === keys.length) return false;
    await save({ keys: remaining });
    return true;
  }

  /**
   * Every key, as Settings › Integrations shows them.
   */
  export async function keysForClient(): Promise<AppKeyInfo[]> {
    const keys = (await stored()).keys;
    const users = await User.findAll({ where: { id: [...new Set(keys.map((k) => k.userId))] } });
    return keys.map((k) => ({
      id: k.id,
      app: k.app,
      token: k.token,
      createdBy: users.find((u) => u.id === k.userId)?.name ?? null,
      createdAt: k.createdAt,
    }));
  }

  //#endregion

  //#region Signing in

  /**
   * Tokens the request carries, in every place these apps put them.
   */
  function tokensOf(c: Context<AppEnv>) {
    const tokens: string[] = [];
    for (const [name, value] of c.req.raw.headers) {
      if (/authorization$/i.test(name)) {
        // Example:
        // <scheme> Client="Seerr", Device="Seerr", DeviceId="Qk9U", Version="2.0.0", Token="0123abcd"
        const token = value.match(/\bToken="([^"]*)"/i)?.[1];
        if (token) tokens.push(decodeURIComponent(token));
        else if (/^Bearer /i.test(value)) tokens.push(value.slice(7).trim());
      }
      else if (/-token$/i.test(name) && value) {
        tokens.push(value.trim());
      }
    }
    const query = c.req.query("api_key") ?? c.req.query("ApiKey");
    if (query) tokens.push(query);
    return tokens;
  }

  /**
   * The user a request acts as: the profile behind an app key, or the one a sign-in token belongs to.
   */
  export async function userOf(c: Context<AppEnv>) {
    const tokens = tokensOf(c);
    if (tokens.length === 0) return null;
    const keys = (await stored()).keys;
    for (const token of tokens) {
      const key = keys.find((k) => k.token === token);
      const user = key ? await User.findByPk(key.userId) : await User.fromToken(token);
      if (user) return user;
    }
    return null;
  }

  /**
   * Route middleware like `User.$middleware()`, reading the token the way these apps send it.
   * @param opts.admin Only allow admins, as the apps expect for server-wide calls.
   */
  export function $middleware(opts?: { admin?: boolean }): MiddlewareHandler<AppEnv> {
    opts ??= {};
    return async (c, next) => {
      const user = await userOf(c);
      if (!user) return c.json({ message: "Sign in or use an app key from Cinemion's Settings › Integrations." }, 401);
      if (opts.admin && !user.isAdmin()) return c.json({ message: "Only admins can do this." }, 403);
      c.set("user", user);
      return next();
    };
  }

  //#endregion

  //#region Responses

  export async function serverInfo(serverName: string, setupDone: boolean) {
    return {
      Id: (await stored()).serverId,
      ServerName: serverName,
      ProductName: AppSystem.APP_NAME,
      Version: AppSystem.VERSION,
      OperatingSystem: "Linux",
      StartupWizardCompleted: setupDone,
    };
  }

  export async function userJson(user: User, serverName: string) {
    return {
      // Apps sign in again with this, so it's the username rather than the display name
      Name: user.username,
      Id: encodeId("user", user.id),
      ServerId: (await stored()).serverId,
      ServerName: serverName,
      HasPassword: user.password !== null,
      HasConfiguredPassword: user.password !== null,
      ...(user.avatar ? { PrimaryImageTag: user.avatar } : {}),
      Configuration: { GroupedFolders: [] },
      Policy: { IsAdministrator: user.isAdmin(), IsDisabled: false, EnableAllFolders: user.libraryAccess === null },
    };
  }

  const COLLECTION_TYPES: Record<LibraryType, string> = {
    movies: "movies",
    shows: "tvshows",
    videos: "homevideos",
    music: "music",
    audiobooks: "books",
    books: "books",
    photos: "homevideos",
  };

  export function libraryJson(library: Library, serverId: string) {
    return {
      Name: library.name,
      Id: encodeId("library", library.id),
      ServerId: serverId,
      Type: "CollectionFolder",
      CollectionType: COLLECTION_TYPES[library.type],
      IsFolder: true,
    };
  }

  const ITEM_TYPES: Record<ItemType, string> = {
    movie: "Movie",
    show: "Series",
    season: "Season",
    episode: "Episode",
    video: "Video",
    folder: "Folder",
    artist: "MusicArtist",
    album: "MusicAlbum",
    track: "Audio",
    audiobook: "AudioBook",
    book: "Book",
    photo: "Photo",
  };

  /**
   * Cinemion item types for the apps' `IncludeItemTypes` names. Unknown names are left out.
   */
  export function itemTypesFor(names: string[]) {
    const types: ItemType[] = [];
    for (const name of names) {
      const type = (Object.keys(ITEM_TYPES) as ItemType[]).find((t) => ITEM_TYPES[t].toLowerCase() === name.toLowerCase());
      if (type) types.push(type);
    }
    return types;
  }

  /**
   * What `itemJson()` needs besides the item: its season and show, and its files when `MediaSources` was asked for.
   */
  export interface ItemContext {
    serverId: string;
    parents: Map<number, MediaItem>;
    files: Map<number, MediaFile[]> | null;
  }

  export function itemJson(item: MediaItem, ctx: ItemContext) {
    const parent = item.parentId ? ctx.parents.get(item.parentId) : undefined;
    const season = item.type === "episode" ? parent : undefined;
    const show = item.type === "season" ? parent : season?.parentId ? ctx.parents.get(season.parentId) : undefined;
    const files = ctx.files?.get(item.id) ?? [];
    const main = files[0];
    const ids = item.externalIds ?? {};
    const duration = main?.duration ?? (item.runtime ? item.runtime * 60 : null);

    return {
      Name: item.title,
      Id: encodeId("item", item.id),
      ServerId: ctx.serverId,
      Type: ITEM_TYPES[item.type],
      MediaType: ["movie", "episode", "video"].includes(item.type) ? "Video" : item.type === "track" || item.type === "audiobook" ? "Audio" : "Unknown",
      IsFolder: ["show", "season", "folder", "artist", "album"].includes(item.type),
      LocationType: "FileSystem",
      Overview: item.overview ?? undefined,
      ProductionYear: item.year ?? undefined,
      PremiereDate: item.releaseDate ?? undefined,
      DateCreated: item.addedAt.toISOString(),
      ParentId: parent ? encodeId("item", parent.id) : encodeId("library", item.libraryId),
      ProviderIds: {
        ...(ids.tmdb ? { Tmdb: ids.tmdb } : {}),
        ...(ids.imdb ? { Imdb: ids.imdb } : {}),
        ...(ids.tvdb ? { Tvdb: ids.tvdb } : {}),
      },
      ...(duration ? { RunTimeTicks: Math.round(duration * TICKS_PER_SECOND) } : {}),
      // Episodes and seasons
      ...(item.type === "season" ? { IndexNumber: item.seasonNumber ?? undefined } : {}),
      ...(item.type === "episode" ? {
        IndexNumber: item.episodeNumber ?? undefined,
        IndexNumberEnd: item.episodeEnd ?? undefined,
        ParentIndexNumber: item.seasonNumber ?? season?.seasonNumber ?? undefined,
        SeasonId: season ? encodeId("item", season.id) : undefined,
        SeasonName: season?.title,
      } : {}),
      ...(show ? { SeriesId: encodeId("item", show.id), SeriesName: show.title } : {}),
      // Files
      HasSubtitles: files.some((f) => f.subtitles.length > 0 || f.sidecars.length > 0),
      ...(main?.width ? { Width: main.width, Height: main.height ?? undefined, IsHD: main.width >= 1200 } : {}),
      ...(ctx.files ? { MediaSources: files.map((f) => mediaSource(f)) } : {}),
    };
  }

  function mediaSource(file: MediaFile) {
    return {
      Id: encodeId("file", file.id),
      Protocol: "File",
      Type: "Default",
      VideoType: "VideoFile",
      Path: file.path,
      Container: file.container ?? undefined,
      Size: file.size,
      MediaStreams: [
        ...(file.videoCodec ? [{ Type: "Video", Codec: file.videoCodec, Width: file.width ?? undefined, Height: file.height ?? undefined, DisplayTitle: file.videoCodec }] : []),
        ...file.audio.map((a) => ({ Type: "Audio", Codec: a.codec, Language: a.language ?? undefined, DisplayTitle: a.title ?? a.codec })),
        ...file.subtitles.map((s) => ({ Type: "Subtitle", Codec: s.codec, Language: s.language ?? undefined, DisplayTitle: s.title ?? s.codec })),
      ],
    };
  }

  //#endregion

  function randomHex(bytes = 16) {
    return encodeHex(crypto.getRandomValues(new Uint8Array(bytes)));
  }
}

export default CompatApi;
