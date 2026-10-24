import { Op } from "sequelize";
import type { ProfileStats, ServerStats, StatsBucket, StatsCounts, StatsPeriod, StatsTitle, TimeSplit, YearInReview } from "@shared/stats.ts";
import { normalizePreferences } from "@shared/profiles.ts";
import AppSystem from "../AppSystem.ts";
import { Library, MediaItem, PlaySession, Setting, User } from "../models/index.ts";

/**
 * Statistics from the play log: time per day or month, top titles, genres, binges and streaks, for one profile, the
 * whole server, or a year in review.
 */
export namespace Statistics {
  const TOP = 8;
  const WATCHING = ["movie", "episode", "video"];
  const LISTENING = ["track", "audiobook"];

  /**
   * The local calendar day of a moment: `2026-10-25`.
   */
  export function dayOf(date: Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  /**
   * The first moment a period covers, `null` for all time.
   */
  export function periodStart(period: StatsPeriod, now = new Date()): Date | null {
    const today = startOfDay(now);
    if (period === "week") return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    if (period === "month") return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
    if (period === "year") return new Date(today.getFullYear(), today.getMonth() - 11, 1);
    return null;
  }

  function empty(): TimeSplit {
    return { watching: 0, listening: 0, reading: 0 };
  }

  function addTo(split: TimeSplit, kind: string, seconds: number) {
    if (WATCHING.includes(kind)) split.watching += seconds;
    else if (LISTENING.includes(kind)) split.listening += seconds;
    else if (kind === "book") split.reading += seconds;
  }

  /**
   * Days (or months) from `from` to `to`, all of them, so a chart has its gaps.
   */
  function bucketKeys(from: Date, to: Date, bucket: "day" | "month") {
    const keys: string[] = [];
    if (bucket === "day") {
      for (let d = startOfDay(from); d <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) keys.push(dayOf(d));
    }
    else {
      for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) keys.push(dayOf(d).slice(0, 7));
    }
    return keys;
  }

  /**
   * Days in a row with anything played, ending today (or yesterday, so a streak isn't broken before today's first
   * play), and the longest run ever.
   */
  export function streaks(days: Set<string>, today = new Date()) {
    const sorted = [...days].sort();
    let longest = 0;
    let run = 0;
    let previous: Date | null = null;
    for (const key of sorted) {
      const [y, m, d] = key.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      run = previous && Math.round((date.getTime() - previous.getTime()) / 86400000) === 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
      previous = date;
    }
    let current = 0;
    const start = days.has(dayOf(today)) ? today : new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    for (let d = start; days.has(dayOf(d)); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)) current++;
    return { current, longest };
  }

  interface Context {
    items: Map<number, MediaItem>;
    /**
     * The show of each episode, and the artist of each track.
     */
    showOf: Map<number, MediaItem>;
    artistOf: Map<number, MediaItem>;
  }

  /**
   * The items the sessions point at, with the shows of episodes and the artists of tracks, in a few queries.
   */
  async function context(sessions: PlaySession[]): Promise<Context> {
    const ids = [...new Set(sessions.map((s) => s.itemId).filter((id): id is number => id !== null))];
    const items = new Map<number, MediaItem>();
    for (let i = 0; i < ids.length; i += 500) {
      for (const item of await MediaItem.findAll({ where: { id: ids.slice(i, i + 500) }, attributes: ["id", "type", "title", "parentId", "artwork", "genres", "artist"] })) items.set(item.id, item);
    }
    const parentIds = [...new Set([...items.values()].filter((i) => i.type === "episode" || i.type === "track").map((i) => i.parentId).filter((id): id is number => id !== null))];
    const parents = new Map((parentIds.length ? await MediaItem.findAll({ where: { id: parentIds }, attributes: ["id", "type", "title", "parentId", "artwork", "genres"] }) : []).map((p) => [p.id, p]));
    const topIds = [...new Set([...parents.values()].map((p) => p.parentId).filter((id): id is number => id !== null))];
    const tops = new Map((topIds.length ? await MediaItem.findAll({ where: { id: topIds }, attributes: ["id", "type", "title", "artwork", "genres"] }) : []).map((p) => [p.id, p]));
    const showOf = new Map<number, MediaItem>();
    const artistOf = new Map<number, MediaItem>();
    for (const item of items.values()) {
      const parent = item.parentId ? parents.get(item.parentId) : undefined;
      const top = parent?.parentId ? tops.get(parent.parentId) : undefined;
      if (item.type === "episode" && top) showOf.set(item.id, top);
      if (item.type === "track" && top) artistOf.set(item.id, top);
    }
    return { items, showOf, artistOf };
  }

  function rank(map: Map<string | number, StatsTitle>) {
    return [...map.values()].sort((a, b) => b.seconds - a.seconds || b.count - a.count).slice(0, TOP);
  }

  function title(map: Map<string | number, StatsTitle>, key: string | number, item: MediaItem | null, fallback: string, seconds: number) {
    const entry = map.get(key) ?? { id: item?.id ?? null, title: item?.title ?? fallback, image: item?.artwork.poster ?? null, seconds: 0, count: 0 };
    entry.seconds += seconds;
    entry.count++;
    map.set(key, entry);
  }

  /**
   * Everything statistics show about a set of sessions.
   */
  async function summarise(sessions: PlaySession[], from: Date | null, to: Date) {
    const ctx = await context(sessions);
    const totals = empty();
    const counts: StatsCounts = { movies: 0, episodes: 0, tracks: 0, books: 0, days: 0 };
    const bucket: "day" | "month" = from && to.getTime() - from.getTime() < 40 * 86400000 ? "day" : "month";
    const first = from ?? (sessions.length ? sessions.reduce((a, b) => a.startedAt < b.startedAt ? a : b).startedAt : to);
    const buckets = new Map<string, StatsBucket>(bucketKeys(first, to, bucket).map((key) => [key, { key, ...empty() }]));
    const shows = new Map<string | number, StatsTitle>();
    const movies = new Map<string | number, StatsTitle>();
    const artists = new Map<string | number, StatsTitle>();
    const books = new Map<string | number, StatsTitle>();
    const genres = new Map<string, number>();
    const days = new Set<string>();
    const binges = new Map<string, { title: string; showId: number | null; episodes: Set<number>; day: string }>();
    // Shows count the different episodes watched, not the sittings
    const episodesOfShow = new Map<string | number, Set<number>>();
    const counted = { movies: new Set<number>(), episodes: new Set<number>(), tracks: new Set<number>(), books: new Set<number>() };

    for (const session of sessions) {
      const day = dayOf(session.startedAt);
      const key = bucket === "day" ? day : day.slice(0, 7);
      const item = session.itemId !== null ? ctx.items.get(session.itemId) ?? null : null;
      addTo(totals, session.kind, session.seconds);
      const b = buckets.get(key) ?? { key, ...empty() };
      addTo(b, session.kind, session.seconds);
      buckets.set(key, b);
      if (session.seconds >= 60) days.add(day);

      if (session.kind === "episode") {
        const show = item ? ctx.showOf.get(item.id) ?? null : null;
        const showKey = show?.id ?? `?${item?.title}`;
        title(shows, showKey, show, item?.title ?? "", session.seconds);
        if (item) {
          counted.episodes.add(item.id);
          episodesOfShow.set(showKey, (episodesOfShow.get(showKey) ?? new Set()).add(item.id));
        }
        for (const genre of show?.genres ?? []) genres.set(genre, (genres.get(genre) ?? 0) + session.seconds);
        if (show && item) {
          const bingeKey = `${show.id}:${day}`;
          const binge = binges.get(bingeKey) ?? { title: show.title, showId: show.id, episodes: new Set<number>(), day };
          binge.episodes.add(item.id);
          binges.set(bingeKey, binge);
        }
      }
      else if (session.kind === "movie" || session.kind === "video") {
        if (session.kind === "movie") title(movies, item?.id ?? `?${session.id}`, item, "", session.seconds);
        if (item && session.kind === "movie") counted.movies.add(item.id);
        for (const genre of item?.genres ?? []) genres.set(genre, (genres.get(genre) ?? 0) + session.seconds);
      }
      else if (session.kind === "track") {
        const artist = item ? ctx.artistOf.get(item.id) ?? null : null;
        title(artists, artist?.id ?? `?${item?.artist ?? ""}`, artist, item?.artist ?? "", session.seconds);
        if (item) counted.tracks.add(item.id);
      }
      else if (session.kind === "audiobook" || session.kind === "book") {
        title(books, item?.id ?? `?${session.id}`, item, "", session.seconds);
        if (item) counted.books.add(item.id);
      }
    }

    for (const [key, episodes] of episodesOfShow) shows.get(key)!.count = episodes.size;
    counts.movies = counted.movies.size;
    counts.episodes = counted.episodes.size;
    counts.tracks = counted.tracks.size;
    counts.books = counted.books.size;
    counts.days = days.size;
    const binge = [...binges.values()].sort((a, b) => b.episodes.size - a.episodes.size)[0];
    return {
      totals,
      counts,
      bucket,
      buckets: [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)),
      topShows: rank(shows).filter((t) => t.title),
      topMovies: rank(movies).filter((t) => t.title),
      topArtists: rank(artists).filter((t) => t.title),
      topBooks: rank(books).filter((t) => t.title),
      topGenres: [...genres].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([name, seconds]) => ({ name, seconds })),
      binge: binge && binge.episodes.size >= 3 ? { title: binge.title, showId: binge.showId, episodes: binge.episodes.size, day: binge.day } : null,
      days,
    };
  }

  async function sessionsOf(userIds: number[] | null, from: Date | null, to: Date) {
    return await PlaySession.findAll({
      where: { ...(userIds ? { userId: userIds } : {}), startedAt: from ? { [Op.gte]: from, [Op.lte]: to } : { [Op.lte]: to } },
      order: [["startedAt", "ASC"]],
    });
  }

  async function allDays(userIds: number[] | null) {
    const rows = await PlaySession.findAll({ where: { ...(userIds ? { userId: userIds } : {}), seconds: { [Op.gte]: 60 } }, attributes: ["startedAt"] });
    return new Set(rows.map((r) => dayOf(r.startedAt)));
  }

  export async function forProfile(user: User, period: StatsPeriod): Promise<ProfileStats> {
    const to = new Date();
    const from = periodStart(period, to);
    const summary = await summarise(await sessionsOf([user.id], from, to), from, to);
    const { days: _days, ...rest } = summary;
    return {
      period,
      from: from ? dayOf(from) : null,
      to: dayOf(to),
      ...rest,
      streak: streaks(await allDays([user.id]), to),
      private: normalizePreferences(user.preferences).privateStats,
    };
  }

  export async function forServer(period: StatsPeriod): Promise<ServerStats> {
    const to = new Date();
    const from = periodStart(period, to);
    const sessions = await sessionsOf(null, from, to);
    const summary = await summarise(sessions, from, to);
    const users = await User.findAll({ order: [["id", "ASC"]] });
    const perUser = new Map<number, TimeSplit>();
    for (const session of sessions) {
      const split = perUser.get(session.userId) ?? empty();
      addTo(split, session.kind, session.seconds);
      perUser.set(session.userId, split);
    }
    const visible = users.filter((u) => !normalizePreferences(u.preferences).privateStats);
    const profiles = visible.map((u) => ({ id: u.id, name: u.name, color: u.color, avatar: u.toProfileJSON().avatar, totals: perUser.get(u.id) ?? empty() })).sort((a, b) => sum(b.totals) - sum(a.totals));

    // Titles nobody ever played, from every session there is
    const played = new Set<number>();
    for (const row of await PlaySession.findAll({ attributes: ["itemId"], group: ["itemId"], raw: true }) as unknown as { itemId: number | null }[]) {
      if (row.itemId !== null) played.add(row.itemId);
    }
    const episodeShows = new Set<number>();
    const episodes = played.size ? await MediaItem.findAll({ where: { id: [...played], type: "episode" }, attributes: ["parentId"] }) : [];
    const seasons = episodes.length ? await MediaItem.findAll({ where: { id: [...new Set(episodes.map((e) => e.parentId!))] }, attributes: ["parentId"] }) : [];
    for (const season of seasons) if (season.parentId) episodeShows.add(season.parentId);
    const untouched: ServerStats["untouched"] = [];
    const neverPlayed: ServerStats["neverPlayed"] = [];
    const monthAgo = new Date(Date.now() - 30 * 86400000);
    for (const library of await Library.findAll({ where: { type: ["movies", "shows"] }, order: [["id", "ASC"]] })) {
      const titles = await MediaItem.findAll({ where: { libraryId: library.id, type: library.type === "movies" ? "movie" : "show" }, attributes: ["id", "title", "artwork", "addedAt"], order: [["addedAt", "ASC"]] });
      const never = titles.filter((t) => !played.has(t.id) && !episodeShows.has(t.id));
      untouched.push({ id: library.id, name: library.name, type: library.type, titles: titles.length, untouched: never.length });
      for (const title of never.filter((t) => t.addedAt < monthAgo)) neverPlayed.push({ id: title.id, title: title.title, image: title.artwork.poster, addedAt: title.addedAt.toISOString(), libraryName: library.name });
    }
    neverPlayed.sort((a, b) => a.addedAt.localeCompare(b.addedAt));

    return {
      period,
      from: from ? dayOf(from) : null,
      to: dayOf(to),
      totals: summary.totals,
      counts: summary.counts,
      bucket: summary.bucket,
      buckets: summary.buckets,
      profiles,
      privateProfiles: users.length - visible.length,
      topShows: summary.topShows,
      topMovies: summary.topMovies,
      untouched,
      neverPlayed: neverPlayed.slice(0, 24),
    };
  }

  function sum(split: TimeSplit) {
    return split.watching + split.listening + split.reading;
  }

  /**
   * A year for one profile, or for everyone (private profiles count in the totals, not by name).
   */
  export async function yearInReview(user: User, year: number, scope: "me" | "household"): Promise<YearInReview> {
    const from = new Date(year, 0, 1);
    const to = new Date(Math.min(Date.now(), new Date(year + 1, 0, 1).getTime() - 1));
    const users = scope === "me" ? [user] : await User.findAll();
    const sessions = await sessionsOf(users.map((u) => u.id), from, to);
    const summary = await summarise(sessions, from, to);
    // Always twelve months, so the year reads the same in January and in December
    const months = bucketKeys(from, new Date(year, 11, 31), "month").map((key) => {
      const found = summary.buckets.find((b) => b.key === key) ?? summary.buckets.find((b) => b.key.slice(0, 7) === key);
      if (summary.bucket === "month") return found ?? { key, ...empty() };
      const inMonth = summary.buckets.filter((b) => b.key.startsWith(key));
      return inMonth.reduce((acc, b) => ({ key, watching: acc.watching + b.watching, listening: acc.listening + b.listening, reading: acc.reading + b.reading }), { key, ...empty() });
    });
    const busiest = months.reduce<StatsBucket | null>((best, m) => !best || sum(m) > sum(best) ? m : best, null);
    const firstSession = sessions.find((s) => s.itemId !== null);
    const firstItem = firstSession?.itemId ? await MediaItem.findByPk(firstSession.itemId, { attributes: ["title", "type", "parentId"] }) : null;
    const per = new Map<number, number>();
    for (const s of sessions) per.set(s.userId, (per.get(s.userId) ?? 0) + s.seconds);
    const people = scope === "household"
      ? users.filter((u) => !normalizePreferences(u.preferences).privateStats && (per.get(u.id) ?? 0) > 0)
        .map((u) => ({ id: u.id, name: u.name, color: u.color, avatar: u.toProfileJSON().avatar, seconds: per.get(u.id) ?? 0 }))
        .sort((a, b) => b.seconds - a.seconds)
      : [];
    return {
      year,
      scope,
      name: scope === "me" ? user.name : await Setting.get(Setting.Keys.SERVER_NAME, AppSystem.APP_NAME),
      totals: summary.totals,
      counts: summary.counts,
      months,
      topShow: summary.topShows[0] ?? null,
      topMovie: summary.topMovies[0] ?? null,
      topArtist: summary.topArtists[0] ?? null,
      topBook: summary.topBooks[0] ?? null,
      topGenres: summary.topGenres.slice(0, 5),
      busiestMonth: busiest && sum(busiest) > 0 ? busiest.key : null,
      binge: summary.binge,
      longestStreak: streaks(summary.days, to).longest,
      first: firstSession && firstItem ? { title: await firstTitle(firstItem), day: dayOf(firstSession.startedAt) } : null,
      people,
    };
  }

  async function firstTitle(item: MediaItem) {
    if (item.type !== "episode" || !item.parentId) return item.title;
    const season = await MediaItem.findByPk(item.parentId, { attributes: ["parentId"] });
    const show = season?.parentId ? await MediaItem.findByPk(season.parentId, { attributes: ["title"] }) : null;
    return show ? `${show.title} · ${item.title}` : item.title;
  }
}

export default Statistics;
