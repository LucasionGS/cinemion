import { Op } from "sequelize";
import type { ExternalIds } from "@shared/media.ts";
import type { SaveTraktAppRequest, TraktAppSettings, TraktImportResult, TraktLinkPoll, TraktLinkStart } from "@shared/trakt.ts";
import { MediaItem, Setting, User, WatchState } from "../models/index.ts";
import ItemLabels from "../library/ItemLabels.ts";
import Visibility from "../library/Visibility.ts";
import log from "../lib/Logger.ts";

const API = Deno.env.get("TRAKT_API_URL") || "https://api.trakt.tv";
// Device sign-in has no page to return to; Trakt calls this the out-of-band redirect
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

/**
 * Trakt: each profile can link its own Trakt account. Playback is scrobbled (Trakt marks something watched once
 * 80% has played), marking watched or unwatched by hand is sent to the profile's history, and the history can be
 * brought in once. The server needs a Trakt app, made by an admin at trakt.tv/oauth/applications.
 */
export namespace Trakt {
  interface StoredApp {
    clientId: string | null;
    clientSecret: string | null;
  }

  interface PendingLink {
    deviceCode: string;
    expiresAt: number;
  }

  type Ids = { tmdb?: number; imdb?: string; tvdb?: number };
  type Target = { movie: { ids: Ids; title: string; year: number | null } } | { show: { ids: Ids; title: string; year: number | null }; episode: { season: number; number: number } };

  const _pending = new Map<number, PendingLink>();

  async function app(): Promise<StoredApp> {
    const stored = await Setting.get<Partial<StoredApp> | null>(Setting.Keys.TRAKT, null);
    return {
      clientId: stored?.clientId || Deno.env.get("TRAKT_CLIENT_ID") || null,
      clientSecret: stored?.clientSecret || Deno.env.get("TRAKT_CLIENT_SECRET") || null,
    };
  }

  export async function isAvailable() {
    const { clientId, clientSecret } = await app();
    return !!clientId && !!clientSecret;
  }

  export async function appSettings(): Promise<TraktAppSettings> {
    const { clientId, clientSecret } = await app();
    return { clientId, hasSecret: !!clientSecret };
  }

  export async function saveApp(data: SaveTraktAppRequest) {
    const stored = await Setting.get<Partial<StoredApp> | null>(Setting.Keys.TRAKT, null);
    const next: StoredApp = {
      clientId: data.clientId !== undefined ? data.clientId?.trim() || null : stored?.clientId ?? null,
      clientSecret: data.clientSecret !== undefined ? data.clientSecret?.trim() || null : stored?.clientSecret ?? null,
    };
    await Setting.set(Setting.Keys.TRAKT, next);
    return await appSettings();
  }

  /**
   * Call the Trakt API.
   * @throws When Trakt isn't set up or answers with an error.
   */
  async function request<T>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<{ status: number; data: T | null }> {
    const { clientId } = await app();
    if (!clientId) throw new Error("Trakt isn't set up on this server. An admin can add it in Settings › Integrations.");
    const headers: Record<string, string> = { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": clientId };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await fetch(API + path, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    let data: T | null = null;
    try {
      data = text ? JSON.parse(text) as T : null;
    } catch {
      // An error page instead of JSON; the status says enough
    }
    return { status: res.status, data };
  }

  //#region Linking

  /**
   * Start linking `user`: Trakt hands out a code to enter on its site.
   * @throws When Trakt isn't set up or can't be reached.
   */
  export async function startLink(user: User): Promise<TraktLinkStart> {
    const { clientId } = await app();
    const { status, data } = await request<{ device_code: string; user_code: string; verification_url: string; expires_in: number; interval: number }>("/oauth/device/code", { method: "POST", body: { client_id: clientId } });
    if (status !== 200 || !data) throw new Error(`Trakt didn't start the sign-in (${status}). Check the app's client ID in Settings › Integrations.`);
    _pending.set(user.id, { deviceCode: data.device_code, expiresAt: Date.now() + data.expires_in * 1000 });
    return { userCode: data.user_code, verificationUrl: data.verification_url, expiresIn: data.expires_in, interval: data.interval };
  }

  /**
   * Ask Trakt whether `user` entered the code yet. Once they did, the account is linked.
   */
  export async function pollLink(user: User): Promise<TraktLinkPoll> {
    const pending = _pending.get(user.id);
    if (!pending || pending.expiresAt < Date.now()) {
      _pending.delete(user.id);
      return { status: "expired", username: null };
    }
    const { clientId, clientSecret } = await app();
    const { status, data } = await request<{ access_token: string; refresh_token: string; expires_in: number }>("/oauth/device/token", { method: "POST", body: { code: pending.deviceCode, client_id: clientId, client_secret: clientSecret } });
    // 400 = not entered yet, 429 = asking too often; both mean keep waiting
    if (status === 400 || status === 429) return { status: "pending", username: null };
    _pending.delete(user.id);
    if (status === 418) return { status: "denied", username: null };
    if (status !== 200 || !data) return { status: "expired", username: null };

    const settings = await request<{ user?: { username?: string } }>("/users/settings", { token: data.access_token }).catch(() => null);
    user.trakt = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      username: settings?.data?.user?.username ?? null,
    };
    await user.save();
    log.info("Linked a Trakt account", { user: user.name, trakt: user.trakt.username });
    return { status: "linked", username: user.trakt.username };
  }

  /**
   * Forget `user`'s Trakt account, and tell Trakt to drop the token.
   */
  export async function unlink(user: User) {
    const link = user.trakt;
    user.trakt = null;
    await user.save();
    if (!link) return;
    const { clientId, clientSecret } = await app();
    await request("/oauth/revoke", { method: "POST", body: { token: link.accessToken, client_id: clientId, client_secret: clientSecret } }).catch(() => { });
  }

  /**
   * A working access token for `user`, refreshing it when it's about to run out. `null` when not linked, or the
   * link stopped working (it's forgotten then, so the profile can link again).
   */
  async function token(user: User) {
    const link = user.trakt;
    if (!link) return null;
    if (link.expiresAt - Date.now() > 24 * 60 * 60 * 1000) return link.accessToken;
    const { clientId, clientSecret } = await app();
    const { status, data } = await request<{ access_token: string; refresh_token: string; expires_in: number }>("/oauth/token", {
      method: "POST",
      body: { refresh_token: link.refreshToken, client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT_URI, grant_type: "refresh_token" },
    });
    if (status !== 200 || !data) {
      log.warn("A Trakt link stopped working; the profile has to link it again", { user: user.name, status });
      user.trakt = null;
      await user.save();
      return null;
    }
    user.trakt = { ...link, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
    await user.save();
    return user.trakt.accessToken;
  }

  //#endregion

  //#region Scrobbling and history

  function ids(external: ExternalIds): Ids {
    const result: Ids = {};
    if (external.tmdb && Number(external.tmdb)) result.tmdb = Number(external.tmdb);
    if (external.tvdb && Number(external.tvdb)) result.tvdb = Number(external.tvdb);
    if (external.imdb) result.imdb = external.imdb;
    return result;
  }

  /**
   * What `item` is to Trakt: a movie, or an episode of a show. `null` for things Trakt doesn't know (videos, music)
   * or titles without ids from TMDB, TheTVDB or IMDb.
   */
  async function target(item: MediaItem): Promise<Target | null> {
    if (item.type === "movie") {
      const movieIds = ids(item.externalIds);
      return Object.keys(movieIds).length ? { movie: { ids: movieIds, title: item.title, year: item.year } } : null;
    }
    if (item.type !== "episode" || item.seasonNumber === null || item.episodeNumber === null) return null;
    const show = await ItemLabels.showOf(item);
    const showIds = show ? ids(show.externalIds) : {};
    if (!show || !Object.keys(showIds).length) return null;
    return { show: { ids: showIds, title: show.title, year: show.year }, episode: { season: item.seasonNumber, number: item.episodeNumber } };
  }

  /**
   * Tell Trakt about playback. Runs in the background; problems are only logged.
   * @param position Unit is in seconds.
   * @param duration Unit is in seconds.
   */
  export function scrobble(action: "start" | "pause" | "stop", userId: number, itemId: number, position: number, duration: number) {
    (async () => {
      const user = await User.findByPk(userId);
      if (!user?.trakt) return;
      const item = await MediaItem.findByPk(itemId);
      const what = item ? await target(item) : null;
      const access = what ? await token(user) : null;
      if (!what || !access) return;
      const progress = duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0;
      const { status } = await request(`/scrobble/${action}`, { method: "POST", token: access, body: { ...what, progress: Math.round(progress * 100) / 100 } });
      // 409 = the same scrobble just happened, which is fine
      if (status >= 400 && status !== 409) log.warn("Trakt didn't take a scrobble", { user: user.name, item: item!.title, action, status });
    })().catch((error) => log.warn("Could not scrobble to Trakt", { error }));
  }

  /**
   * Add movies and episodes to `user`'s Trakt history, or take them out. Runs in the background.
   */
  export function syncHistory(user: User, itemIds: number[], watched: boolean) {
    if (!user.trakt || itemIds.length === 0) return;
    (async () => {
      const movies: { ids: Ids }[] = [];
      const shows = new Map<string, { ids: Ids; seasons: Map<number, number[]> }>();
      for (const item of await MediaItem.findAll({ where: { id: itemIds } })) {
        const what = await target(item);
        if (!what) continue;
        if ("movie" in what) {
          movies.push({ ids: what.movie.ids });
          continue;
        }
        const key = JSON.stringify(what.show.ids);
        const show = shows.get(key) ?? { ids: what.show.ids, seasons: new Map() };
        show.seasons.set(what.episode.season, [...show.seasons.get(what.episode.season) ?? [], what.episode.number]);
        shows.set(key, show);
      }
      if (movies.length === 0 && shows.size === 0) return;
      const access = await token(user);
      if (!access) return;
      const watchedAt = new Date().toISOString();
      const body = {
        movies: movies.map((m) => watched ? { ...m, watched_at: watchedAt } : m),
        shows: [...shows.values()].map((s) => ({
          ids: s.ids,
          seasons: [...s.seasons].map(([number, episodes]) => ({ number, episodes: episodes.map((e) => watched ? { number: e, watched_at: watchedAt } : { number: e }) })),
        })),
      };
      const { status } = await request(watched ? "/sync/history" : "/sync/history/remove", { method: "POST", token: access, body });
      if (status >= 400) log.warn("Trakt didn't take a history change", { user: user.name, status });
    })().catch((error) => log.warn("Could not update the Trakt history", { error }));
  }

  /**
   * Mark everything `user` watched on Trakt as watched here too, for titles in libraries the profile can see.
   * Nothing is sent back to Trakt.
   * @throws When the profile isn't linked or Trakt can't be reached.
   */
  export async function importHistory(user: User): Promise<TraktImportResult> {
    const access = await token(user);
    if (!access) throw new Error("This profile isn't linked to Trakt. Link it first.");
    const [moviesRes, showsRes] = await Promise.all([
      request<{ movie: { ids: Ids } }[]>("/sync/watched/movies", { token: access }),
      request<{ show: { ids: Ids }; seasons: { number: number; episodes: { number: number }[] }[] }[]>("/sync/watched/shows", { token: access }),
    ]);
    if (moviesRes.status !== 200 || showsRes.status !== 200) throw new Error(`Trakt didn't send the history (${moviesRes.status === 200 ? showsRes.status : moviesRes.status}). Try again later.`);

    const visible = Visibility.where(user);
    const keysOf = (external: ExternalIds) => [external.tmdb && `tmdb:${external.tmdb}`, external.tvdb && `tvdb:${external.tvdb}`, external.imdb && `imdb:${external.imdb}`].filter((k): k is string => !!k);
    const traktKeys = (i: Ids) => [i.tmdb && `tmdb:${i.tmdb}`, i.tvdb && `tvdb:${i.tvdb}`, i.imdb && `imdb:${i.imdb}`].filter((k): k is string => !!k);

    // Movies
    const movieByKey = new Map<string, MediaItem>();
    for (const movie of await MediaItem.findAll({ where: { [Op.and]: [visible, { type: "movie" }] }, attributes: ["id", "externalIds"] })) {
      for (const key of keysOf(movie.externalIds)) movieByKey.set(key, movie);
    }
    const movieIds = new Set<number>();
    for (const entry of moviesRes.data ?? []) {
      const found = traktKeys(entry.movie.ids).map((k) => movieByKey.get(k)).find(Boolean);
      if (found) movieIds.add(found.id);
    }

    // Episodes, through their shows
    const showByKey = new Map<string, MediaItem>();
    for (const show of await MediaItem.findAll({ where: { [Op.and]: [visible, { type: "show" }] }, attributes: ["id", "externalIds"] })) {
      for (const key of keysOf(show.externalIds)) showByKey.set(key, show);
    }
    const episodeIds = new Set<number>();
    for (const entry of showsRes.data ?? []) {
      const show = traktKeys(entry.show.ids).map((k) => showByKey.get(k)).find(Boolean);
      if (!show) continue;
      const seasons = await MediaItem.findAll({ where: { parentId: show.id, type: "season" }, attributes: ["id", "seasonNumber"] });
      const episodes = seasons.length ? await MediaItem.findAll({ where: { parentId: seasons.map((s) => s.id), type: "episode" }, attributes: ["id", "seasonNumber", "episodeNumber"] }) : [];
      const byNumber = new Map(episodes.map((e) => [`${e.seasonNumber}:${e.episodeNumber}`, e.id]));
      for (const season of entry.seasons) {
        for (const episode of season.episodes) {
          const id = byNumber.get(`${season.number}:${episode.number}`);
          if (id) episodeIds.add(id);
        }
      }
    }

    // Only what isn't marked watched yet, so play counts don't grow on every import
    const all = [...movieIds, ...episodeIds];
    const already = new Set((await WatchState.findAll({ where: { userId: user.id, itemId: all, watched: true }, attributes: ["itemId"] })).map((s) => s.itemId));
    const fresh = all.filter((id) => !already.has(id));
    await WatchState.markWatched(user.id, fresh, true);
    const result = { movies: fresh.filter((id) => movieIds.has(id)).length, episodes: fresh.filter((id) => episodeIds.has(id)).length };
    log.info("Imported a Trakt history", { user: user.name, ...result });
    return result;
  }

  //#endregion
}

export default Trakt;
