import type { LibraryType } from "./api.ts";

/**
 * Types for uploading media from the browser into a library folder. A file goes up in pieces into a temporary folder
 * on the server, so a dropped connection, a reload or a server restart only costs the piece that was in flight. Once
 * it's all there, the server moves it into the library, or unpacks it when it's a zip file.
 */

/**
 * `uploading`: waiting for (more) pieces. `processing`: complete, being moved or unpacked. `done` and `failed` are
 * kept for a day so the page can show what happened.
 */
export type UploadStatus = "uploading" | "processing" | "done" | "failed";

export interface StartUploadRequest {
  libraryId: number;
  /**
   * Existing folder inside one of the library's folders.
   */
  folder: string;
  /**
   * Where the file goes inside `folder`, with `/` between folders, like `Season 1/Episode 1.mkv`. Missing folders are
   * made.
   */
  path: string;
  /**
   * Unit is in bytes.
   */
  size: number;
  /**
   * The file's last-modified time in ms. With the name, size and `fingerprint` it recognises the same file when an
   * upload is picked up again.
   */
  lastModified: number;
  /**
   * A quick hash of the file's first and last MB, as hex.
   */
  fingerprint: string;
  /**
   * Replace files that are already there. Default is to refuse (single files) or skip them (zip files).
   */
  replace?: boolean;
}

export interface UploadSkipped {
  /**
   * Path inside the zip file.
   */
  path: string;
  reason: string;
}

export interface UploadInfo {
  id: string;
  libraryId: number;
  folder: string;
  path: string;
  /**
   * Unit is in bytes.
   */
  size: number;
  lastModified: number;
  fingerprint: string;
  /**
   * Bytes the server has. The next piece starts here.
   */
  received: number;
  replace: boolean;
  isZip: boolean;
  status: UploadStatus;
  /**
   * 0 to 1 while moving or unpacking, `null` otherwise.
   */
  progress: number | null;
  /**
   * What's happening ("Unpacking Episode 3.mkv"), or why it failed.
   */
  message: string | null;
  /**
   * Files put in the library, relative to `folder`.
   */
  placed: string[];
  /**
   * Files in a zip that were left out, and why.
   */
  skipped: UploadSkipped[];
  createdAt: string;
  updatedAt: string;
}

export interface UploadRules {
  /**
   * Largest file the server takes. Unit is in bytes. `null` = no limit.
   */
  maxSize: number | null;
  /**
   * Largest piece per request. Unit is in bytes. A reverse proxy may allow less; the client then sends smaller ones.
   */
  maxChunk: number;
  /**
   * File types each library takes (lowercase, with the dot), besides `.zip`.
   */
  extensions: Record<LibraryType, string[]>;
}
