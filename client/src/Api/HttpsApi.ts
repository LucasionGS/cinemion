import type { HttpsSettingsUpdate, HttpsStatus } from "@shared/https.ts";
import BaseApi from "./BaseApi.ts";

/**
 * Settings › HTTPS.
 */
export namespace HttpsApi {
  export function status() {
    return BaseApi.GET<HttpsStatus>("/https");
  }

  /**
   * Change the settings. Answers once https was started with them (or couldn't be).
   */
  export function update(changes: HttpsSettingsUpdate) {
    return BaseApi.PUT<HttpsStatus>("/https", changes);
  }

  /**
   * Get or make a new certificate now.
   */
  export function renew() {
    return BaseApi.POST<HttpsStatus>("/https/renew");
  }

  /**
   * Where devices download Cinemion's certificate authority. Works without signing in.
   */
  export const AUTHORITY_URL = "/api/https/cinemion-ca.crt";
}

export default HttpsApi;
