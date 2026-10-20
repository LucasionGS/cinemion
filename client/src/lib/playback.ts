import type { ItemSummary } from "@shared/media.ts";
import { toasts } from "./Toasts.ts";

/**
 * Start playing a movie or episode. The player itself arrives with playback support;
 * until then this explains why nothing happens.
 */
export function play(item: Pick<ItemSummary, "id" | "title">, opts?: { fromStart?: boolean }) {
  void opts;
  toasts.show({ title: `Playing ${item.title} isn't possible yet`, description: "The player is being built next." });
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
