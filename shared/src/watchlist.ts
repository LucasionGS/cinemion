import type { ItemSummary } from "./media.ts";

/**
 * Types for "My list": titles a profile wants to watch, kept in step with the profile's Trakt watchlist when it's
 * linked.
 */

export type WatchlistKind = "movie" | "show" | "video";

export interface WatchlistEntry {
  id: number;
  kind: WatchlistKind;
  title: string;
  year: number | null;
  addedAt: string;
  /**
   * The title in a library. `null` when it isn't here (yet), or is in a library this profile can't see.
   */
  item: ItemSummary | null;
  /**
   * When a title that wasn't here arrived.
   */
  arrivedAt: string | null;
  /**
   * Where to read about a title that isn't here: its TMDB or IMDb page.
   */
  link: string | null;
}

export interface WatchlistOverview {
  entries: WatchlistEntry[];
  trakt: {
    /**
     * Whether this profile's list is kept in step with Trakt.
     */
    linked: boolean;
    syncedAt: string | null;
    /**
     * Why the last sync didn't work, or `null`.
     */
    error: string | null;
  };
}
