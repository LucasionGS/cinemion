import type { ItemSummary, MediaFileInfo } from "@shared/media.ts";
import { findLanguage } from "@shared/languages.ts";
import { router } from "./Router.tsx";
import { i18n, t } from "../i18n/I18n.ts";

/**
 * Tracks picked on a title's page before pressing Play. `undefined` fields use the file's defaults.
 */
export interface TrackChoice {
  fileId?: number;
  audioIndex?: number;
  /**
   * `null` = subtitles off.
   */
  subtitleIndex?: number | null;
}

const _choices = new Map<number, TrackChoice>();

/**
 * Remember tracks picked on a title's page, for the player to start with.
 */
export function chooseTracks(itemId: number, choice: TrackChoice) {
  _choices.set(itemId, { ..._choices.get(itemId), ...choice });
}

export function tracksFor(itemId: number): TrackChoice {
  return _choices.get(itemId) ?? {};
}

/**
 * The subtitle track that's on unless picked otherwise: a forced or default text track.
 * Picture subtitles are never on by default, since drawing them in means converting the video.
 */
export function defaultSubtitle(file: Pick<MediaFileInfo, "subtitles"> | undefined) {
  const text = file?.subtitles.filter((s) => !s.isImage) ?? [];
  return text.find((s) => s.isForced) ?? text.find((s) => s.isDefault) ?? null;
}

/**
 * Open the player for a movie or episode. It resumes where the profile left off unless `fromStart` is set.
 */
export function play(item: Pick<ItemSummary, "id">, opts?: { fromStart?: boolean }) {
  router.navigate(`/watch/${item.id}${opts?.fromStart ? "?from=start" : ""}`);
}

/**
 * "1:03:12" or "4:05", from seconds.
 */
export function formatClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * "1h 05m" or "32 min", from seconds.
 */
export function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return t("player.duration.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  return t("player.duration.hoursMinutes", { hours, minutes: String(minutes % 60).padStart(2, "0") });
}

/**
 * How much is left of a started movie or episode, like "32 min left". `null` when not started.
 */
export function timeLeft(item: Pick<ItemSummary, "runtime" | "userData">) {
  const position = item.userData?.position ?? 0;
  const progress = item.userData?.progress;
  if (!position || !progress) return null;
  const total = position / progress;
  return t("player.duration.left", { duration: formatDuration(total - position) });
}

/**
 * "S1 E3" for an episode, "Season 2" for a season.
 */
export function episodeLabel(item: Pick<ItemSummary, "type" | "seasonNumber" | "episodeNumber">) {
  if (item.type === "season") return item.seasonNumber === 0 ? t("player.episode.specials") : t("player.episode.season", { number: String(item.seasonNumber) });
  if (item.type !== "episode") return "";
  return item.seasonNumber === 0
    ? t("player.episode.special", { number: String(item.episodeNumber) })
    : t("player.episode.short", { season: String(item.seasonNumber), episode: String(item.episodeNumber) });
}

// The language table names these by script rather than by country
const SCRIPTS: Record<string, string> = { "zh-cn": "zh-Hans", "zh-tw": "zh-Hant" };
let _languageNames: { locale: string; names: Intl.DisplayNames } | null = null;

/**
 * The name of a language code or English name ("por", "pt", "Portuguese") in the interface's language, or the code
 * itself in capitals when unknown.
 */
export function displayLanguage(value: string | null | undefined): string | null {
  if (!value) return null;
  const language = findLanguage(value);
  if (!language) return value.toUpperCase();
  if (_languageNames?.locale !== i18n.locale) {
    _languageNames = { locale: i18n.locale, names: new Intl.DisplayNames([i18n.locale], { type: "language", languageDisplay: "standard" }) };
  }
  try {
    return _languageNames.names.of(SCRIPTS[language.code] ?? language.code) ?? language.name;
  } catch {
    return language.name;
  }
}
