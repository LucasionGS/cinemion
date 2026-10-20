import type { IntegrationSettings, PathMapping } from "@shared/admin.ts";
import BaseApi from "./BaseApi.ts";

/**
 * Sonarr and Radarr.
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
}

export default IntegrationsApi;
