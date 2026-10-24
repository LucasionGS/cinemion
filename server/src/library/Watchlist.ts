import { Op } from "sequelize";
import type { ExternalIds } from "@shared/media.ts";
import type { WatchlistEntry, WatchlistOverview } from "@shared/watchlist.ts";
import { MediaItem, User, WatchlistItem } from "../models/index.ts";
import Trakt from "../integrations/Trakt.ts";
import Summaries from "./Summaries.ts";
import Visibility from "./Visibility.ts";
import { errorMessage } from "../lib/http.ts";
import log from "../lib/Logger.ts";

/**
 * Each profile's "My list": titles they want to watch. With Trakt linked, the list and the Trakt watchlist are kept
 * in step both ways, and titles added on Trakt that aren't in a library yet wait on the list until a scan brings
 * them in.
 */
export namespace Watchlist {
  /**
   * Told when a title on someone's list that wasn't here arrives in a library.
   */
  export type ArrivalListener = (entry: WatchlistItem, item: MediaItem) => void;

  const SYNC_TIMER_MS = 15 * 60 * 1000;
  /**
   * Fetched again even when Trakt says nothing changed, in case a change was missed.
   */
  const FULL_SYNC_MS = 6 * 60 * 60 * 1000;
  const _listeners: ArrivalListener[] = [];
  const _syncing = new Map<number, Promise<void>>();
  let _timer: ReturnType<typeof setInterval> | null = null;

  export function onArrived(listener: ArrivalListener) {
    _listeners.push(listener);
  }

  /**
   * Keys a title can be matched by. TMDB numbers movies and shows separately, so the kind is part of the key.
   */
  function keysOf(kind: string, ids: ExternalIds) {
    const type = kind === "movie" ? "movie" : "show";
    return [ids.tmdb && `${type}:tmdb:${ids.tmdb}`, ids.tvdb && `${type}:tvdb:${ids.tvdb}`, ids.imdb && `imdb:${ids.imdb}`].filter((k): k is string => !!k);
  }

  /**
   * Movies and shows in the libraries, by their keys.
   */
  async function libraryIndex() {
    const index = new Map<string, MediaItem>();
    for (const item of await MediaItem.findAll({ where: { type: ["movie", "show"] }, attributes: ["id", "type", "externalIds"] })) {
      for (const key of keysOf(item.type, item.externalIds)) if (!index.has(key)) index.set(key, item);
    }
    return index;
  }

  /**
   * Link entries without an item to titles in the libraries with the same ids.
   * @returns The entries that were linked.
   */
  async function link(entries: WatchlistItem[], index?: Map<string, MediaItem>) {
    const waiting = entries.filter((e) => e.itemId === null && e.kind !== "video");
    if (waiting.length === 0) return [];
    index ??= await libraryIndex();
    const linked: WatchlistItem[] = [];
    for (const entry of waiting) {
      const found = keysOf(entry.kind, entry.externalIds).map((k) => index!.get(k)).find(Boolean);
      if (!found) continue;
      entry.itemId = found.id;
      entry.arrivedAt = new Date();
      await entry.save();
      linked.push(entry);
    }
    return linked;
  }

  /**
   * After a scan: link waiting entries to new movies and shows, and tell the listeners about them.
   */
  export async function arrived(items: MediaItem[]) {
    const titles = items.filter((i) => i.type === "movie" || i.type === "show");
    if (titles.length === 0) return;
    const waiting = await WatchlistItem.findAll({ where: { itemId: null, kind: ["movie", "show"] } });
    if (waiting.length === 0) return;
    const index = new Map<string, MediaItem>();
    for (const item of titles) for (const key of keysOf(item.type, item.externalIds)) index.set(key, item);
    for (const entry of await link(waiting, index)) {
      const item = titles.find((t) => t.id === entry.itemId)!;
      log.info("A title on someone's list arrived", { title: item.title, userId: entry.userId });
      for (const listener of _listeners) {
        try {
          listener(entry, item);
        } catch (error) {
          log.warn("A watchlist listener failed", { error });
        }
      }
    }
  }

  export async function contains(userId: number, itemId: number) {
    return await WatchlistItem.count({ where: { userId, itemId } }) > 0;
  }

  /**
   * Put a title on `user`'s list (and their Trakt watchlist).
   * @throws When the title can't go on a list.
   */
  export async function add(user: User, item: MediaItem) {
    if (!WatchlistItem.isKind(item.type)) throw new Error("Only movies, shows and videos can go on your list.");
    const existing = await WatchlistItem.findOne({ where: { userId: user.id, itemId: item.id } });
    if (existing) return existing;
    const entry = await WatchlistItem.create({ userId: user.id, itemId: item.id, kind: item.type, title: item.title, year: item.year, externalIds: item.externalIds });
    if (user.trakt && entry.kind !== "video") {
      Trakt.changeWatchlist(user, [{ kind: entry.kind, ids: entry.externalIds }], true)
        .then(async (ok) => {
          if (ok) await entry.update({ onTrakt: true });
        })
        .catch((error) => log.warn("Could not add to the Trakt watchlist", { error }));
    }
    return entry;
  }

  /**
   * Take a title off `user`'s list (and their Trakt watchlist), by the entry's id or the item's.
   */
  export async function remove(user: User, by: { entryId?: number; itemId?: number }) {
    const where = by.entryId !== undefined ? { id: by.entryId, userId: user.id } : { itemId: by.itemId!, userId: user.id };
    const entries = await WatchlistItem.findAll({ where });
    for (const entry of entries) {
      await entry.destroy();
      if (user.trakt && entry.onTrakt && entry.kind !== "video") {
        Trakt.changeWatchlist(user, [{ kind: entry.kind, ids: entry.externalIds }], false).catch((error) => log.warn("Could not take a title off the Trakt watchlist", { error }));
      }
    }
    return entries.length > 0;
  }

  function linkFor(entry: WatchlistItem) {
    const ids = entry.externalIds;
    if (ids.tmdb) return `https://www.themoviedb.org/${entry.kind === "movie" ? "movie" : "tv"}/${ids.tmdb}`;
    if (ids.imdb) return `https://www.imdb.com/title/${ids.imdb}/`;
    if (ids.tvdb) return `https://thetvdb.com/dereferrer/series/${ids.tvdb}`;
    return null;
  }

  /**
   * `user`'s list, newest first, with the titles that are here linked up.
   */
  export async function overview(user: User): Promise<WatchlistOverview> {
    const entries = await WatchlistItem.findAll({ where: { userId: user.id }, order: [["createdAt", "DESC"], ["id", "DESC"]] });
    await link(entries);
    const ids = entries.map((e) => e.itemId).filter((id): id is number => id !== null);
    const items = ids.length ? await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { id: ids }] } }) : [];
    const summaries = new Map((await Summaries.build(items, user)).map((s) => [s.id, s]));
    const result: WatchlistEntry[] = entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      year: entry.year,
      addedAt: entry.createdAt.toISOString(),
      item: entry.itemId !== null ? summaries.get(entry.itemId) ?? null : null,
      arrivedAt: entry.arrivedAt?.toISOString() ?? null,
      link: linkFor(entry),
    }));
    const traktLink = user.trakt;
    return {
      entries: result,
      trakt: {
        linked: !!traktLink,
        syncedAt: traktLink?.watchlistSyncedAt ? new Date(traktLink.watchlistSyncedAt).toISOString() : null,
        error: traktLink?.watchlistError ?? null,
      },
    };
  }

  /**
   * What the home screen's "My list" row shows: titles that are here and not watched yet, newest first.
   */
  export async function forHome(user: User, limit: number) {
    const entries = await WatchlistItem.findAll({ where: { userId: user.id, itemId: { [Op.ne]: null } }, order: [["createdAt", "DESC"]], limit: limit * 3 });
    const items = entries.length ? await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { id: entries.map((e) => e.itemId!) }] } }) : [];
    const byId = new Map(items.map((i) => [i.id, i]));
    const ordered = entries.map((e) => byId.get(e.itemId!)).filter((i): i is MediaItem => !!i);
    const summaries = await Summaries.build(ordered, user);
    return summaries.filter((s) => !s.userData?.watched).slice(0, limit);
  }

  //#region Trakt

  /**
   * Bring `user`'s list in step with their Trakt watchlist: titles added on Trakt come in, titles taken off there go,
   * and titles added here while Trakt couldn't be reached go up. Only one sync runs per profile at a time.
   * @param force Fetch the watchlist even when Trakt says it didn't change.
   */
  export function sync(user: User, force = false): Promise<void> {
    const running = _syncing.get(user.id);
    if (running) return running;
    const job = runSync(user, force).finally(() => _syncing.delete(user.id));
    _syncing.set(user.id, job);
    return job;
  }

  async function runSync(user: User, force: boolean) {
    if (!user.trakt) return;
    const entries = await WatchlistItem.findAll({ where: { userId: user.id } });
    const unsent = entries.filter((e) => !e.onTrakt && e.kind !== "video" && keysOf(e.kind, e.externalIds).length > 0);
    try {
      const change = await Trakt.watchlistChangedAt(user);
      const last = user.trakt?.watchlistSyncedAt ?? 0;
      const unchanged = change !== null && change === user.trakt?.watchlistChange && Date.now() - last < FULL_SYNC_MS;
      if (!force && unchanged && unsent.length === 0) return;

      const remote = await Trakt.watchlist(user);
      const byKey = new Map<string, WatchlistItem>();
      for (const entry of entries) for (const key of keysOf(entry.kind, entry.externalIds)) byKey.set(key, entry);
      const seen = new Set<number>();
      const created: WatchlistItem[] = [];
      for (const title of remote) {
        const entry = keysOf(title.kind, title.ids).map((k) => byKey.get(k)).find((e) => e && !seen.has(e.id));
        if (entry) {
          seen.add(entry.id);
          if (!entry.onTrakt) await entry.update({ onTrakt: true });
          continue;
        }
        const added = await WatchlistItem.create({ userId: user.id, itemId: null, kind: title.kind, title: title.title.slice(0, 512), year: title.year, externalIds: title.ids, onTrakt: true });
        for (const key of keysOf(added.kind, added.externalIds)) byKey.set(key, added);
        seen.add(added.id);
        created.push(added);
      }
      // A title that was on both lists and isn't on Trakt's any more was taken off there
      for (const entry of entries) {
        if (!seen.has(entry.id) && entry.onTrakt) await entry.destroy();
      }
      const toSend = unsent.filter((e) => !seen.has(e.id));
      if (toSend.length && await Trakt.changeWatchlist(user, toSend.map((e) => ({ kind: e.kind as "movie" | "show", ids: e.externalIds })), true)) {
        for (const entry of toSend) await entry.update({ onTrakt: true });
      }
      // Titles that came from Trakt and are already here link up straight away, without counting as arrivals
      if (created.length) {
        await link(created);
        for (const entry of created) if (entry.itemId !== null) await entry.update({ arrivedAt: null });
      }

      const fresh = await User.findByPk(user.id);
      if (fresh?.trakt) {
        fresh.trakt = { ...fresh.trakt, watchlistSyncedAt: Date.now(), watchlistChange: change, watchlistError: null };
        await fresh.save();
        user.trakt = fresh.trakt;
      }
      if (created.length || toSend.length) log.info("Synced a watchlist with Trakt", { user: user.name, cameIn: created.length, wentUp: toSend.length });
    } catch (error) {
      const fresh = await User.findByPk(user.id);
      if (fresh?.trakt) {
        fresh.trakt = { ...fresh.trakt, watchlistError: errorMessage(error) };
        await fresh.save();
        user.trakt = fresh.trakt;
      }
      log.warn("Could not sync a watchlist with Trakt", { user: user.name, error: errorMessage(error) });
    }
  }

  /**
   * Sync every linked profile's list now and then.
   */
  export function start() {
    _timer = setInterval(() => syncAll(), SYNC_TIMER_MS);
  }

  export function stop() {
    if (_timer !== null) clearInterval(_timer);
    _timer = null;
  }

  async function syncAll() {
    if (!(await Trakt.isAvailable())) return;
    for (const user of await User.findAll({ where: { trakt: { [Op.ne]: null } } })) await sync(user);
  }

  //#endregion
}

export default Watchlist;
