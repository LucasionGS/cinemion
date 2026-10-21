import type { UploadInfo, UploadRules } from "@shared/uploads.ts";
import Controller from "./Controller.ts";
import UploadsApi from "../Api/UploadsApi.ts";
import { toasts } from "./Toasts.ts";

// Pieces start this big and halve when a reverse proxy refuses them (nginx allows 1 MB by default)
const START_CHUNK = 32 * 1024 * 1024;
const MIN_CHUNK = 256 * 1024;
// Waits between tries after the connection drops; the last one repeats until it's back
const RETRY_DELAYS = [1, 2, 5, 10, 20, 30];
const MAX_ATTEMPTS = 40;
const FINGERPRINT_BYTES = 1024 * 1024;

/**
 * A file on its way to a library, as this page sees it.
 */
export interface UploadEntry {
  key: string;
  /**
   * The file on this device. `null` for an unfinished upload from before a reload: the browser can't open the file
   * again by itself, so it has to be picked again to carry on.
   */
  file: File | null;
  libraryId: number;
  folder: string;
  path: string;
  size: number;
  replace: boolean;
  /**
   * `waiting`: in line. `paused`: unfinished, needs the file picked again. `processing`: the server is moving or
   * unpacking it.
   */
  state: "waiting" | "uploading" | "retrying" | "paused" | "processing" | "done" | "failed";
  /**
   * Bytes the server has, plus what's in flight.
   */
  sent: number;
  /**
   * Bytes per second, averaged over the last few seconds. `null` until it's known.
   */
  speed: number | null;
  server: UploadInfo | null;
  error: string | null;
}

/**
 * Files to add to a library, picked on this page.
 */
export interface UploadRequest {
  file: File;
  libraryId: number;
  folder: string;
  path: string;
  replace: boolean;
}

/**
 * Uploads media into libraries, one file at a time, in pieces the server can pick up from wherever it stopped. Runs
 * for as long as the page is open, whichever page that is.
 */
export class UploadController extends Controller {
  public entries: UploadEntry[] = [];
  public rules: UploadRules | null = null;

  private _chunk = START_CHUNK;
  private _running = false;
  private _aborts = new Map<string, AbortController>();
  private _polling = new Set<string>();
  private _lastNotify = 0;
  private _nextKey = 1;

  constructor() {
    super();
    globalThis.addEventListener?.("beforeunload", (e) => {
      // Leaving mid-upload loses the piece in flight and needs the file picked again; ask first
      if (this.isBusy()) e.preventDefault();
    });
  }

  /**
   * Whether anything is uploading or waiting to.
   */
  public isBusy() {
    return this.entries.some((e) => e.state === "waiting" || e.state === "uploading" || e.state === "retrying");
  }

  public forLibrary(libraryId: number) {
    return this.entries.filter((e) => e.libraryId === libraryId);
  }

  /**
   * Load the server's rules once, and its uploads (all, or `libraryId`'s): unfinished ones from earlier visits show as
   * paused, ones being added are followed.
   */
  public async load(libraryId?: number) {
    this.rules ??= await UploadsApi.rules();
    const known = await UploadsApi.list(libraryId);
    for (const info of known) {
      const entry = this.entries.find((e) => e.server?.id === info.id);
      if (entry) continue;
      const added: UploadEntry = {
        key: `u${this._nextKey++}`,
        file: null,
        libraryId: info.libraryId,
        folder: info.folder,
        path: info.path,
        size: info.size,
        replace: info.replace,
        state: info.status === "uploading" ? "paused" : info.status === "processing" ? "processing" : info.status,
        sent: info.received,
        speed: null,
        server: info,
        error: info.status === "failed" ? info.message : null,
      };
      this.entries.push(added);
      if (added.state === "processing") this._follow(added);
    }
    this.notify();
  }

  /**
   * Put files in line. Each one starts (or carries on) when the one before it is done.
   */
  public add(requests: UploadRequest[]) {
    for (const request of requests) {
      // The file of an unfinished upload, picked again: carry on with it when it really is the same file
      const paused = this.entries.find((e) => e.state === "paused" && e.libraryId === request.libraryId && e.folder === request.folder && e.path === request.path && e.size === request.file.size);
      if (paused) {
        this.resumeWith(paused.key, request.file).catch(() => this._push(request));
        continue;
      }
      this._push(request);
    }
  }

  private _push(request: UploadRequest) {
    this.entries.push({
      key: `u${this._nextKey++}`,
      file: request.file,
      libraryId: request.libraryId,
      folder: request.folder,
      path: request.path,
      size: request.file.size,
      replace: request.replace,
      state: "waiting",
      sent: 0,
      speed: null,
      server: null,
      error: null,
    });
    this.notify();
    this._pump();
  }

  /**
   * Carry on with a paused upload, given the same file again.
   * @throws When `file` isn't the same file.
   */
  public async resumeWith(key: string, file: File) {
    const entry = this._entry(key);
    if (!entry?.server) return;
    if (file.size !== entry.size || (entry.server.lastModified && file.lastModified !== entry.server.lastModified)) {
      throw new Error(`That's a different file. Pick "${entry.path.split("/").pop()}" (${entry.size} bytes) to carry on.`);
    }
    if (await fingerprint(file) !== entry.server.fingerprint) throw new Error("That file has different contents from the one being uploaded.");
    entry.file = file;
    entry.state = "waiting";
    entry.error = null;
    this.notify();
    this._pump();
  }

  /**
   * Try a failed upload again: carry on sending it, or, when it was complete, add it to the library again.
   */
  public async retry(key: string, replace?: boolean) {
    const entry = this._entry(key);
    if (!entry) return;
    if (replace !== undefined) entry.replace = replace;
    entry.error = null;
    if (entry.server && entry.server.received === entry.size) {
      try {
        entry.server = await UploadsApi.retry(entry.server.id, entry.replace);
        entry.state = "processing";
        this._follow(entry);
      } catch (error) {
        entry.state = "failed";
        entry.error = (error as Error).message;
      }
      this.notify();
      return;
    }
    entry.state = entry.file ? "waiting" : "paused";
    // A start with `replace` changed tells the server too
    if (entry.server && replace !== undefined) entry.server = null;
    this.notify();
    this._pump();
  }

  /**
   * Stop an upload and delete what the server has of it, or clear a finished one from the list.
   */
  public async remove(key: string) {
    const entry = this._entry(key);
    if (!entry) return;
    this._aborts.get(key)?.abort();
    this.entries = this.entries.filter((e) => e !== entry);
    this.notify();
    if (entry.server && entry.state !== "processing") {
      await UploadsApi.remove(entry.server.id).catch(() => { });
    }
  }

  /**
   * Clear the finished uploads of a library from the list.
   */
  public clearFinished(libraryId: number) {
    for (const entry of this.forLibrary(libraryId)) {
      if (entry.state === "done") this.remove(entry.key);
    }
  }

  private _entry(key: string) {
    return this.entries.find((e) => e.key === key) ?? null;
  }

  /**
   * Re-render at most a few times a second while bytes are flowing.
   */
  private _notifySoon() {
    const now = Date.now();
    if (now - this._lastNotify < 250) return;
    this._lastNotify = now;
    this.notify();
  }

  private async _pump() {
    if (this._running) return;
    this._running = true;
    try {
      let next: UploadEntry | undefined;
      while ((next = this.entries.find((e) => e.state === "waiting"))) await this._upload(next);
    } finally {
      this._running = false;
    }
  }

  private async _upload(entry: UploadEntry) {
    const file = entry.file!;
    const abort = new AbortController();
    this._aborts.set(entry.key, abort);
    entry.state = "uploading";
    this.notify();
    try {
      if (!entry.server) {
        entry.server = await UploadsApi.start({
          libraryId: entry.libraryId,
          folder: entry.folder,
          path: entry.path,
          size: entry.size,
          lastModified: file.lastModified,
          fingerprint: await fingerprint(file),
          replace: entry.replace,
        });
      }
      const id = entry.server.id;
      let offset = entry.server.received;
      let attempts = 0;
      // Speed over the last few seconds, from (time, bytes) samples
      const samples: [number, number][] = [];
      while (offset < entry.size && !abort.signal.aborted) {
        const end = Math.min(entry.size, offset + Math.min(this._chunk, this.rules?.maxChunk ?? this._chunk));
        try {
          const info = await UploadsApi.sendPiece(id, offset, file.slice(offset, end), (loaded) => {
            entry.sent = offset + loaded;
            const now = Date.now();
            samples.push([now, entry.sent]);
            while (samples.length > 2 && now - samples[0][0] > 5000) samples.shift();
            if (samples.length > 1 && now - samples[0][0] > 500) entry.speed = (entry.sent - samples[0][1]) / ((now - samples[0][0]) / 1000);
            this._notifySoon();
          }, abort.signal);
          entry.server = info;
          offset = info.received;
          attempts = 0;
          if (entry.state === "retrying") {
            entry.state = "uploading";
            entry.error = null;
          }
        } catch (error) {
          if (abort.signal.aborted) return;
          if (!(error instanceof UploadsApi.RequestError)) throw error;
          if (error.status === 409 && error.upload) {
            // The server has a different amount than this page thought; carry on from there
            entry.server = error.upload;
            offset = error.upload.received;
            if (error.upload.status !== "uploading") break;
            continue;
          }
          if (error.status === 413 && this._chunk > MIN_CHUNK) {
            this._chunk = Math.max(MIN_CHUNK, Math.floor(this._chunk / 2));
            continue;
          }
          const temporary = error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504;
          if (!temporary || ++attempts > MAX_ATTEMPTS) throw error;
          entry.state = "retrying";
          entry.error = `${error.message} Trying again…`;
          entry.speed = null;
          this.notify();
          await wait(RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)] * 1000, abort.signal);
          if (abort.signal.aborted) return;
          // Find out how much of the cut-off piece made it
          const info = await UploadsApi.get(id).catch(() => null);
          if (info) {
            entry.server = info;
            offset = info.received;
            entry.sent = offset;
          }
        }
      }
      entry.sent = entry.size;
      entry.speed = null;
      entry.error = null;
      entry.state = "processing";
      this._follow(entry);
    } catch (error) {
      if (abort.signal.aborted) return;
      entry.state = "failed";
      entry.speed = null;
      entry.error = (error as Error).message;
      toasts.error(`Couldn't upload ${entry.path.split("/").pop()}`, entry.error);
    } finally {
      this._aborts.delete(entry.key);
      this.notify();
    }
  }

  /**
   * Check on an upload the server is moving or unpacking until it's done.
   */
  private async _follow(entry: UploadEntry) {
    const id = entry.server?.id;
    if (!id || this._polling.has(id)) return;
    this._polling.add(id);
    try {
      let misses = 0;
      while (this.entries.includes(entry)) {
        await wait(1000);
        const info = await UploadsApi.get(id).catch(() => null);
        if (!info) {
          if (++misses > 30) break;
          continue;
        }
        misses = 0;
        entry.server = info;
        if (info.status === "done" || info.status === "failed") {
          entry.state = info.status;
          entry.error = info.status === "failed" ? info.message : null;
          if (info.status === "done") toasts.success(`${entry.path.split("/").pop()} was added`, info.isZip ? info.message ?? undefined : undefined);
          else toasts.error(`Couldn't add ${entry.path.split("/").pop()}`, info.message ?? undefined);
          break;
        }
        this.notify();
      }
    } finally {
      this._polling.delete(id);
      this.notify();
    }
  }
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * A quick hash of the file's first and last MB with its size, to tell the same file apart from another with the same
 * name. Not cryptographic: `crypto.subtle` doesn't exist on plain-http LAN addresses.
 */
export async function fingerprint(file: File) {
  const head = new Uint8Array(await file.slice(0, FINGERPRINT_BYTES).arrayBuffer());
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - FINGERPRINT_BYTES)).arrayBuffer());
  // cyrb53, run over both ends
  let h1 = 0xdeadbeef ^ file.size;
  let h2 = 0x41c6ce57 ^ file.size;
  for (const part of [head, tail]) {
    for (let i = 0; i < part.length; i++) {
      h1 = Math.imul(h1 ^ part[i], 2654435761);
      h2 = Math.imul(h2 ^ part[i], 1597334677);
    }
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

export const uploads = new UploadController();
