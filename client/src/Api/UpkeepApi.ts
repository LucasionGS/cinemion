import type { SpaceUsage, UpkeepOverview } from "@shared/upkeep.ts";
import BaseApi from "./BaseApi.ts";

/**
 * Settings › Upkeep.
 */
export namespace UpkeepApi {
  export function overview() {
    return BaseApi.GET<UpkeepOverview>("/upkeep");
  }

  export function space() {
    return BaseApi.GET<SpaceUsage>("/upkeep/space");
  }

  /**
   * Play every file through to find damaged ones, in the background.
   */
  export function checkAll(onlyNew = false) {
    return BaseApi.POST<UpkeepOverview>("/upkeep/check", { onlyNew });
  }

  export function checkFile(fileId: number) {
    return BaseApi.POST<{ problem: string | null }>(`/upkeep/files/${fileId}/check`);
  }
}

export default UpkeepApi;
