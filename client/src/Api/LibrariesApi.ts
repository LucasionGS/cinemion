import { useEffect, useState } from "react";
import type { CreateLibraryRequest, LibraryInfo } from "@shared/api.ts";
import BaseApi from "./BaseApi.ts";

export namespace LibrariesApi {
  export function list() {
    return BaseApi.GET<LibraryInfo[]>("/libraries");
  }

  export function create(data: CreateLibraryRequest) {
    return BaseApi.POST<LibraryInfo>("/libraries", data);
  }

  export function remove(id: number) {
    return BaseApi.DELETE<void>(`/libraries/${id}`);
  }

  /**
   * Scan now. With `refresh`, details are fetched again for everything, not just new titles.
   */
  export function scan(id: number, refresh = false) {
    return BaseApi.POST<LibraryInfo>(`/libraries/${id}/scan`, { refresh });
  }

  /**
   * Libraries the signed-in user can see.
   */
  export function useLibraries() {
    const [libraries, setLibraries] = useState<LibraryInfo[] | null>(null);
    useEffect(() => {
      list().then(setLibraries).catch(() => setLibraries([]));
    }, []);
    return libraries;
  }
}

export default LibrariesApi;
