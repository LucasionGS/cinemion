import type { WatchlistOverview } from "@shared/watchlist.ts";
import BaseApi from "./BaseApi.ts";

/**
 * The signed-in profile's "My list".
 */
export namespace WatchlistApi {
  export function overview() {
    return BaseApi.GET<WatchlistOverview>("/watchlist");
  }

  /**
   * Bring the list in step with Trakt now.
   */
  export function sync() {
    return BaseApi.POST<WatchlistOverview>("/watchlist/sync");
  }

  export function add(itemId: number) {
    return BaseApi.PUT<{ onList: boolean }>(`/watchlist/items/${itemId}`);
  }

  export function remove(itemId: number) {
    return BaseApi.DELETE<{ onList: boolean }>(`/watchlist/items/${itemId}`);
  }

  /**
   * Take an entry off, also one for a title that isn't here.
   */
  export function removeEntry(id: number) {
    return BaseApi.DELETE<WatchlistOverview>(`/watchlist/entries/${id}`);
  }
}

export default WatchlistApi;
