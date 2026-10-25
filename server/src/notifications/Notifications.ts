import { Op } from "sequelize";
import { encodeHex } from "@std/encoding/hex";
import type { NotificationData, NotificationSetup, NotificationsList, NotifyMode } from "@shared/notifications.ts";
import { normalizePreferences } from "@shared/profiles.ts";
import AppSystem from "../AppSystem.ts";
import { type Library, MediaItem, Notification, PushSubscription, Setting, User, WatchlistItem, WatchState } from "../models/index.ts";
import Visibility from "../library/Visibility.ts";
import WebPush from "./WebPush.ts";
import Mailer from "./Mailer.ts";
import Translations from "../lib/Translations.ts";
import { errorMessage } from "../lib/http.ts";
import log from "../lib/Logger.ts";

/**
 * "New in your library": each profile hears about new titles in the libraries it can see, within its age limit, as
 * much as it asked for (everything, shows it watches and titles on its list, or nothing), in the bell in the top bar,
 * as push notifications on its devices and by email.
 */
export namespace Notifications {
  /**
   * New episodes join an unread notification about the same show from within this long.
   */
  const JOIN_HOURS = 24;
  /**
   * Who push services can contact about this server's messages.
   */
  const PUSH_SUBJECT = "https://github.com/LucasionGS/cinemion";

  /**
   * One thing to tell people about, before it's worked out who.
   */
  interface Candidate {
    groupKey: string;
    /**
     * What opening the notification shows.
     */
    itemId: number;
    /**
     * Items whose visibility decides who hears about it (the episodes of a batch, or the title itself).
     */
    visible: MediaItem[];
    data: NotificationData;
    image: string | null;
    /**
     * For episodes: the show, so "following" can be worked out.
     */
    show?: MediaItem;
  }

  function modeFor(user: User, libraryId: number): NotifyMode {
    const prefs = normalizePreferences(user.preferences).notifications;
    return prefs.libraries[String(libraryId)] ?? prefs.mode;
  }

  async function episodeIdsOf(show: MediaItem) {
    const seasons = await MediaItem.findAll({ where: { parentId: show.id, type: "season" }, attributes: ["id"] });
    if (seasons.length === 0) return [];
    return (await MediaItem.findAll({ where: { parentId: seasons.map((s) => s.id), type: "episode" }, attributes: ["id"] })).map((e) => e.id);
  }

  /**
   * Whether `user` watches `show` (started or finished an episode before) or has it on their list.
   */
  async function follows(user: User, show: MediaItem, episodeIds: number[], newIds: Set<number>) {
    if (await WatchlistItem.count({ where: { userId: user.id, itemId: show.id } }) > 0) return true;
    const earlier = episodeIds.filter((id) => !newIds.has(id));
    if (earlier.length === 0) return false;
    return await WatchState.count({ where: { userId: user.id, itemId: earlier, [Op.or]: [{ watched: true }, { position: { [Op.gt]: 0 } }] } }) > 0;
  }

  /**
   * What a scan added, as things to tell people about: one per movie, album or book, and one per show for its new
   * episodes. Photos, clips and home videos are left out; they come in hundreds at a time.
   */
  async function candidates(library: Library, items: MediaItem[], shows: Map<number, MediaItem | null>): Promise<Candidate[]> {
    const result: Candidate[] = [];
    if (library.type === "movies") {
      for (const movie of items.filter((i) => i.type === "movie")) {
        result.push({ groupKey: `item:${movie.id}`, itemId: movie.id, visible: [movie], data: { kind: "movie", title: movie.title, libraryName: library.name }, image: movie.artwork.poster });
      }
    }
    else if (library.type === "shows") {
      const byShow = new Map<number, { show: MediaItem; episodes: MediaItem[] }>();
      for (const episode of items.filter((i) => i.type === "episode")) {
        const show = shows.get(episode.id);
        if (!show) continue;
        const entry = byShow.get(show.id) ?? { show, episodes: [] };
        entry.episodes.push(episode);
        byShow.set(show.id, entry);
      }
      for (const { show, episodes } of byShow.values()) {
        const one = episodes.length === 1 ? episodes[0] : null;
        result.push({
          groupKey: `show:${show.id}`,
          itemId: one?.id ?? show.id,
          visible: episodes,
          show,
          image: show.artwork.poster,
          data: { kind: "episodes", showTitle: show.title, count: episodes.length, season: one?.seasonNumber ?? null, episode: one?.episodeNumber ?? null, episodeTitle: one?.title ?? null },
        });
      }
    }
    else if (library.type === "music") {
      const albumIds = [...new Set(items.filter((i) => i.type === "track" && i.parentId).map((i) => i.parentId!))];
      for (const album of albumIds.length ? await MediaItem.findAll({ where: { id: albumIds, type: "album" } }) : []) {
        const artist = album.parentId ? await MediaItem.findByPk(album.parentId, { attributes: ["title"] }) : null;
        result.push({ groupKey: `item:${album.id}`, itemId: album.id, visible: [album], data: { kind: "album", title: album.title, artist: artist?.title ?? null, libraryName: library.name }, image: album.artwork.poster });
      }
    }
    else if (library.type === "audiobooks" || library.type === "books") {
      for (const book of items.filter((i) => i.type === "audiobook" || i.type === "book")) {
        result.push({ groupKey: `item:${book.id}`, itemId: book.id, visible: [book], data: { kind: book.type as "audiobook" | "book", title: book.title, libraryName: library.name }, image: book.artwork.poster });
      }
    }
    return result;
  }

  /**
   * After a scan: tell everyone who wants to know about what it added. The first scan of a library tells nobody.
   */
  export async function itemsAdded(library: Library, items: MediaItem[], shows: Map<number, MediaItem | null>) {
    const list = await candidates(library, items, shows);
    if (list.length === 0) return;
    const users = await User.findAll();
    const episodesOfShow = new Map<number, number[]>();
    const changed = new Map<number, Notification[]>();

    for (const candidate of list) {
      for (const user of users) {
        const mode = modeFor(user, library.id);
        if (mode === "none") continue;
        const visible = candidate.visible.filter((i) => Visibility.canSee(user, i));
        if (visible.length === 0) continue;
        if (mode === "following") {
          // Movies, albums and books only come through "My list" (see `watchlistArrived`)
          if (!candidate.show) continue;
          if (!episodesOfShow.has(candidate.show.id)) episodesOfShow.set(candidate.show.id, await episodeIdsOf(candidate.show));
          if (!(await follows(user, candidate.show, episodesOfShow.get(candidate.show.id)!, new Set(candidate.visible.map((i) => i.id))))) continue;
        }
        const notification = await upsert(user, candidate, visible);
        if (notification) changed.set(user.id, [...changed.get(user.id) ?? [], notification]);
      }
    }
    for (const [userId, notifications] of changed) {
      const user = users.find((u) => u.id === userId)!;
      deliver(user, notifications).catch((error) => log.warn("Could not send notifications", { error }));
    }
  }

  /**
   * Make the notification, or add the new episodes to an unread one about the same show.
   * @returns `null` when there's nothing new to say.
   */
  async function upsert(user: User, candidate: Candidate, visible: MediaItem[]): Promise<Notification | null> {
    const since = new Date(Date.now() - JOIN_HOURS * 60 * 60 * 1000);
    const existing = await Notification.findOne({ where: { userId: user.id, groupKey: candidate.groupKey }, order: [["updatedAt", "DESC"]] });
    if (candidate.data.kind !== "episodes") {
      // A title only arrives once; "My list" may have told about it already
      if (existing) return null;
      return await Notification.create({ userId: user.id, itemId: candidate.itemId, data: candidate.data, groupKey: candidate.groupKey, image: candidate.image });
    }
    // A show from the list that just arrived was already announced as a whole
    if (candidate.show && await Notification.count({ where: { userId: user.id, groupKey: `item:${candidate.show.id}`, createdAt: { [Op.gte]: new Date(Date.now() - 60 * 60 * 1000) } } }) > 0) return null;

    const one = visible.length === 1 ? visible[0] : null;
    const data: NotificationData = { ...candidate.data, count: visible.length, season: one?.seasonNumber ?? null, episode: one?.episodeNumber ?? null, episodeTitle: one?.title ?? null };
    const itemId = one?.id ?? candidate.show!.id;
    if (existing && existing.readAt === null && existing.updatedAt >= since && existing.data.kind === "episodes") {
      const count = existing.data.count + visible.length;
      existing.data = { ...data, count, season: null, episode: null, episodeTitle: null };
      existing.itemId = candidate.show!.id;
      existing.changed("updatedAt", true);
      await existing.save();
      return existing;
    }
    return await Notification.create({ userId: user.id, itemId, data, groupKey: candidate.groupKey, image: candidate.image });
  }

  /**
   * A title on someone's list arrived.
   */
  export async function watchlistArrived(userId: number, item: MediaItem) {
    const user = await User.findByPk(userId);
    if (!user || !Visibility.canSee(user, item) || modeFor(user, item.libraryId) === "none") return;
    const notification = await upsert(user, { groupKey: `item:${item.id}`, itemId: item.id, visible: [item], data: { kind: "watchlist", title: item.title }, image: item.artwork.poster }, [item]);
    if (notification) await deliver(user, [notification]);
  }

  //#region Sending

  /**
   * The words of a notification for push and email, in the profile's language. The bell words it on the client.
   */
  export function describe(data: NotificationData, language: string | null = null): { title: string; body: string } {
    const tr = (key: string, values?: Record<string, string | number>) => Translations.t(language, key, values);
    switch (data.kind) {
      case "episodes":
        if (data.count === 1 && data.season !== null && data.episode !== null) {
          const code = tr("notifications.episodeCode", { season: data.season, episode: data.episode });
          return { title: data.showTitle, body: data.episodeTitle ? tr("notifications.episodeWithTitle", { code, title: data.episodeTitle }) : tr("notifications.episode", { code }) };
        }
        return { title: data.showTitle, body: tr("notifications.episodes", { count: data.count }) };
      case "album":
        return { title: data.title, body: data.artist ? tr("notifications.albumBy", { artist: data.artist }) : tr("notifications.newIn", { library: data.libraryName }) };
      case "watchlist":
        return { title: data.title, body: tr("notifications.fromList") };
      default:
        return { title: data.title, body: tr("notifications.newIn", { library: data.libraryName }) };
    }
  }

  function baseUrl() {
    return AppSystem.config.SITE_URL.replace(/\/+$/, "");
  }

  async function deliver(user: User, notifications: Notification[]) {
    const subscriptions = await PushSubscription.findAll({ where: { userId: user.id } });
    const language = normalizePreferences(user.preferences).language;
    for (const notification of notifications) {
      const words = describe(notification.data, language);
      const message = {
        ...words,
        url: notification.itemId ? `/item/${notification.itemId}` : "/",
        tag: notification.groupKey ?? `n${notification.id}`,
        icon: notification.image ? `/api/images/${notification.image}?w=160` : null,
      };
      for (const subscription of subscriptions) {
        const result = await WebPush.send(subscription, message, { subject: PUSH_SUBJECT, topic: message.tag });
        if (result === "gone") {
          await subscription.destroy();
          log.info("Forgot a device that stopped taking push notifications", { user: user.name, device: subscription.device });
        }
      }
    }

    const email = normalizePreferences(user.preferences).notifications.email;
    if (email && await Mailer.isConfigured()) {
      const server = await Setting.get(Setting.Keys.SERVER_NAME, AppSystem.APP_NAME);
      const tr = (key: string, values?: Record<string, string | number>) => Translations.t(language, key, values);
      const lines = notifications.map((n) => describe(n.data, language));
      const link = baseUrl();
      const subject = lines.length === 1 ? tr("notifications.email.one", { title: lines[0].title, text: lines[0].body }) : tr("notifications.email.many", { count: lines.length, server });
      const text = [
        tr("notifications.email.greeting", { name: user.name }),
        "",
        ...lines.map((l) => tr("notifications.email.line", { title: l.title, text: l.body })),
        "",
        link ? tr("notifications.email.open", { server, link }) : tr("notifications.email.openPlain", { server }),
        "",
        tr("notifications.email.why"),
      ].join("\n");
      Mailer.send({ to: email, subject, text }).catch((error) => log.warn("Could not send a notification email", { user: user.name, error: errorMessage(error) }));
    }
  }

  //#endregion

  //#region The bell

  export async function list(user: User, limit = 30): Promise<NotificationsList> {
    const rows = await Notification.findAll({ where: { userId: user.id }, order: [["updatedAt", "DESC"], ["id", "DESC"]], limit });
    return { items: rows.map((r) => r.toInfo()), unread: await Notification.count({ where: { userId: user.id, readAt: null } }) };
  }

  /**
   * Mark some notifications read, or all of them when `ids` is left out.
   */
  export async function markRead(user: User, ids?: number[]) {
    await Notification.update({ readAt: new Date() }, { where: { userId: user.id, readAt: null, ...(ids ? { id: ids } : {}) } });
  }

  export async function prune() {
    await Notification.destroy({ where: { updatedAt: { [Op.lt]: new Date(Date.now() - Notification.KEEP_DAYS * 24 * 60 * 60 * 1000) } } });
  }

  //#endregion

  //#region Devices

  async function hash(endpoint: string) {
    return encodeHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  }

  /**
   * @param endpoint The asking browser's own push address, to mark it in the list.
   */
  export async function setup(user: User, endpoint?: string | null): Promise<NotificationSetup> {
    const mine = endpoint ? await hash(endpoint) : null;
    const devices = await PushSubscription.findAll({ where: { userId: user.id }, order: [["createdAt", "ASC"]] });
    return {
      pushKey: await WebPush.publicKey(),
      email: await Mailer.isConfigured(),
      devices: devices.map((d) => ({ id: d.id, name: d.device, createdAt: d.createdAt.toISOString(), current: d.endpointHash === mine })),
    };
  }

  /**
   * Start sending push notifications to a browser. A browser that was signed in as another profile moves over.
   * @throws When the subscription is incomplete.
   */
  export async function subscribe(user: User, subscription: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }, device: string) {
    const { endpoint, keys } = subscription;
    if (!endpoint || !/^https:\/\//.test(endpoint) || !keys?.p256dh || !keys.auth) throw new Error("The browser didn't hand over a complete push subscription.");
    const endpointHash = await hash(endpoint);
    const existing = await PushSubscription.findOne({ where: { endpointHash } });
    if (existing) await existing.update({ userId: user.id, p256dh: keys.p256dh, auth: keys.auth, device: device.slice(0, 128) });
    else await PushSubscription.create({ userId: user.id, endpoint, endpointHash, p256dh: keys.p256dh, auth: keys.auth, device: device.slice(0, 128) });
  }

  export async function unsubscribe(user: User, by: { id?: number; endpoint?: string }) {
    const where = by.id !== undefined ? { id: by.id, userId: user.id } : { endpointHash: await hash(by.endpoint ?? ""), userId: user.id };
    await PushSubscription.destroy({ where });
  }

  /**
   * Send a test notification to every device of `user`.
   * @returns How many devices took it.
   */
  export async function testPush(user: User) {
    let sent = 0;
    for (const subscription of await PushSubscription.findAll({ where: { userId: user.id } })) {
      const body = Translations.t(normalizePreferences(user.preferences).language, "notifications.testBody");
      const result = await WebPush.send(subscription, { title: "Cinemion", body, url: "/settings/profile", tag: "test", icon: null }, { subject: PUSH_SUBJECT, topic: "test" });
      if (result === "sent") sent++;
      if (result === "gone") await subscription.destroy();
    }
    return sent;
  }

  //#endregion
}

export default Notifications;
