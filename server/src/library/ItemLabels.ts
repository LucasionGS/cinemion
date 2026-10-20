import type { Palette } from "@shared/media.ts";
import type { WebhookItem } from "@shared/admin.ts";
import AppSystem from "../AppSystem.ts";
import { MediaItem } from "../models/index.ts";

/**
 * Names for movies and episodes outside their own pages: in the dashboard, the activity feed and webhooks.
 */
export namespace ItemLabels {
  export interface Label {
    /**
     * "Paper Moons", or "Saltwater Kings · S1 E3" for an episode.
     */
    title: string;
    /**
     * Same, without the dot, for sentences: "Saltwater Kings S1 E3".
     */
    inline: string;
    /**
     * The poster, or the show's poster for seasons and episodes.
     */
    poster: string | null;
    palette: Palette | null;
    show: MediaItem | null;
  }

  /**
   * "S1 E3", "S1 E1–E2" for multi-episode files, or "Special 1".
   */
  export function episodeCode(item: { seasonNumber: number | null; episodeNumber: number | null; episodeEnd?: number | null }) {
    const episode = `E${item.episodeNumber ?? "?"}${item.episodeEnd ? `–E${item.episodeEnd}` : ""}`;
    return item.seasonNumber === 0 ? `Special ${item.episodeNumber ?? "?"}` : `S${item.seasonNumber ?? "?"} ${episode}`;
  }

  /**
   * The show a season or episode belongs to.
   */
  export async function showOf(item: MediaItem) {
    if (item.type === "season") return item.parentId ? await MediaItem.findByPk(item.parentId) : null;
    if (item.type !== "episode" || !item.parentId) return null;
    const season = await MediaItem.findByPk(item.parentId, { attributes: ["parentId"] });
    return season?.parentId ? await MediaItem.findByPk(season.parentId) : null;
  }

  export async function describe(item: MediaItem): Promise<Label> {
    const show = await showOf(item);
    if (item.type === "episode") {
      const code = episodeCode(item);
      const showTitle = show?.title ?? "Unknown show";
      return { title: `${showTitle} · ${code}`, inline: `${showTitle} ${code}`, poster: show?.artwork.poster ?? null, palette: show?.palette ?? item.palette, show };
    }
    if (item.type === "season") {
      const showTitle = show?.title ?? "Unknown show";
      return { title: `${showTitle} · ${item.title}`, inline: `${showTitle} ${item.title}`, poster: item.artwork.poster ?? show?.artwork.poster ?? null, palette: show?.palette ?? item.palette, show };
    }
    return { title: item.title, inline: item.title, poster: item.artwork.poster, palette: item.palette, show: null };
  }

  /**
   * The item as webhook payloads describe it.
   */
  export async function forWebhook(item: MediaItem, show?: MediaItem | null): Promise<WebhookItem> {
    show = show !== undefined ? show : await showOf(item);
    const site = AppSystem.config.SITE_URL.replace(/\/+$/, "");
    return {
      id: item.id,
      type: item.type,
      title: item.title,
      year: item.year ?? show?.year ?? null,
      show: show?.title ?? null,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
      url: site ? `${site}/item/${item.id}` : null,
    };
  }
}

export default ItemLabels;
