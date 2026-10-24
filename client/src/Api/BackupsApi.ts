import type { BackupInfo, BackupSettingsUpdate, BackupsOverview, RestoreStatus } from "@shared/admin.ts";
import { t } from "../i18n/I18n.ts";
import BaseApi from "./BaseApi.ts";

/**
 * Backups in Settings, and restoring one in the setup wizard.
 */
export namespace BackupsApi {
  /**
   * A restore that couldn't start. `needsPassword` is set when the backup is protected and no password was given.
   */
  export class RestoreError extends Error {
    constructor(message: string, public readonly needsPassword: boolean) {
      super(message);
    }
  }

  export function overview() {
    return BaseApi.GET<BackupsOverview>("/backups");
  }

  /**
   * Start making a backup. It shows up in `overview()` when it's done.
   */
  export function make() {
    return BaseApi.POST<BackupsOverview>("/backups");
  }

  export function updateSettings(changes: BackupSettingsUpdate) {
    return BaseApi.PUT<BackupsOverview>("/backups/settings", changes);
  }

  export function remove(name: string) {
    return BaseApi.DELETE<BackupsOverview>(`/backups/${encodeURIComponent(name)}`);
  }

  /**
   * Save a backup through the browser, with a link that works for a few minutes.
   */
  export async function download(name: string) {
    const { url } = await BaseApi.POST<{ url: string }>(`/backups/${encodeURIComponent(name)}/link`);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
  }

  //#region Setup

  /**
   * Backups found in the backup folder of a server that isn't set up yet.
   */
  export function found() {
    return BaseApi.GET<{ folder: string; backups: BackupInfo[] }>("/setup/backups");
  }

  export function restoreStatus() {
    return BaseApi.GET<RestoreStatus>("/setup/restore");
  }

  function failure(body: unknown, fallback: string) {
    const data = body as { message?: string; needsPassword?: boolean } | null;
    return new RestoreError(data?.message || fallback, !!data?.needsPassword);
  }

  /**
   * Restore a backup from the server's backup folder.
   * @throws `RestoreError`
   */
  export async function restore(name: string, password: string | null): Promise<RestoreStatus> {
    let res: Response;
    try {
      res = await fetch("/api/setup/restore", { method: "POST", headers: BaseApi.getHeaders(), body: JSON.stringify({ name, password }) });
    } catch {
      throw new RestoreError(t("api.unreachable"), false);
    }
    if (!res.ok) throw failure(await res.json().catch(() => null), res.statusText);
    return await res.json();
  }

  /**
   * Send a backup file and restore it. Uses XHR for the upload progress, since backups can be large.
   * @param onProgress Told how much has been sent, 0 to 1.
   * @throws `RestoreError`
   */
  export function restoreUpload(file: File, password: string | null, onProgress: (sent: number) => void): Promise<RestoreStatus> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/setup/restore/upload");
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      if (password) xhr.setRequestHeader("X-Backup-Password", encodeURIComponent(password));
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      };
      xhr.onerror = () => reject(new RestoreError(t("api.unreachable"), false));
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          // Not JSON; the status text says enough
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as RestoreStatus);
        else reject(failure(body, xhr.statusText));
      };
      xhr.send(file);
    });
  }

  //#endregion
}

export default BackupsApi;
