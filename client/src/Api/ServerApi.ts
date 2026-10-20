import type { FsListing, LoginResponse, ServerInfo, SetupRequest } from "@shared/api.ts";
import BaseApi from "./BaseApi.ts";

export namespace ServerApi {
  export function getInfo() {
    return BaseApi.GET<ServerInfo>("/server");
  }

  /**
   * Finish the first-run setup. Signs the new admin in.
   */
  export function completeSetup(data: SetupRequest) {
    return BaseApi.POST<LoginResponse>("/setup", data);
  }

  /**
   * List folders inside `path`, or the allowed media roots when `path` is `null`.
   */
  export function listFolders(path: string | null) {
    return BaseApi.GET<FsListing>(`/fs${path ? `?path=${encodeURIComponent(path)}` : ""}`);
  }
}

export default ServerApi;
