import type { MissingEpisode } from "@shared/upkeep.ts";
import { Library, MediaItem } from "../models/index.ts";
import MetadataManager from "../metadata/MetadataManager.ts";
import type TmdbProvider from "../metadata/providers/TmdbProvider.ts";
import type TvdbProvider from "../metadata/providers/TvdbProvider.ts";
import Tasks from "../lib/Tasks.ts";
import log from "../lib/Logger.ts";

/**
 * The episodes of a show that aren't in the library: the show's guide from TMDB (or TheTVDB) next to the episodes
 * that are here. Only episodes that have aired count, and specials are left out.
 */
export namespace MissingEpisodes {
  /**
   * Guides are looked up again after this long, for new episodes.
   */
  const STALE_MS = 7 * 24 * 60 * 60 * 1000;

  export interface SeasonResult {
    number: number;
    /**
     * Episodes the guide lists for this season that have aired.
     */
    aired: number;
    missing: MissingEpisode[];
  }

  /**
   * The show's guide, looked up when there's none or it's a week old.
   * @param force Look it up again now.
   */
  export async function guide(show: MediaItem, force = false): Promise<MediaItem.EpisodeGuide | null> {
    const cached = show.episodeGuide;
    if (cached && !force && Date.now() - Date.parse(cached.fetchedAt) < STALE_MS) return cached;
    const ids = show.externalIds;
    if (!ids.tmdb && !ids.tvdb && !ids.imdb) return cached;
    let fetched: MediaItem.EpisodeGuide | null = null;
    try {
      const tmdb = MetadataManager.provider("tmdb") as TmdbProvider | undefined;
      if (tmdb && await tmdb.isAvailable()) fetched = await tmdb.episodeGuide(ids);
      const tvdb = MetadataManager.provider("tvdb") as TvdbProvider | undefined;
      if (!fetched && tvdb && await tvdb.isAvailable()) fetched = await tvdb.episodeGuide(ids);
    } catch (error) {
      log.warn(`Could not look up the episodes of "${show.title}"`, { error });
      return cached;
    }
    if (!fetched) return cached;
    show.episodeGuide = fetched;
    await show.save();
    return fetched;
  }

  /**
   * The aired episodes of each season in the guide that aren't here.
   */
  export async function forShow(show: MediaItem, opts?: { force?: boolean; today?: string }): Promise<SeasonResult[]> {
    const found = await guide(show, opts?.force);
    if (!found) return [];
    const today = opts?.today ?? new Date().toISOString().slice(0, 10);
    const seasons = await MediaItem.findAll({ where: { parentId: show.id, type: "season" }, attributes: ["id", "seasonNumber"] });
    const episodes = seasons.length ? await MediaItem.findAll({ where: { parentId: seasons.map((s) => s.id), type: "episode" }, attributes: ["seasonNumber", "episodeNumber", "episodeEnd"] }) : [];
    const have = new Set<string>();
    for (const episode of episodes) {
      if (episode.seasonNumber === null || episode.episodeNumber === null) continue;
      // A file with two episodes in it (S01E01-E02) has both
      for (let n = episode.episodeNumber; n <= (episode.episodeEnd ?? episode.episodeNumber); n++) have.add(`${episode.seasonNumber}:${n}`);
    }
    return compare(found, have, today);
  }

  /**
   * The guide's aired episodes that `have` (`season:episode` keys) doesn't have. Separate, so it can be tested.
   */
  export function compare(guide: MediaItem.EpisodeGuide, have: Set<string>, today: string): SeasonResult[] {
    const result: SeasonResult[] = [];
    for (const season of guide.seasons) {
      const aired = season.episodes.filter((e) => e.airDate && e.airDate <= today);
      result.push({
        number: season.number,
        aired: aired.length,
        missing: aired.filter((e) => !have.has(`${season.number}:${e.number}`)).map((e) => ({ season: season.number, episode: e.number, title: e.title, airDate: e.airDate })),
      });
    }
    return result.filter((s) => s.aired > 0);
  }

  /**
   * Look up every show's guide that's missing or old, as a background task.
   */
  export function lookUpAll() {
    return Tasks.run("missing-episodes", "Looking up episodes", { queue: "upkeep" }, async (task) => {
      const libraries = await Library.findAll({ where: { type: "shows" }, attributes: ["id"] });
      const shows = await MediaItem.findAll({ where: { libraryId: libraries.map((l) => l.id), type: "show" } });
      for (const [i, show] of shows.entries()) {
        task.update(`Looking up episodes (${i + 1} of ${shows.length})`, shows.length ? i / shows.length : null);
        await guide(show).catch(() => null);
      }
      return shows.length;
    });
  }

  /**
   * Shows with episodes missing, from the guides already looked up, most missing first.
   */
  export async function overview() {
    const libraries = await Library.findAll({ where: { type: "shows" }, attributes: ["id"] });
    const shows = await MediaItem.findAll({ where: { libraryId: libraries.map((l) => l.id), type: "show" } });
    const result: { show: MediaItem; missing: number; aired: number }[] = [];
    for (const show of shows) {
      if (!show.episodeGuide) continue;
      const seasons = await forShow(show);
      const missing = seasons.reduce((sum, s) => sum + s.missing.length, 0);
      if (missing > 0) result.push({ show, missing, aired: seasons.reduce((sum, s) => sum + s.aired, 0) });
    }
    return {
      shows: result.sort((a, b) => b.missing - a.missing),
      lookedUp: shows.filter((s) => s.episodeGuide).length,
      total: shows.length,
    };
  }
}

export default MissingEpisodes;
