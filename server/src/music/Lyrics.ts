import fsp from "node:fs/promises";
import { type Lyrics as LyricsInfo, parseLrc } from "@shared/music.ts";
import Ffmpeg from "../lib/Ffmpeg.ts";
import type MediaFile from "../models/MediaFile.ts";

/**
 * Words to a track: an LRC file next to it (`Song.lrc` for `Song.flac`), or lyrics tags inside the file.
 * Read when asked for, since they're only needed while the track plays.
 */
export namespace Lyrics {
  // ID3 keeps lyrics as "lyrics-eng" and the like, Vorbis comments as LYRICS or UNSYNCEDLYRICS
  const LYRIC_TAG = /^(lyrics|unsyncedlyrics|uslt)/i;

  function fromText(text: string): LyricsInfo {
    const synced = parseLrc(text);
    // Plain lyrics keep their line breaks; LRC header lines like [ar:Artist] aren't words
    return synced ? { synced: synced.filter((l) => l.text), plain: null } : { synced: null, plain: text.trim() || null };
  }

  export async function read(file: MediaFile): Promise<LyricsInfo> {
    const lrc = await fsp.readFile(file.path.replace(/\.[^./\\]+$/, ".lrc"), "utf8").catch(() => null);
    if (lrc?.trim()) return fromText(lrc);

    const probe = await Ffmpeg.probe(file.path).catch(() => null);
    const tags = { ...probe?.format.tags, ...probe?.streams.find((s) => s.codec_type === "audio")?.tags };
    const text = Object.entries(tags).find(([key, value]) => LYRIC_TAG.test(key) && typeof value === "string" && value.trim())?.[1];
    return text ? fromText(text) : { synced: null, plain: null };
  }
}

export default Lyrics;
