import type { AlbumSummary, ArtistSummary, TrackInfo } from "@shared/music.ts";
import { MediaFile, MediaItem, type User, WatchState } from "../models/index.ts";
import Summaries from "../library/Summaries.ts";
import MusicTags from "./MusicTags.ts";

/**
 * Builds the album, artist and track shapes the client gets, loading what items don't know by themselves in a few
 * batched queries.
 */
export namespace MusicSummaries {
  async function titlesById(ids: (number | null)[]) {
    const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
    if (wanted.length === 0) return new Map<number, MediaItem>();
    return new Map((await MediaItem.findAll({ where: { id: wanted } })).map((i) => [i.id, i]));
  }

  export async function albums(items: MediaItem[]): Promise<AlbumSummary[]> {
    if (items.length === 0) return [];
    const artists = await titlesById(items.map((a) => a.parentId));
    const counts = await Summaries.childCounts(items.map((a) => a.id));
    return items.map((album) => ({
      id: album.id,
      libraryId: album.libraryId,
      title: album.title,
      artistId: album.parentId,
      artistName: (album.parentId ? artists.get(album.parentId)?.title : null) ?? MusicTags.UNKNOWN_ARTIST,
      year: album.year,
      genres: album.genres,
      cover: album.artwork.poster,
      palette: album.palette,
      trackCount: counts.get(album.id) ?? 0,
      addedAt: album.addedAt.toISOString(),
    }));
  }

  export async function artists(items: MediaItem[]): Promise<ArtistSummary[]> {
    if (items.length === 0) return [];
    const counts = await Summaries.childCounts(items.map((a) => a.id));
    return items.map((artist) => ({
      id: artist.id,
      libraryId: artist.libraryId,
      name: artist.title,
      image: artist.artwork.poster,
      palette: artist.palette,
      albumCount: counts.get(artist.id) ?? 0,
    }));
  }

  /**
   * Tracks in the given order, with their album, artist, length and how often `user` played them.
   */
  export async function tracks(items: MediaItem[], user: User | null): Promise<TrackInfo[]> {
    if (items.length === 0) return [];
    const ids = items.map((t) => t.id);
    const albumById = await titlesById(items.map((t) => t.parentId));
    const artistById = await titlesById([...albumById.values()].map((a) => a.parentId));
    const durations = new Map((await MediaFile.findAll({ where: { itemId: ids }, attributes: ["itemId", "duration"] })).map((f) => [f.itemId!, f.duration ?? 0]));
    const plays = user ? new Map((await WatchState.findAll({ where: { userId: user.id, itemId: ids }, attributes: ["itemId", "playCount"] })).map((s) => [s.itemId, s.playCount])) : new Map<number, number>();

    return items.map((track) => {
      const album = track.parentId ? albumById.get(track.parentId) : undefined;
      const artist = album?.parentId ? artistById.get(album.parentId) : undefined;
      return {
        id: track.id,
        title: track.title,
        albumId: album?.id ?? null,
        albumTitle: album?.title ?? MusicTags.UNKNOWN_ALBUM,
        artistId: artist?.id ?? null,
        artistName: artist?.title ?? MusicTags.UNKNOWN_ARTIST,
        trackArtist: track.artist,
        disc: track.seasonNumber,
        number: track.episodeNumber,
        duration: durations.get(track.id) ?? 0,
        cover: album?.artwork.poster ?? null,
        palette: album?.palette ?? null,
        playCount: plays.get(track.id) ?? 0,
      };
    });
  }

  /**
   * Album order: disc, then track number, then title.
   */
  export function compareTracks(a: MediaItem, b: MediaItem) {
    return (a.seasonNumber ?? 1) - (b.seasonNumber ?? 1) || (a.episodeNumber ?? 9999) - (b.episodeNumber ?? 9999) || a.sortTitle.localeCompare(b.sortTitle);
  }
}

export default MusicSummaries;
