import type { StartUploadRequest, UploadInfo, UploadRules } from "@shared/uploads.ts";
import BaseApi from "./BaseApi.ts";
import { t } from "../i18n/I18n.ts";

export namespace UploadsApi {
  /**
   * A failed request, with the HTTP status (0 = no answer: the connection dropped) and, for a wrong offset, the
   * upload as the server has it.
   */
  export class RequestError extends Error {
    constructor(message: string, public readonly status: number, public readonly upload: UploadInfo | null = null) {
      super(message);
    }
  }

  export function rules() {
    return BaseApi.GET<UploadRules>("/uploads/rules");
  }

  /**
   * Whether uploads can go into `folder`, and why not.
   */
  export function check(libraryId: number, folder: string) {
    return BaseApi.GET<{ ok: boolean; message: string | null }>(`/uploads/check?libraryId=${libraryId}&folder=${encodeURIComponent(folder)}`);
  }

  /**
   * Uploads the server has, unfinished ones included.
   */
  export function list(libraryId?: number) {
    return BaseApi.GET<UploadInfo[]>(`/uploads${libraryId ? `?libraryId=${libraryId}` : ""}`);
  }

  /**
   * Start an upload, or get the unfinished one for the same file back.
   */
  export function start(data: StartUploadRequest) {
    return BaseApi.POST<UploadInfo>("/uploads", data);
  }

  export function get(id: string) {
    return BaseApi.GET<UploadInfo>(`/uploads/${id}`);
  }

  /**
   * Cancel an upload, or clear a finished one from the list.
   */
  export function remove(id: string) {
    return BaseApi.DELETE<void>(`/uploads/${id}`);
  }

  export function retry(id: string, replace?: boolean) {
    return BaseApi.POST<UploadInfo>(`/uploads/${id}/retry`, { replace });
  }

  /**
   * Send one piece of the file. XHR rather than `fetch`, because only XHR reports upload progress.
   * @param onProgress Bytes of this piece sent so far.
   * @throws `RequestError`.
   */
  export function sendPiece(id: string, offset: number, piece: Blob, onProgress: (sent: number) => void, signal: AbortSignal): Promise<UploadInfo> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `/api/uploads/${id}?offset=${offset}`);
      const headers = BaseApi.getHeaders(false) as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (e) => onProgress(e.loaded);
      xhr.onload = () => {
        let body: { message?: string; upload?: UploadInfo | null } | UploadInfo | null = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          // A reverse proxy's error page
        }
        if (xhr.status >= 200 && xhr.status < 300 && body) {
          resolve(body as UploadInfo);
          return;
        }
        const error = body as { message?: string; upload?: UploadInfo | null } | null;
        const message = error?.message ?? (xhr.status === 413 ? t("uploads.errors.tooLarge") : t("uploads.errors.status", { status: String(xhr.status), statusText: xhr.statusText }));
        reject(new RequestError(message, xhr.status, error?.upload ?? null));
      };
      xhr.onerror = () => reject(new RequestError(t("uploads.errors.connectionLost"), 0));
      xhr.ontimeout = xhr.onerror;
      xhr.onabort = () => reject(new DOMException("Cancelled", "AbortError"));
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
      xhr.send(piece);
    });
  }
}

export default UploadsApi;
