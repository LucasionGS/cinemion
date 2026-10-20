import fsp from "node:fs/promises";
import Path from "node:path";
import { Op } from "sequelize";
import { type Library, MediaFile, MediaItem, PlaylistItem } from "../models/index.ts";
import { EMPTY_ARTWORK } from "../models/MediaItem.ts";
import AppSystem from "../AppSystem.ts";
import ImageCache from "../images/ImageCache.ts";
import Palette from "../images/Palette.ts";
import Ffmpeg from "../lib/Ffmpeg.ts";
import type Tasks from "../lib/Tasks.ts";
import log from "../lib/Logger.ts";
import MusicTags from "./MusicTags.ts";

/**
 * Keeps a Music library's artists, albums and tracks in step with its files: sorting tracks into albums by their
 * tags, and finding album covers and artist pictures. Nothing is looked up online.
 */
export namespace MusicLibrary {
  // Pictures in an album folder, best first
  export const COVER_NAMES = ["cover", "folder", "front", "album", "albumart", "albumartsmall"];
  // Pictures in an artist folder
  const ARTIST_NAMES = ["artist", "folder", "photo"];
  const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

  /**
   * Sort new and changed files into artists, albums and tracks. A changed file keeps its track (so playlists keep
   * it), which moves to another album when its tags say so.
   * @param roots The library folder each file was found in.
   * @param changed Files whose tags were read again in this scan.
   * @returns The new tracks.
   */
  export async function assign(library: Library, roots: Map<string, string>, changed: Set<number>) {
    const added: number[] = [];
    const age = library.defaultAge();
    const artists = new Map<string, MediaItem>();
    const albums = new Map<string, MediaItem>();
    for (const artist of await MediaItem.findAll({ where: { libraryId: library.id, type: "artist" } })) artists.set(MusicTags.key(artist.title), artist);
    const artistKeyById = new Map([...artists.values()].map((a) => [a.id, MusicTags.key(a.title)]));
    for (const album of await MediaItem.findAll({ where: { libraryId: library.id, type: "album" } })) {
      albums.set(`${artistKeyById.get(album.parentId!) ?? ""}|${MusicTags.key(album.title)}`, album);
    }

    const files = await MediaFile.findAll({ where: { libraryId: library.id, [Op.or]: [{ itemId: null }, { id: [...changed] }] }, order: [["path", "ASC"]] });
    for (const file of files) {
      const info = MusicTags.details(file.path, file.tags ?? {}, roots.get(file.path) ?? library.paths.find((p) => file.path.startsWith(p)) ?? library.paths[0]);

      const artistKey = MusicTags.key(info.albumArtist);
      let artist = artists.get(artistKey);
      if (!artist) {
        artist = MediaItem.build({ libraryId: library.id, type: "artist", title: "", sortTitle: "", folderPath: info.artistFolder, matchStatus: "matched", ageRating: age });
        artist.setTitle(info.albumArtist);
        await artist.save();
        artists.set(artistKey, artist);
      }

      const albumKey = `${artistKey}|${MusicTags.key(info.album)}`;
      let album = albums.get(albumKey);
      if (!album) {
        album = MediaItem.build({
          libraryId: library.id,
          parentId: artist.id,
          type: "album",
          title: "",
          sortTitle: "",
          folderPath: Path.dirname(file.path),
          year: info.year,
          genres: info.genres,
          matchStatus: "matched",
          ageRating: age,
        });
        album.setTitle(info.album);
        await album.save();
        albums.set(albumKey, album);
      }
      else if ((!album.year && info.year) || info.genres.some((g) => !album!.genres.includes(g))) {
        album.year ??= info.year;
        album.genres = [...new Set([...album.genres, ...info.genres])].slice(0, 6);
        await album.save();
      }

      const fields = {
        parentId: album.id,
        seasonNumber: info.disc,
        episodeNumber: info.number,
        artist: MusicTags.key(info.artist) === artistKey ? null : info.artist,
        year: info.year,
        genres: info.genres,
        runtime: file.duration ? Math.max(1, Math.round(file.duration / 60)) : null,
      };
      const existing = file.itemId ? await MediaItem.findByPk(file.itemId) : null;
      if (existing) {
        existing.setTitle(info.title);
        await existing.update(fields);
        continue;
      }
      const track = MediaItem.build({ libraryId: library.id, type: "track", title: "", sortTitle: "", matchStatus: "matched", ageRating: age, ...fields });
      track.setTitle(info.title);
      await track.save();
      await file.update({ itemId: track.id });
      added.push(track.id);
    }
    return added;
  }

  /**
   * Remove tracks whose files are gone (and their places in playlists), then albums and artists left empty.
   */
  export async function removeEmpty(library: Library) {
    const withFiles = new Set((await MediaFile.findAll({ where: { libraryId: library.id, itemId: { [Op.ne]: null } }, attributes: ["itemId"] })).map((f) => f.itemId!));
    const tracks = await MediaItem.findAll({ where: { libraryId: library.id, type: "track" }, attributes: ["id"] });
    const orphans = tracks.filter((t) => !withFiles.has(t.id)).map((t) => t.id);
    if (orphans.length) {
      await PlaylistItem.destroy({ where: { itemId: orphans } });
      await MediaItem.destroy({ where: { id: orphans } });
    }
    for (const type of ["album", "artist"] as const) {
      for (const parent of await MediaItem.findAll({ where: { libraryId: library.id, type }, attributes: ["id"] })) {
        if (await MediaItem.count({ where: { parentId: parent.id } }) === 0) await parent.destroy();
      }
    }
  }

  /**
   * A picture in `dir` whose name (without extension) is one of `names`, best name first.
   */
  export async function folderImage(dir: string | null, names: string[]) {
    if (!dir) return null;
    const entries = await fsp.readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      const match = entries.find((e) => {
        const ext = Path.extname(e).toLowerCase();
        return IMAGE_EXTENSIONS.includes(ext) && Path.basename(e, Path.extname(e)).toLowerCase() === name;
      });
      if (match) return Path.join(dir, match);
    }
    return null;
  }

  /**
   * The cover inside a music file (ID3 picture, FLAC picture block, MP4 cover), stored in the image cache.
   */
  export async function embeddedCover(path: string) {
    const temp = Path.join(AppSystem.tempDir, `cover-${crypto.randomUUID()}.jpg`);
    try {
      const result = await Ffmpeg.run(["-y", "-i", path, "-map", "0:v:0", "-frames:v", "1", "-q:v", "2", temp]);
      if (result.code !== 0 || !await fsp.stat(temp).then((s) => s.size > 0).catch(() => false)) return null;
      return await ImageCache.store({ file: temp });
    } finally {
      await fsp.rm(temp, { force: true });
    }
  }

  async function setImage(item: MediaItem, key: string | null) {
    item.artwork = { ...EMPTY_ARTWORK, poster: key, thumb: key };
    item.palette = key ? await Palette.fromImage(key) : null;
    await item.save();
  }

  /**
   * Covers for albums that have none (or all of them, when asked), from a picture in the album folder or inside
   * the files, then pictures for artists from their folders.
   * @returns How many albums were looked at.
   */
  export async function refresh(library: Library, task: Tasks.Handle, opts?: { regenerate?: boolean }) {
    opts ??= {};
    const albums = await MediaItem.findAll({ where: { libraryId: library.id, type: "album", ...(opts.regenerate ? {} : { metadataUpdatedAt: null }) } });
    for (const [i, album] of albums.entries()) {
      task.update("Finding album covers", i / albums.length);
      try {
        const tracks = await MediaItem.findAll({ where: { parentId: album.id, type: "track" }, attributes: ["id"] });
        const files = await MediaFile.findAll({ where: { itemId: tracks.map((t) => t.id) }, order: [["path", "ASC"]] });
        const folders = [...new Set(files.map((f) => Path.dirname(f.path)))];
        let key: string | null = null;
        for (const folder of folders) {
          // Multi-disc albums often keep the cover one folder up, next to "CD1" and "CD2"
          const picture = await folderImage(folder, COVER_NAMES) ?? (/^(cd|disc|disk)\s*\d+$/i.test(Path.basename(folder)) ? await folderImage(Path.dirname(folder), COVER_NAMES) : null);
          if (picture) {
            key = await ImageCache.store({ file: picture });
            if (key) break;
          }
        }
        for (const file of key ? [] : files.slice(0, 3)) {
          key = await embeddedCover(file.path);
          if (key) break;
        }
        await setImage(album, key);
        album.metadataUpdatedAt = new Date();
        await album.save();
      } catch (error) {
        log.warn(`Could not find a cover for "${album.title}"`, { error });
      }
    }

    // Artists: a picture in their folder, looked for again whenever their albums were
    const artists = await MediaItem.findAll({ where: { libraryId: library.id, type: "artist", ...(opts.regenerate ? {} : { metadataUpdatedAt: null }) } });
    for (const artist of artists) {
      const picture = await folderImage(artist.folderPath, ARTIST_NAMES);
      await setImage(artist, picture ? await ImageCache.store({ file: picture }) : null);
      artist.metadataUpdatedAt = new Date();
      await artist.save();
    }
    return albums.length;
  }

  /**
   * Give everything in the library its new default rating, after it was changed in the library settings.
   */
  export async function applyDefaultRating(library: Library) {
    await MediaItem.update({ ageRating: library.defaultAge() }, { where: { libraryId: library.id } });
  }
}

export default MusicLibrary;
