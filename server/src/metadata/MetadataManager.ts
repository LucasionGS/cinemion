import Path from "node:path";
import type { MetadataSettings } from "@shared/api.ts";
import type { Artwork, ExternalIds, ItemType, MatchCandidate } from "@shared/media.ts";
import { Collection, Credit, Library, MediaFile, MediaItem, Person, Setting } from "../models/index.ts";
import ContentRatings from "../library/ContentRatings.ts";
import VideoDetails from "../library/VideoDetails.ts";
import type MetadataProvider from "./MetadataProvider.ts";
import LocalProvider from "./providers/LocalProvider.ts";
import TmdbProvider from "./providers/TmdbProvider.ts";
import ImageCache from "../images/ImageCache.ts";
import Palette from "../images/Palette.ts";
import log from "../lib/Logger.ts";

type ItemMetadata = MetadataProvider.ItemMetadata;
type ArtworkKind = keyof Artwork;

const ARTWORK_KINDS: ArtworkKind[] = ["poster", "backdrop", "logo", "thumb"];

/**
 * Fetches details for movies and shows from the providers, in priority order, and stores them.
 */
export namespace MetadataManager {
  const ALL_PROVIDERS: MetadataProvider[] = [new LocalProvider(), new TmdbProvider()];

  export function provider(id: string) {
    return ALL_PROVIDERS.find((p) => p.id === id) ?? null;
  }

  /**
   * Providers that are turned on and usable, highest priority first.
   */
  export async function activeProviders() {
    const settings = await Setting.get<MetadataSettings | null>(Setting.Keys.METADATA, null);
    const order = settings?.providers ?? ["local", "tmdb"];
    const active: MetadataProvider[] = [];
    for (const id of order) {
      const p = provider(id);
      if (p && await p.isAvailable()) active.push(p);
    }
    return active;
  }

  /**
   * Combine provider results: for each field the first provider (highest priority) with a value wins.
   * Artwork keeps every candidate per kind, so a failed download can fall back to the next.
   */
  function merge(results: ItemMetadata[]) {
    const merged: ItemMetadata = {};
    const artwork: Partial<Record<ArtworkKind, ImageCache.Source[]>> = {};
    const ids: ExternalIds = {};
    for (const result of results) {
      for (const [key, value] of Object.entries(result) as [keyof ItemMetadata, unknown][]) {
        if (key === "artwork" || key === "ids") continue;
        const isEmpty = value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
        if (!isEmpty && (merged[key] === undefined || merged[key] === null)) (merged as Record<string, unknown>)[key] = value;
      }
      for (const kind of ARTWORK_KINDS) {
        const source = result.artwork?.[kind];
        if (source) (artwork[kind] ??= []).push(source);
      }
      Object.entries(result.ids ?? {}).forEach(([k, v]) => {
        if (v && !ids[k as keyof ExternalIds]) ids[k as keyof ExternalIds] = v;
      });
    }
    return { merged, artwork, ids };
  }

  async function storeArtwork(candidates: Partial<Record<ArtworkKind, ImageCache.Source[]>>, current: Artwork): Promise<Artwork> {
    const artwork: Artwork = { ...current };
    for (const kind of ARTWORK_KINDS) {
      for (const source of candidates[kind] ?? []) {
        const key = await ImageCache.store(source);
        if (key) {
          artwork[kind] = key;
          break;
        }
      }
    }
    return artwork;
  }

  /**
   * Write merged metadata onto an item. Fields the providers didn't know keep their current value.
   */
  function apply(item: MediaItem, data: ItemMetadata) {
    if (data.title) item.setTitle(data.title);
    if (data.originalTitle !== undefined) item.originalTitle = data.originalTitle ?? null;
    if (data.year) item.year = data.year;
    if (data.overview !== undefined) item.overview = data.overview ?? item.overview;
    if (data.tagline !== undefined) item.tagline = data.tagline ?? item.tagline;
    if (data.runtime) item.runtime = data.runtime;
    if (data.releaseDate) item.releaseDate = data.releaseDate;
    if (data.rating) item.rating = data.rating;
    if (data.contentRating) {
      item.contentRating = data.contentRating;
      item.ageRating = ContentRatings.ageFor(data.contentRating);
    }
    if (data.genres?.length) item.genres = data.genres;
    if (data.studios?.length) item.studios = data.studios;
  }

  async function saveCredits(item: MediaItem, credits: MetadataProvider.CreditMetadata[] | undefined) {
    if (!credits?.length) return;
    await Credit.destroy({ where: { itemId: item.id } });
    for (const credit of credits) {
      const photo = credit.photo ? await ImageCache.store(credit.photo) : null;
      const person = await Person.findOrCreatePerson({ name: credit.name, tmdbId: credit.tmdbId ?? null, photo });
      await Credit.create({ itemId: item.id, personId: person.id, kind: credit.kind, character: credit.character ?? null, order: credit.order });
    }
  }

  /**
   * Run every provider in turn, handing the IDs found so far to the next one.
   */
  async function runProviders<Q extends { ids: ExternalIds }, R extends ItemMetadata>(query: Q, lookup: (p: MetadataProvider, q: Q) => Promise<R | null>) {
    const results: { provider: MetadataProvider; result: R }[] = [];
    for (const p of await activeProviders()) {
      try {
        const result = await lookup(p, query);
        if (!result) continue;
        results.push({ provider: p, result });
        query = { ...query, ids: { ...result.ids, ...query.ids } };
      } catch (error) {
        log.warn(`${p.name} lookup failed`, { error });
      }
    }
    return results;
  }

  /**
   * Fetch and store details for a movie.
   */
  export async function refreshMovie(item: MediaItem) {
    const library = await Library.findByPk(item.libraryId);
    const files = await MediaFile.findAll({ where: { itemId: item.id }, order: [["path", "ASC"]] });
    if (!library || files.length === 0) return;

    const firstFolder = Path.dirname(files[0].path);
    const inRoot = library.paths.some((root) => Path.resolve(root) === Path.resolve(firstFolder));
    const results = await runProviders<MetadataProvider.MovieQuery, ItemMetadata>({
      title: item.title,
      year: item.year,
      ids: item.externalIds,
      files: files.map((f) => f.path),
      folder: inRoot ? null : firstFolder,
    }, (p, q) => p.movie(q));

    await save(item, results.map((r) => r.result));
  }

  async function save(item: MediaItem, results: ItemMetadata[], extra?: { palette?: boolean }) {
    const { merged, artwork, ids } = merge(results);
    apply(item, merged);
    // IDs picked by hand always win; otherwise new IDs add to the ones from the file names
    item.externalIds = item.matchStatus === "manual" ? { ...ids, ...item.externalIds } : { ...item.externalIds, ...ids };
    item.artwork = await storeArtwork(artwork, item.artwork);
    if (extra?.palette !== false) {
      const source = item.artwork.backdrop ?? item.artwork.poster;
      if (source) item.palette = await Palette.fromImage(source) ?? item.palette;
    }
    // Only real details count as a match; artwork alone doesn't
    if (item.matchStatus !== "manual") item.matchStatus = results.some((r) => r.title) ? "matched" : "unmatched";
    if (item.type === "movie") item.collectionId = merged.collection ? (await saveCollection(item.libraryId, merged.collection)).id : null;
    // No provider knows the length: use the file's
    if (!item.runtime && (item.type === "movie" || item.type === "episode")) {
      const file = await MediaFile.findOne({ where: { itemId: item.id }, attributes: ["duration"] });
      if (file?.duration) item.runtime = Math.max(1, Math.round(file.duration / 60));
    }
    item.metadataUpdatedAt = new Date();
    await item.save();
    await saveCredits(item, merged.credits);
  }

  async function saveCollection(libraryId: number, data: MetadataProvider.CollectionMetadata) {
    const collection = await Collection.findOrCreateCollection(libraryId, data);
    if (data.overview && !collection.overview) collection.overview = data.overview;
    const candidates = Object.fromEntries(Object.entries(data.artwork ?? {}).map(([kind, source]) => [kind, [source]]));
    collection.artwork = await storeArtwork(candidates, collection.artwork);
    const source = collection.artwork.backdrop ?? collection.artwork.poster;
    if (source && !collection.palette) collection.palette = await Palette.fromImage(source);
    await collection.save();
    return collection;
  }

  /**
   * Fetch and store details for a show, its seasons and its episodes.
   */
  export async function refreshShow(show: MediaItem) {
    const seasons = await MediaItem.findAll({ where: { parentId: show.id, type: "season" }, order: [["seasonNumber", "ASC"]] });
    const query: MetadataProvider.ShowQuery = { title: show.title, year: show.year, ids: show.externalIds, folder: show.folderPath ?? "", seasons: new Map() };
    const episodesBySeason = new Map<number, MediaItem[]>();

    for (const season of seasons) {
      const episodes = await MediaItem.findAll({ where: { parentId: season.id, type: "episode" }, order: [["episodeNumber", "ASC"]] });
      episodesBySeason.set(season.seasonNumber!, episodes);
      const episodeFiles = new Map<number, string[]>();
      let seasonFolder: string | null = null;
      for (const episode of episodes) {
        const files = await MediaFile.findAll({ where: { itemId: episode.id }, attributes: ["path"] });
        episodeFiles.set(episode.episodeNumber!, files.map((f) => f.path));
        if (!seasonFolder && files[0] && Path.dirname(files[0].path) !== query.folder) seasonFolder = Path.dirname(files[0].path);
      }
      query.seasons.set(season.seasonNumber!, { folder: seasonFolder, episodes: episodeFiles });
    }

    const results = await runProviders<MetadataProvider.ShowQuery, MetadataProvider.ShowMetadata>(query, (p, q) => p.show(q));
    await save(show, results.map((r) => r.result));

    for (const season of seasons) {
      const number = season.seasonNumber!;
      // Seasons and episodes share their show's rating, so age limits treat them alike
      const inherit = (child: MediaItem) => {
        child.contentRating = show.contentRating;
        child.ageRating = show.ageRating;
      };
      const seasonResults = results.map((r) => r.result.seasons.get(number)).filter((s): s is MetadataProvider.SeasonMetadata => !!s);
      season.palette = show.palette;
      await save(season, seasonResults.map((s) => ({ ...s, episodes: undefined })), { palette: false });
      // Providers often call season 1 "Season 1"; specials get a friendlier default
      if (!seasonResults.some((s) => s.title)) season.setTitle(number === 0 ? "Specials" : `Season ${number}`);
      inherit(season);
      await season.save();

      for (const episode of episodesBySeason.get(number) ?? []) {
        const episodeResults = seasonResults.map((s) => s.episodes.get(episode.episodeNumber!)).filter((e): e is ItemMetadata => !!e);
        episode.palette = show.palette;
        await save(episode, episodeResults, { palette: false });
        inherit(episode);
        await episode.save();
      }
    }
  }

  /**
   * Refresh whatever an item belongs to: a movie or video itself, or the whole show for shows, seasons and episodes.
   */
  export async function refresh(item: MediaItem) {
    if (item.type === "movie") return await refreshMovie(item);
    // Videos are never looked up; refreshing reads their files again and takes a new automatic thumbnail
    if (item.type === "video" || item.type === "folder") {
      const library = await Library.findByPk(item.libraryId);
      if (item.type === "video") await VideoDetails.refreshVideo(item, { regenerate: true, library });
      if (library) await VideoDetails.refreshFolders(library);
      return;
    }
    let show: MediaItem | null = item;
    while (show && show.type !== "show") show = show.parentId ? await MediaItem.findByPk(show.parentId) : null;
    if (show) await refreshShow(show);
  }

  /**
   * Search for the right title for the "Fix match" dialog.
   */
  export async function search(type: Extract<ItemType, "movie" | "show">, query: string, year: number | null): Promise<MatchCandidate[]> {
    const results: MatchCandidate[] = [];
    for (const p of await activeProviders()) results.push(...await p.search(type, query, year));
    return results;
  }

  /**
   * Tie an item to a provider's entry chosen by hand, then fetch its details again.
   */
  export async function setMatch(item: MediaItem, providerId: string, id: string) {
    if (providerId !== "tmdb") throw new Error(`Matching by hand only works with TMDB, not "${providerId}".`);
    item.externalIds = { tmdb: id };
    item.matchStatus = "manual";
    await item.save();
    await refresh(item);
  }
}

export default MetadataManager;
