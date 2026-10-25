import type { CollectionDetail, CollectionSummary, EditDetailsRequest, HomeData, ItemDetail, ItemPage, ItemSummary, MatchCandidate, PersonDetail, SearchResults, SortOrder } from "@shared/media.ts";
import type { DeletePreview, MissingForShow } from "@shared/upkeep.ts";
import BaseApi from "./BaseApi.ts";

export namespace ItemsApi {
  /**
   * Movies or shows in a library, sorted and paged.
   */
  export function list(libraryId: number, opts?: { sort?: SortOrder; order?: "asc" | "desc"; offset?: number; limit?: number; genre?: string | null; unwatched?: boolean }) {
    opts ??= {};
    const params = new URLSearchParams();
    if (opts.sort) params.set("sort", opts.sort);
    if (opts.genre) params.set("genre", opts.genre);
    if (opts.unwatched) params.set("unwatched", "1");
    if (opts.order) params.set("order", opts.order);
    if (opts.offset) params.set("offset", String(opts.offset));
    if (opts.limit) params.set("limit", String(opts.limit));
    return BaseApi.GET<ItemPage>(`/libraries/${libraryId}/items?${params}`);
  }

  export function get(id: number) {
    return BaseApi.GET<ItemDetail>(`/items/${id}`);
  }

  /**
   * The episode "Play" starts for a show or season.
   */
  export function next(id: number) {
    return BaseApi.GET<ItemSummary | null>(`/items/${id}/next`);
  }

  /**
   * Mark as watched or not. Shows and seasons mark all their episodes.
   */
  export function setWatched(id: number, watched: boolean) {
    return BaseApi.PUT<ItemSummary>(`/items/${id}/watched`, { watched });
  }

  /**
   * For a show: aired episodes that aren't in the library, per season. `refresh` looks them up again.
   */
  export function missing(id: number, refresh = false) {
    return BaseApi.GET<MissingForShow>(`/items/${id}/missing${refresh ? "?refresh=1" : ""}`);
  }

  /**
   * What deleting a title would remove from disk.
   */
  export function deletePreview(id: number) {
    return BaseApi.GET<DeletePreview>(`/items/${id}/delete`);
  }

  /**
   * Delete a title's files from disk, and the title from the library.
   */
  export function remove(id: number) {
    return BaseApi.POST<{ deleted: boolean }>(`/items/${id}/delete`);
  }

  export function home() {
    return BaseApi.GET<HomeData>("/home");
  }

  export function search(query: string) {
    return BaseApi.GET<SearchResults>(`/search?q=${encodeURIComponent(query)}`);
  }

  export function genres(libraryId: number) {
    return BaseApi.GET<string[]>(`/libraries/${libraryId}/genres`);
  }

  export function collections(libraryId: number) {
    return BaseApi.GET<CollectionSummary[]>(`/libraries/${libraryId}/collections`);
  }

  export function collection(id: number) {
    return BaseApi.GET<CollectionDetail>(`/collections/${id}`);
  }

  export function person(id: number) {
    return BaseApi.GET<PersonDetail>(`/people/${id}`);
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
  /**
   * Set a video's or folder's details by hand.
   */
  export function editDetails(id: number, details: EditDetailsRequest) {
    return BaseApi.PUT<ItemSummary>(`/items/${id}/details`, details);
  }

  /**
   * One frame of a video, as an object URL for an `<img>`. Revoke it when done.
   * @param time Unit is in seconds.
   */
  export async function frame(id: number, time: number) {
    const res = await fetch(`/api/items/${id}/frame?t=${time.toFixed(2)}`, { headers: BaseApi.getHeaders(false) });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || res.statusText);
    return URL.createObjectURL(await res.blob());
  }

  /**
   * Use the video's frame at `time` (in seconds) as its thumbnail.
   */
  export function setThumbnailFrame(id: number, time: number) {
    return BaseApi.PUT<ItemSummary>(`/items/${id}/thumbnail`, { time });
  }

  export function uploadThumbnail(id: number, file: File) {
    const form = new FormData();
    form.append("file", file);
    return BaseApi.PUTFormData<ItemSummary>(`/items/${id}/thumbnail`, form);
  }

  /**
   * Go back to the automatic thumbnail.
   */
  export function resetThumbnail(id: number) {
    return BaseApi.DELETE<ItemSummary>(`/items/${id}/thumbnail`);
  }

  export function imageUrl(key: string, width: number) {
    return `/api/images/${key}?w=${Math.round(width)}`;
  }
}

export default ItemsApi;
