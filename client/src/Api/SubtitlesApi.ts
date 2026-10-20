import type { SubtitleDownloadRequest, SubtitleSearchResult, SubtitleSettings } from "@shared/playback.ts";
import type { SubtitleTrack } from "@shared/media.ts";
import BaseApi from "./BaseApi.ts";

export namespace SubtitlesApi {
  export function getSettings() {
    return BaseApi.GET<SubtitleSettings>("/subtitles/settings");
  }

  export function setSettings(settings: Partial<SubtitleSettings>) {
    return BaseApi.PUT<SubtitleSettings>("/subtitles/settings", settings);
  }

  export function search(fileId: number, opts: { language: string; query?: string; hearingImpaired?: "include" | "exclude" | "only" }) {
    const params = new URLSearchParams({ fileId: String(fileId), language: opts.language, hearingImpaired: opts.hearingImpaired ?? "include" });
    if (opts.query) params.set("query", opts.query);
    return BaseApi.GET<SubtitleSearchResult[]>(`/subtitles/search?${params}`);
  }

  /**
   * Download a search result and save it for the file. Returns the new subtitle track.
   */
  export function download(request: SubtitleDownloadRequest) {
    return BaseApi.POST<SubtitleTrack>("/subtitles/download", request);
  }
}

export default SubtitlesApi;
