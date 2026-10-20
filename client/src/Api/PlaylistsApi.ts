import type { PlaylistDetail, PlaylistSummary } from "@shared/music.ts";
import BaseApi from "./BaseApi.ts";

export namespace PlaylistsApi {
  /**
   * The signed-in profile's playlists, most recently changed first.
   */
  export function list() {
    return BaseApi.GET<PlaylistSummary[]>("/playlists");
  }

  export function create(name: string, trackIds: number[] = []) {
    return BaseApi.POST<PlaylistDetail>("/playlists", { name, trackIds });
  }

  export function get(id: number) {
    return BaseApi.GET<PlaylistDetail>(`/playlists/${id}`);
  }

  export function rename(id: number, name: string) {
    return BaseApi.PATCH<PlaylistSummary>(`/playlists/${id}`, { name });
  }

  export function remove(id: number) {
    return BaseApi.DELETE<void>(`/playlists/${id}`);
  }

  /**
   * Add tracks to the end of a playlist.
   */
  export function addTracks(id: number, trackIds: number[]) {
    return BaseApi.POST<PlaylistSummary>(`/playlists/${id}/tracks`, { trackIds });
  }

  export function removeEntry(id: number, entryId: number) {
    return BaseApi.DELETE<PlaylistDetail>(`/playlists/${id}/entries/${entryId}`);
  }

  /**
   * Put the entries in this order.
   */
  export function reorder(id: number, entryIds: number[]) {
    return BaseApi.PUT<PlaylistDetail>(`/playlists/${id}/order`, { entryIds });
  }
}

export default PlaylistsApi;
