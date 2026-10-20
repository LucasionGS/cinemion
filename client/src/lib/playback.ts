import type { ItemSummary, MediaFileInfo } from "@shared/media.ts";
import { router } from "./Router.tsx";

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
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * How much is left of a started movie or episode, like "32 min left". `null` when not started.
 */
export function timeLeft(item: Pick<ItemSummary, "runtime" | "userData">) {
  const position = item.userData?.position ?? 0;
  const progress = item.userData?.progress;
  if (!position || !progress) return null;
  const total = position / progress;
  return `${formatDuration(total - position)} left`;
}

/**
 * "S1 E3" for an episode, "Season 2" for a season.
 */
export function episodeLabel(item: Pick<ItemSummary, "type" | "seasonNumber" | "episodeNumber">) {
  if (item.type === "season") return item.seasonNumber === 0 ? "Specials" : `Season ${item.seasonNumber}`;
  if (item.type !== "episode") return "";
  return item.seasonNumber === 0 ? `Special ${item.episodeNumber}` : `S${item.seasonNumber} E${item.episodeNumber}`;
}
