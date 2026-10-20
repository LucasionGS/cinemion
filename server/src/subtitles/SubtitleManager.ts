import fsp from "node:fs/promises";
import Path from "node:path";
import type { SubtitleSearchResult, SubtitleSettings } from "@shared/playback.ts";
import { Setting, type MediaFile, MediaItem } from "../models/index.ts";
import Sidecars from "../library/Sidecars.ts";
import type SubtitleProvider from "./SubtitleProvider.ts";
import OpenSubtitlesProvider from "./providers/OpenSubtitlesProvider.ts";
import log from "../lib/Logger.ts";

/**
 * Subtitle search and downloads: settings, the providers, and saving files where the scanner finds them.
 */
export namespace SubtitleManager {
  export const DEFAULT_SETTINGS: SubtitleSettings = {
    openSubtitlesApiKey: Deno.env.get("OPENSUBTITLES_API_KEY") || null,
    openSubtitlesUsername: null,
    openSubtitlesPassword: null,
    languages: ["en"],
    saveNextToVideo: true,
  };

  const _providers: SubtitleProvider[] = [new OpenSubtitlesProvider()];

  export function provider(id: string) {
    return _providers.find((p) => p.id === id) ?? null;
  }

  /**
   * Full settings, password included. Never send this to a client; use `publicSettings`.
   */
  export async function settings(): Promise<SubtitleSettings> {
    const saved = await Setting.get<Partial<SubtitleSettings>>(Setting.Keys.SUBTITLES, {});
    return { ...DEFAULT_SETTINGS, ...saved, openSubtitlesApiKey: saved.openSubtitlesApiKey ?? DEFAULT_SETTINGS.openSubtitlesApiKey };
  }

  /**
   * Settings without the password, saying only whether one is saved.
   */
  export async function publicSettings(): Promise<SubtitleSettings> {
    const { openSubtitlesPassword, ...rest } = await settings();
    return { ...rest, hasOpenSubtitlesPassword: !!openSubtitlesPassword };
  }

  export async function saveSettings(next: SubtitleSettings) {
    await Setting.set(Setting.Keys.SUBTITLES, next);
  }

  /**
   * Whether any provider is set up for searching.
   */
  export async function isAvailable() {
    const s = await settings();
    return _providers.some((p) => p.isConfigured(s));
  }

  /**
   * The OpenSubtitles file hash: the size plus the 64-bit little-endian sums of the first and last 64 KB.
   * Subtitles made for the exact same file have the same hash, so their timing fits.
   */
  export async function fileHash(path: string): Promise<{ hash: string; size: number } | null> {
    const CHUNK = 65536;
    const file = await Deno.open(path, { read: true }).catch(() => null);
    if (!file) return null;
    try {
      const size = (await file.stat()).size;
      if (size < CHUNK * 2) return null;
      let sum = BigInt(size);
      const buffer = new Uint8Array(CHUNK);
      for (const offset of [0, size - CHUNK]) {
        await file.seek(offset, Deno.SeekMode.Start);
        let read = 0;
        while (read < CHUNK) {
          const n = await file.read(buffer.subarray(read));
          if (n === null) break;
          read += n;
        }
        const view = new DataView(buffer.buffer);
        for (let i = 0; i + 8 <= read; i += 8) sum += view.getBigUint64(i, true);
      }
      return { hash: (sum & 0xFFFFFFFFFFFFFFFFn).toString(16).padStart(16, "0"), size };
    } finally {
      file.close();
    }
  }

  /**
   * Search every set-up provider for subtitles of a movie or episode file.
   * @throws When no provider is set up, or all of them fail.
   */
  export async function search(file: MediaFile, opts: { language: string; query?: string; hearingImpaired: SubtitleProvider.Query["hearingImpaired"] }): Promise<SubtitleSearchResult[]> {
    const s = await settings();
    const providers = _providers.filter((p) => p.isConfigured(s));
    if (providers.length === 0) throw new Error("Subtitle search isn't set up yet. An admin can add an OpenSubtitles API key in Settings › Subtitles.");

    const item = file.itemId ? await MediaItem.findByPk(file.itemId) : null;
    if (!item) throw new Error("This file isn't matched to a movie or episode yet.");
    const show = item.type === "episode" && item.parentId ? await MediaItem.findByPk((await MediaItem.findByPk(item.parentId))?.parentId ?? -1) : null;
    const customText = opts.query?.trim() || null;
    const hash = customText ? null : await fileHash(file.path);

    const query: SubtitleProvider.Query = {
      type: item.type === "episode" ? "episode" : "movie",
      languages: [opts.language],
      text: customText ?? (show?.title ?? item.title),
      year: customText ? null : (show?.year ?? item.year),
      // A typed search means the automatic match was wrong; search by text only
      imdbId: customText ? null : item.externalIds.imdb ?? null,
      tmdbId: customText ? null : item.type === "movie" ? item.externalIds.tmdb ?? null : null,
      parentImdbId: customText ? null : show?.externalIds.imdb ?? null,
      parentTmdbId: customText ? null : show?.externalIds.tmdb ?? null,
      season: item.seasonNumber,
      episode: item.episodeNumber,
      hash: hash?.hash ?? null,
      byteSize: hash?.size ?? null,
      hearingImpaired: opts.hearingImpaired,
    };

    const results: SubtitleSearchResult[] = [];
    const errors: Error[] = [];
    for (const p of providers) {
      try {
        results.push(...await p.search(query, s));
      } catch (error) {
        log.warn(`Subtitle search on ${p.name} failed`, { error });
        errors.push(error as Error);
      }
    }
    if (results.length === 0 && errors.length > 0) throw errors[0];
    return results;
  }

  /**
   * Where a download for `file` goes: next to the video when allowed and writable, else the config folder.
   */
  async function targetFolder(file: MediaFile, nextToVideo: boolean) {
    const folder = Path.dirname(file.path);
    if (nextToVideo) {
      const probe = Path.join(folder, `.cinemion-write-test-${crypto.randomUUID()}`);
      const writable = await fsp.writeFile(probe, "").then(() => true).catch(() => false);
      if (writable) {
        await fsp.rm(probe, { force: true });
        return folder;
      }
    }
    const fallback = Path.join(Sidecars.downloadsDir, String(file.id));
    await fsp.mkdir(fallback, { recursive: true });
    return fallback;
  }

  /**
   * Download a search result, save it as a subtitle file for `file`, and return its track index.
   * @throws When the provider fails or the file can't be saved.
   */
  export async function download(file: MediaFile, result: { provider: string; id: string; language: string; isHearingImpaired: boolean }) {
    const p = provider(result.provider);
    if (!p) throw new Error(`Unknown subtitle provider "${result.provider}".`);
    const s = await settings();
    const { content, format } = await p.download(result.id, s);
    if (content.length === 0) throw new Error("The downloaded subtitle file is empty.");

    const folder = await targetFolder(file, s.saveNextToVideo);
    const base = Path.basename(file.path, Path.extname(file.path));
    const tags = [result.language, result.isHearingImpaired ? "sdh" : null].filter(Boolean).join(".");
    // Example: "Movie (2024).en.sdh.srt", then "Movie (2024).en.sdh.2.srt" if that's taken
    let target = Path.join(folder, `${base}.${tags}.${format}`);
    for (let n = 2; await fsp.stat(target).then(() => true).catch(() => false); n++) {
      target = Path.join(folder, `${base}.${tags}.${n}.${format}`);
    }
    await fsp.writeFile(target, content);
    log.info("Downloaded subtitles", { file: file.path, saved: target, provider: p.name });

    await Sidecars.refresh(file);
    const index = file.sidecars.findIndex((sc) => sc.path === target);
    if (index < 0) throw new Error("The subtitles were saved, but couldn't be found again. Scan the library to pick them up.");
    return file.allSubtitles().find((t) => t.external && file.sidecarFor(t.index)?.path === target)!;
  }
}

export default SubtitleManager;
