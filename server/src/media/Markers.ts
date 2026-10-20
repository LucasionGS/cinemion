import { Op } from "sequelize";
import type { Marker } from "@shared/playback.ts";
import AppSystem from "../AppSystem.ts";
import { MediaFile, MediaItem } from "../models/index.ts";
import Fingerprint from "./Fingerprint.ts";
import Tasks from "../lib/Tasks.ts";
import log from "../lib/Logger.ts";

/**
 * Finds intros and credits, for "Skip intro" and starting the next episode when the credits roll. Chapters named
 * like "Intro" or "Credits" are used as they are; otherwise the episodes of a season are compared, since they share
 * their opening and closing music.
 */
export namespace Markers {
  /**
   * Bump to look at every file again after the detection changes.
   */
  export const VERSION = 1;
  // How much of the start and end of an episode is searched. Unit is in seconds.
  const HEAD_SECONDS = 600;
  const TAIL_SECONDS = 480;
  // An intro is at least this long, at most this long, and starts in the first third of the episode
  const MIN_INTRO = 12;
  const MAX_INTRO = 180;
  const MIN_CREDITS = 12;
  // Credits ending this close to the end run to the end; a scene after them is kept watchable
  const CREDITS_TO_END = 20;

  // Example chapter titles: "Intro", "Opening Credits", "OP", "Ending", "End Credits", "ED"
  const INTRO_CHAPTER = /^(intro|opening|op|title sequence|opening (credits|theme|titles))$/i;
  const CREDITS_CHAPTER = /^(credits|end credits|ending|ending credits|ed|outro|closing credits)$/i;

  export function taskId(libraryId: number) {
    return `markers:${libraryId}`;
  }

  /**
   * Intros and credits from the file's chapters.
   */
  export async function fromChapters(path: string): Promise<Marker[]> {
    // Example output: {"chapters":[{"start_time":"0.000000","end_time":"92.000000","tags":{"title":"Intro"}}]}
    const result = await new Deno.Command(AppSystem.config.FFPROBE_PATH, {
      args: ["-v", "error", "-show_chapters", "-of", "json", path],
      stdout: "piped",
      stderr: "null",
    }).output().catch(() => null);
    if (!result?.success) return [];
    let chapters: { start_time?: string; end_time?: string; tags?: { title?: string } }[] = [];
    try {
      chapters = JSON.parse(new TextDecoder().decode(result.stdout)).chapters ?? [];
    } catch {
      return [];
    }
    const markers: Marker[] = [];
    for (const chapter of chapters) {
      const title = chapter.tags?.title?.trim() ?? "";
      const start = parseFloat(chapter.start_time ?? "");
      const end = parseFloat(chapter.end_time ?? "");
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const kind = INTRO_CHAPTER.test(title) ? "intro" : CREDITS_CHAPTER.test(title) ? "credits" : null;
      if (kind && !markers.some((m) => m.kind === kind)) markers.push({ kind, start, end, source: "chapters" });
    }
    return markers;
  }

  interface Episode {
    file: MediaFile;
    duration: number;
    head: Fingerprint.Print | null;
    tail: Fingerprint.Print | null;
  }

  async function prints(file: MediaFile): Promise<Episode> {
    const duration = file.duration ?? 0;
    // Short videos split in half, so the start and end searches don't overlap
    const head = Math.min(HEAD_SECONDS, duration * 0.5);
    const tail = Math.min(TAIL_SECONDS, duration * 0.4);
    const headSamples = duration > 0 ? await Fingerprint.decode(file.path, 0, head) : null;
    const tailSamples = duration > 0 ? await Fingerprint.decode(file.path, duration - tail, tail) : null;
    return {
      file,
      duration,
      head: headSamples ? Fingerprint.compute(headSamples, 0) : null,
      tail: tailSamples ? Fingerprint.compute(tailSamples, duration - tail) : null,
    };
  }

  /**
   * The intro of `a`, from the music it shares with `b` near the start.
   */
  export function introFrom(a: Fingerprint.Print, b: Fingerprint.Print, duration: number): Marker | null {
    const match = Fingerprint.longestMatch(a, b, MIN_INTRO);
    if (!match) return null;
    const length = match.aEnd - match.aStart;
    if (length > MAX_INTRO || match.aStart > duration / 3) return null;
    return { kind: "intro", start: round(match.aStart), end: round(match.aEnd), source: "audio" };
  }

  /**
   * The credits of `a`, from the music it shares with `b` near the end.
   */
  export function creditsFrom(a: Fingerprint.Print, b: Fingerprint.Print, duration: number): Marker | null {
    const match = Fingerprint.longestMatch(a, b, MIN_CREDITS);
    if (!match) return null;
    const end = duration - match.aEnd <= CREDITS_TO_END ? duration : match.aEnd;
    return { kind: "credits", start: round(match.aStart), end: round(end), source: "audio" };
  }

  function round(seconds: number) {
    return Math.round(seconds * 10) / 10;
  }

  /**
   * Look at every episode of a season: chapters first, then their music against the episodes next to them.
   */
  async function analyzeSeason(seasonId: number) {
    const episodes = await MediaItem.findAll({ where: { parentId: seasonId, type: "episode" }, order: [["episodeNumber", "ASC"]] });
    const files: MediaFile[] = [];
    for (const episode of episodes) {
      const file = await MediaFile.findOne({ where: { itemId: episode.id }, order: [["path", "ASC"]] });
      if (file) files.push(file);
    }
    // One episode has nothing to compare with
    const list: Episode[] = [];
    for (const file of files) list.push(files.length > 1 ? await prints(file) : { file, duration: file.duration ?? 0, head: null, tail: null });

    for (const [i, episode] of list.entries()) {
      const markers = await fromChapters(episode.file.path);
      // The next episode first, then the one before: whichever shares the music
      const neighbours = [list[i + 1], list[i - 1]].filter((n): n is Episode => !!n);
      if (!markers.some((m) => m.kind === "intro") && episode.head) {
        for (const other of neighbours) {
          const intro = other.head ? introFrom(episode.head, other.head, episode.duration) : null;
          if (intro) {
            markers.push(intro);
            break;
          }
        }
      }
      if (!markers.some((m) => m.kind === "credits") && episode.tail) {
        for (const other of neighbours) {
          const credits = other.tail ? creditsFrom(episode.tail, other.tail, episode.duration) : null;
          if (credits) {
            markers.push(credits);
            break;
          }
        }
      }
      await episode.file.update({ markers, markersVersion: VERSION });
    }
  }

  /**
   * Find intros and credits in a library, in the background. Without `redo`, only files not looked at yet.
   */
  export function queueLibrary(libraryId: number, opts?: { redo?: boolean }) {
    opts ??= {};
    const redo = !!opts.redo;
    return Tasks.run(taskId(libraryId), "Finding intros and credits", { libraryId, queue: "markers" }, async (task) => {
      const files = await MediaFile.findAll({ where: { libraryId, ...(redo ? {} : { markersVersion: { [Op.lt]: VERSION } }) } });
      if (files.length === 0) return;
      const items = new Map((await MediaItem.findAll({ where: { id: files.map((f) => f.itemId).filter((id): id is number => id !== null) }, attributes: ["id", "type", "parentId"] })).map((i) => [i.id, i]));

      // Episodes are compared within their season; everything else only has chapters to go on
      const seasons = new Set<number>();
      const others: MediaFile[] = [];
      for (const file of files) {
        const item = file.itemId ? items.get(file.itemId) : undefined;
        if (item?.type === "episode" && item.parentId) seasons.add(item.parentId);
        else others.push(file);
      }

      const total = seasons.size + others.length;
      let done = 0;
      for (const seasonId of seasons) {
        task.update(`Season ${done + 1} of ${seasons.size}`, done / total);
        try {
          await analyzeSeason(seasonId);
        } catch (error) {
          log.warn("Could not look for intros in a season", { seasonId, error });
        }
        done++;
      }
      for (const file of others) {
        task.update("Reading chapters", done / total);
        await file.update({ markers: await fromChapters(file.path), markersVersion: VERSION }).catch(() => { });
        done++;
      }
      log.info("Looked for intros and credits", { libraryId, seasons: seasons.size, files: others.length });
    }).catch(() => { });
  }
}

export default Markers;
