import type { SaveTraktAppRequest, TraktAppSettings, TraktImportResult, TraktLinkPoll, TraktLinkStart, TraktStatus } from "@shared/trakt.ts";
import BaseApi from "./BaseApi.ts";

/**
 * Trakt: the server's app (admins), and the signed-in profile's own link.
 */
export namespace TraktApi {
  export function status() {
    return BaseApi.GET<TraktStatus>("/trakt");
  }

  /**
   * Start linking: returns a code to enter on Trakt's site.
   */
  export function startLink() {
    return BaseApi.POST<TraktLinkStart>("/trakt/link");
  }

  export function poll() {
    return BaseApi.POST<TraktLinkPoll>("/trakt/link/poll");
  }

  export function unlink() {
    return BaseApi.DELETE<void>("/trakt");
  }

  /**
   * Mark what the profile watched on Trakt as watched here.
   */
  export function importHistory() {
    return BaseApi.POST<TraktImportResult>("/trakt/import");
  }

  export function appSettings() {
    return BaseApi.GET<TraktAppSettings>("/integrations/trakt");
  }

  export function saveApp(data: SaveTraktAppRequest) {
    return BaseApi.PUT<TraktAppSettings>("/integrations/trakt", data);
  }
}

export default TraktApi;
