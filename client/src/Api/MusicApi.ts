import type { AlbumDetail, AlbumSummary, ArtistDetail, ArtistSummary, AudioFormat, Lyrics, MusicOverview, MusicPage, MusicSort, TrackInfo, TrackStream } from "@shared/music.ts";
import BaseApi from "./BaseApi.ts";

export namespace MusicApi {
  export function albums(libraryId: number, opts: { sort?: MusicSort; genre?: string | null; offset?: number; limit?: number }) {
    const query = new URLSearchParams({ sort: opts.sort ?? "title", offset: String(opts.offset ?? 0), limit: String(opts.limit ?? 60) });
    if (opts.genre) query.set("genre", opts.genre);
    return BaseApi.GET<MusicPage<AlbumSummary>>(`/music/libraries/${libraryId}/albums?${query}`);
  }

  export function artists(libraryId: number, offset = 0, limit = 120) {
    return BaseApi.GET<MusicPage<ArtistSummary>>(`/music/libraries/${libraryId}/artists?offset=${offset}&limit=${limit}`);
  }

  export function tracks(libraryId: number, opts: { sort?: MusicSort; offset?: number; limit?: number }) {
    return BaseApi.GET<MusicPage<TrackInfo>>(`/music/libraries/${libraryId}/tracks?sort=${opts.sort ?? "title"}&offset=${opts.offset ?? 0}&limit=${opts.limit ?? 200}`);
  }

  export function overview(libraryId: number) {
    return BaseApi.GET<MusicOverview>(`/music/libraries/${libraryId}/overview`);
  }

  export function genres(libraryId: number) {
    return BaseApi.GET<string[]>(`/music/libraries/${libraryId}/genres`);
  }

  /**
   * Random tracks from the whole library.
   */
  export function shuffle(libraryId: number, limit = 100) {
    return BaseApi.GET<TrackInfo[]>(`/music/libraries/${libraryId}/shuffle?limit=${limit}`);
  }

  export function album(id: number) {
    return BaseApi.GET<AlbumDetail>(`/music/albums/${id}`);
  }

  export function artist(id: number) {
    return BaseApi.GET<ArtistDetail>(`/music/artists/${id}`);
  }

  /**
   * Every track on the artist's albums.
   */
  export function artistTracks(id: number) {
    return BaseApi.GET<TrackInfo[]>(`/music/artists/${id}/tracks`);
  }

  /**
   * Tracks by id, in the order given, like a queue saved in this browser.
   */
  export function tracksByIds(ids: number[]) {
    return BaseApi.GET<TrackInfo[]>(`/music/tracks?ids=${ids.join(",")}`);
  }

  /**
   * A URL to play a track. Formats this browser can't play are converted by the server first.
   */
  export function stream(trackId: number, formats: AudioFormat[]) {
    return BaseApi.POST<TrackStream>(`/music/tracks/${trackId}/stream`, { formats });
  }

  /**
   * Count a play of a track.
   */
  export function played(trackId: number) {
    return BaseApi.POST<void>(`/music/tracks/${trackId}/played`, {});
  }

  export function lyrics(trackId: number) {
    return BaseApi.GET<Lyrics>(`/music/tracks/${trackId}/lyrics`);
  }
}

export default MusicApi;
