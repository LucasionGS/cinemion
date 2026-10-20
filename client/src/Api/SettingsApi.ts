import type { MetadataSettings } from "@shared/api.ts";
import type { TaskInfo } from "@shared/media.ts";
import BaseApi from "./BaseApi.ts";

export namespace SettingsApi {
  export function getMetadata() {
    return BaseApi.GET<MetadataSettings>("/settings/metadata");
  }

  export function setMetadata(settings: Partial<MetadataSettings>) {
    return BaseApi.PUT<MetadataSettings>("/settings/metadata", settings);
  }

  /**
   * Background jobs that are running, like library scans.
   */
  export function tasks() {
    return BaseApi.GET<TaskInfo[]>("/settings/tasks");
  }
}

export default SettingsApi;
