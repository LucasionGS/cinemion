import type { ItemDetail, ItemPage, ItemSummary, MatchCandidate, SortOrder } from "@shared/media.ts";
import BaseApi from "./BaseApi.ts";

export namespace ItemsApi {
  /**
   * Movies or shows in a library, sorted and paged.
   */
  export function list(libraryId: number, opts?: { sort?: SortOrder; order?: "asc" | "desc"; offset?: number; limit?: number }) {
    opts ??= {};
    const params = new URLSearchParams();
    if (opts.sort) params.set("sort", opts.sort);
    if (opts.order) params.set("order", opts.order);
    if (opts.offset) params.set("offset", String(opts.offset));
    if (opts.limit) params.set("limit", String(opts.limit));
    return BaseApi.GET<ItemPage>(`/libraries/${libraryId}/items?${params}`);
  }

  export function get(id: number) {
    return BaseApi.GET<ItemDetail>(`/items/${id}`);
  }

  /**
   * Fetch details again. Seasons and episodes refresh their whole show.
   */
  export function refresh(id: number) {
    return BaseApi.POST<ItemSummary>(`/items/${id}/refresh`);
  }

  /**
   * Search for the right title for "Fix match".
   */
  export function searchMatches(id: number, query: string, year: number | null) {
    const params = new URLSearchParams({ query });
    if (year) params.set("year", String(year));
    return BaseApi.GET<MatchCandidate[]>(`/items/${id}/match?${params}`);
  }

  export function setMatch(id: number, candidate: MatchCandidate) {
    return BaseApi.POST<ItemSummary>(`/items/${id}/match`, { provider: candidate.provider, id: candidate.id });
  }

  /**
   * URL of cached artwork, at (at most) `width` pixels wide.
   */
  export function imageUrl(key: string, width: number) {
    return `/api/images/${key}?w=${Math.round(width)}`;
  }
}

export default ItemsApi;
