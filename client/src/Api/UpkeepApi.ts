import type { MissingOverview, SpaceUsage, UpkeepOverview } from "@shared/upkeep.ts";
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

  export function missing() {
    return BaseApi.GET<MissingOverview>("/upkeep/missing");
  }

  /**
   * Look up every show's episode list, in the background.
   */
  export function lookUpMissing() {
    return BaseApi.POST<{ started: boolean }>("/upkeep/missing/lookup");
  }

  export function checkFile(fileId: number) {
    return BaseApi.POST<{ problem: string | null }>(`/upkeep/files/${fileId}/check`);
  }
}

export default UpkeepApi;
