import Path from "node:path";
import { Op } from "sequelize";
import type { SubtitleSearchResult, SubtitleSettings } from "@shared/playback.ts";
import { findLanguage, languageName } from "@shared/languages.ts";
import { Library, MediaFile } from "../models/index.ts";
import SubtitleManager from "./SubtitleManager.ts";
import type SubtitleProvider from "./SubtitleProvider.ts";
import Events from "../integrations/Events.ts";
import Tasks from "../lib/Tasks.ts";
import log from "../lib/Logger.ts";

/**
 * Automatic subtitle downloads: movies and episodes without subtitles in one of the chosen languages get the best
 * one found. New files are looked at after each scan; a daily run tries again for what's still missing, less often
 * each time, so free daily download limits aren't spent on the same files over and over.
 */
export namespace SubtitleAutomation {
  /**
   * Days to wait after each search that found nothing; after the last, the file isn't searched again.
   */
  const RETRY_DAYS = [1, 3, 7, 14, 30, 30];
  const DAY = 24 * 60 * 60 * 1000;
  // A pause between searches, to be kind to the subtitle sites
  const PAUSE_MS = 1500;
  // Results not worth downloading without someone choosing them
  const SKIPPED_NOTES = ["Translated by AI", "Only the foreign-language parts"];

  /**
   * Whether `file` already has subtitles in `language` (ISO 639-1). Forced tracks only cover foreign parts, so
   * they don't count.
   */
  export function hasLanguage(file: MediaFile, language: string) {
    const base = (code: string) => code.split("-")[0];
    return file.allSubtitles().some((t) => !t.isForced && base(findLanguage(t.language)?.code ?? "") === base(language));
  }

  /**
   * Whether `file` is due a search for `language`: never searched, or the wait after the last search is over.
   */
  export function isDue(file: MediaFile, language: string, now = Date.now()) {
    const record = file.subtitleSearches?.[language];
    if (!record) return true;
    if (record.found || record.attempts > RETRY_DAYS.length) return false;
    return now - record.at >= RETRY_DAYS[Math.min(record.attempts, RETRY_DAYS.length) - 1] * DAY;
  }

  /**
   * The results worth downloading, best first: made for this exact file, not for the hard of hearing, from the
   * first provider in the search order, then the most downloaded. Results in another language are left out, in
   * case a site sends more than it was asked for.
   * @param language ISO 639-1.
   * @param order Provider ids in search order.
   */
  export function rank(results: SubtitleSearchResult[], language: string, order: string[]) {
    const base = (code: string) => code.split("-")[0];
    return results
      .filter((r) => base(r.language) === base(language) && !r.notes.some((n) => SKIPPED_NOTES.includes(n)))
      .sort((a, b) =>
        Number(b.matchesFile) - Number(a.matchesFile)
        || Number(a.isHearingImpaired) - Number(b.isHearingImpaired)
        || order.indexOf(a.provider) - order.indexOf(b.provider)
        || b.downloads - a.downloads
      );
  }

  function isLimit(error: unknown) {
    return /limit|too many requests/i.test((error as Error)?.message ?? "");
  }

  /**
   * Look for missing subtitles in the background. Returns the running run if there is one.
   * @param opts.libraryId Only that library's files that were never searched, like right after a scan.
   * @param opts.force Run even when automatic downloads are off, and search files whose wait isn't over.
   */
  export function queue(opts?: { libraryId?: number; force?: boolean }) {
    opts ??= {};
    const id = `subtitles-auto:${opts.libraryId ?? "all"}`;
    return Tasks.run(id, "Downloading subtitles", { queue: "subtitles", ...(opts.libraryId ? { libraryId: opts.libraryId } : {}) }, (task) => run(task, opts!));
  }

  async function run(task: Tasks.Handle, opts: { libraryId?: number; force?: boolean }) {
    const settings = await SubtitleManager.settings();
    if (!settings.autoDownload && !opts.force) return;
    const providers = SubtitleManager.configured(settings);
    if (providers.length === 0) {
      log.info("Automatic subtitle downloads are on, but no subtitle site is set up in Settings › Subtitles");
      return;
    }

    // Movies and episodes only; home videos and music have no subtitles to find
    const libraries = await Library.findAll({ where: { type: ["movies", "shows"], ...(opts.libraryId ? { id: opts.libraryId } : {}) }, attributes: ["id"] });
    if (libraries.length === 0) return;
    const files = await MediaFile.findAll({ where: { libraryId: libraries.map((l) => l.id), itemId: { [Op.ne]: null } }, order: [["id", "DESC"]] });
    const now = Date.now();
    const work = files.flatMap((file) => settings.languages
      .filter((language) => !hasLanguage(file, language))
      .filter((language) => opts.libraryId ? !file.subtitleSearches?.[language] : opts.force || isDue(file, language, now))
      .map((language) => ({ file, language })));
    if (work.length === 0) return;

    const exhausted = new Set<string>();
    const downloaded: { file: MediaFile; language: string }[] = [];
    for (const [i, { file, language }] of work.entries()) {
      if (providers.every((p) => exhausted.has(p.id))) {
        log.info("Every subtitle site's download limit is used up; the rest is tried again tomorrow", { left: work.length - i });
        break;
      }
      task.update(`${i + 1} of ${work.length}: ${Path.basename(file.path)} (${languageName(language)})`, i / work.length);
      let found = false;
      try {
        found = await findAndDownload(file, language, settings, providers, exhausted);
      } catch (error) {
        log.warn(`Could not look for subtitles for ${file.path}`, { error });
      }
      const previous = file.subtitleSearches?.[language];
      file.subtitleSearches = { ...file.subtitleSearches, [language]: { at: Date.now(), attempts: (previous?.attempts ?? 0) + 1, found } };
      await file.save();
      if (found) downloaded.push({ file, language });
      if (i < work.length - 1) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    }

    for (const { file, language } of downloaded) await SubtitleManager.report(file, languageName(language) ?? language, null, downloaded.length <= 5);
    if (downloaded.length > 5) Events.activity({ kind: "subtitles", message: `${downloaded.length} subtitles downloaded automatically, for ${new Set(downloaded.map((d) => d.file.itemId)).size} videos` });
    log.info("Automatic subtitle run finished", { searched: work.length, downloaded: downloaded.length });
  }

  /**
   * Search every provider not out of downloads, and download the best result. Returns whether one was saved.
   */
  async function findAndDownload(file: MediaFile, language: string, settings: SubtitleSettings, providers: SubtitleProvider[], exhausted: Set<string>) {
    const query = await SubtitleManager.queryFor(file, { language, hearingImpaired: "include" });
    const results: SubtitleSearchResult[] = [];
    for (const p of providers) {
      if (exhausted.has(p.id)) continue;
      try {
        results.push(...await p.search(query, settings));
      } catch (error) {
        if (isLimit(error)) exhausted.add(p.id);
        else log.warn(`Subtitle search on ${p.name} failed`, { error });
      }
    }
    // A failed download (a broken zip, a limit) moves on to the next best, up to a few
    for (const result of rank(results, language, providers.map((p) => p.id)).slice(0, 3)) {
      if (exhausted.has(result.provider)) continue;
      try {
        await SubtitleManager.download(file, result);
        return true;
      } catch (error) {
        if (isLimit(error)) exhausted.add(result.provider);
        else log.warn(`Downloading subtitles from ${result.provider} failed`, { file: file.path, error });
      }
    }
    return false;
  }
}

export default SubtitleAutomation;
