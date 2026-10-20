import type { AppKeyInfo, IntegrationSettings, PathMapping } from "@shared/admin.ts";
import BaseApi from "./BaseApi.ts";

/**
 * Sonarr and Radarr, and keys for apps like Seerr and Homepage.
 */
export namespace IntegrationsApi {
  export function get() {
    return BaseApi.GET<IntegrationSettings>("/integrations");
  }

  export function setPathMappings(pathMappings: PathMapping[]) {
    return BaseApi.PUT<IntegrationSettings>("/integrations", { pathMappings });
  }

  /**
   * Make a new receiver address. The old one stops working.
   */
  export function newAddress() {
    return BaseApi.POST<IntegrationSettings>("/integrations/arr/token");
  }

  export function appKeys() {
    return BaseApi.GET<AppKeyInfo[]>("/integrations/keys");
  }

  /**
   * Make a key for an app. It gets the same access as the admin making it.
   */
  export function createAppKey(app: string) {
    return BaseApi.POST<AppKeyInfo>("/integrations/keys", { app });
  }

  /**
   * Remove a key. Returns the keys that are left.
   */
  export function removeAppKey(id: string) {
    return BaseApi.DELETE<AppKeyInfo[]>(`/integrations/keys/${id}`);
  }
}

export default IntegrationsApi;
