import type { Artwork, ExternalIds, ItemType, MatchCandidate } from "@shared/media.ts";
import type ImageCache from "../images/ImageCache.ts";

/**
 * A source of details for movies and shows. Providers run in the priority order chosen in settings,
 * and the first one to know a field wins. IDs found by one provider are passed on to the next.
 */
export abstract class MetadataProvider {
  /**
   * Stored in settings, e.g. "tmdb".
   */
  public abstract readonly id: string;
  public abstract readonly name: string;

  /**
   * Whether the provider can be used right now, e.g. it has an API key.
   */
  public isAvailable(): Promise<boolean> | boolean {
    return true;
  }

  public abstract movie(query: MetadataProvider.MovieQuery): Promise<MetadataProvider.ItemMetadata | null>;

  public abstract show(query: MetadataProvider.ShowQuery): Promise<MetadataProvider.ShowMetadata | null>;

  /**
   * Search by title for the "Fix match" dialog. Providers that can't search return nothing.
   */
  public search(_type: Extract<ItemType, "movie" | "show">, _query: string, _year: number | null): Promise<MatchCandidate[]> {
    return Promise.resolve([]);
  }
}

export namespace MetadataProvider {
  export interface CreditMetadata {
    name: string;
    kind: "cast" | "director" | "writer" | "producer" | "composer";
    character?: string | null;
    order: number;
    photo?: ImageCache.Source | null;
    tmdbId?: string | null;
  }

  /**
   * What a provider knows about a title. Every field is optional; missing ones come from the next provider.
   */
  export interface ItemMetadata {
    title?: string | null;
    originalTitle?: string | null;
    year?: number | null;
    overview?: string | null;
    tagline?: string | null;
    runtime?: number | null;
    releaseDate?: string | null;
    rating?: number | null;
    contentRating?: string | null;
    genres?: string[];
    studios?: string[];
    ids?: ExternalIds;
    artwork?: Partial<Record<keyof Artwork, ImageCache.Source>>;
    credits?: CreditMetadata[];
  }

  export interface SeasonMetadata extends ItemMetadata {
    episodes: Map<number, ItemMetadata>;
  }

  export interface ShowMetadata extends ItemMetadata {
    seasons: Map<number, SeasonMetadata>;
  }

  export interface MovieQuery {
    title: string;
    year: number | null;
    ids: ExternalIds;
    /**
     * The movie's video files.
     */
    files: string[];
    /**
     * The movie's own folder. `null` when the files sit straight in the library folder.
     */
    folder: string | null;
  }

  export interface ShowQuery {
    title: string;
    year: number | null;
    ids: ExternalIds;
    folder: string;
    /**
     * Seasons in the library, with the video files of each episode.
     */
    seasons: Map<number, { folder: string | null; episodes: Map<number, string[]> }>;
  }
}

export default MetadataProvider;
