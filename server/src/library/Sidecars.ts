import fsp from "node:fs/promises";
import Path from "node:path";
import { findLanguage } from "@shared/languages.ts";
import AppSystem from "../AppSystem.ts";
import type MediaFile from "../models/MediaFile.ts";
import NameParser from "./NameParser.ts";

/**
 * Subtitle files that belong to a video: next to it with the same name, in a "Subs" folder beside it,
 * or downloaded into the config folder when the media folder is read-only.
 */
export namespace Sidecars {
  /**
   * Downloaded subtitles that couldn't be saved next to their video, one folder per media file id.
   */
  export const downloadsDir = Path.join(AppSystem.config.CONFIG_DIR, "subtitles");

  const CODECS: Record<string, string> = { ".srt": "subrip", ".vtt": "webvtt", ".ass": "ass", ".ssa": "ssa" };
  const SUB_FOLDERS = ["subs", "subtitles"];

  /**
   * Whether `path` is a subtitle file Cinemion can use.
   */
  export function isSubtitle(path: string) {
    return Path.extname(path).toLowerCase() in CODECS;
  }

  /**
   * Read language and flags from the part of a subtitle name after the video's name.
   */
  // Example: "Movie (2024).en.forced.srt" -> tags ["en", "forced"]
  //          "Movie (2024).English.SDH.srt" -> tags ["English", "SDH"]
  export function parseTags(tags: string[]): Omit<MediaFile.Sidecar, "path" | "codec"> {
    let language: string | null = null;
    let isForced = false;
    let isHearingImpaired = false;
    const rest: string[] = [];
    for (const tag of tags) {
      const lower = tag.toLowerCase();
      if (lower === "forced" || lower === "foreign") isForced = true;
      else if (["sdh", "hi", "cc"].includes(lower) && (language || lower !== "hi")) isHearingImpaired = true;
      else if (!language && findLanguage(tag)) language = findLanguage(tag)!.code;
      else if (lower !== "default" && tag) rest.push(tag);
    }
    return { language, title: rest.length ? rest.join(" ") : null, isForced, isHearingImpaired };
  }

  /**
   * Subtitle files for one video.
   */
  export async function find(file: Pick<MediaFile, "id" | "path">): Promise<MediaFile.Sidecar[]> {
    const folder = Path.dirname(file.path);
    const base = Path.basename(file.path, Path.extname(file.path));
    const found: MediaFile.Sidecar[] = [];

    async function look(dir: string, requireName: boolean) {
      const names = await fsp.readdir(dir).catch(() => [] as string[]);
      for (const name of names.sort()) {
        const ext = Path.extname(name).toLowerCase();
        if (!(ext in CODECS)) continue;
        const stem = name.slice(0, -ext.length);
        let tags: string[];
        if (stem === base) tags = [];
        else if (stem.startsWith(`${base}.`)) tags = stem.slice(base.length + 1).split(".");
        // In a Subs folder of a movie folder, files are often just "English.srt" or "2_English.srt"
        else if (!requireName) tags = stem.replace(/^\d+[_ -]/, "").split(/[._ ]/);
        else continue;
        found.push({ path: Path.join(dir, name), codec: CODECS[ext], ...parseTags(tags) });
      }
    }

    await look(folder, true);
    const entries = await fsp.readdir(folder, { withFileTypes: true }).catch(() => []);
    // Unnamed files in a Subs folder only clearly belong to a video when it's the only one there (a movie folder)
    const onlyVideo = entries.filter((e) => e.isFile() && NameParser.isVideo(e.name)).length <= 1;
    for (const entry of entries) {
      if (!entry.isDirectory() || !SUB_FOLDERS.includes(entry.name.toLowerCase())) continue;
      const subs = Path.join(folder, entry.name);
      await look(subs, !onlyVideo);
      // Release style: Subs/<video name>/2_English.srt
      await look(Path.join(subs, base), false);
    }
    await look(Path.join(downloadsDir, String(file.id)), false);

    // The same file can be reached twice (a Subs folder next to a single video); keep one
    return found.filter((s, i) => found.findIndex((o) => o.path === s.path) === i);
  }

  /**
   * Look for subtitle files again and save them on the media file. Returns whether anything changed.
   */
  export async function refresh(file: MediaFile) {
    const sidecars = await find(file);
    if (JSON.stringify(sidecars) === JSON.stringify(file.sidecars)) return false;
    file.sidecars = sidecars;
    await file.save();
    return true;
  }
}

export default Sidecars;
