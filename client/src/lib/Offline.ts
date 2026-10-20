import type { DownloadInfo, DownloadOptions, DownloadQuality, DownloadSubtitle } from "@shared/downloads.ts";
import type { ItemDetail } from "@shared/media.ts";
import Controller from "./Controller.ts";
import BaseApi from "../Api/BaseApi.ts";
import ItemsApi from "../Api/ItemsApi.ts";
import PlaybackApi from "../Api/PlaybackApi.ts";
import { detectCapabilities } from "./capabilities.ts";
import { episodeLabel } from "./playback.ts";
import { toasts } from "./Toasts.ts";
import { session } from "../Session.ts";

const MEDIA_CACHE = "cn-media-v1";
const MEDIA_PREFIX = "/offline-media/";
const STORAGE_KEY = "cn-offline";
// Pieces a download is saved in. An interrupted download carries on from the first missing piece.
const CHUNK_SIZE = 32 * 1024 * 1024;

/**
 * A title saved on this device. Kept in `localStorage`; the video itself is in Cache Storage.
 */
export interface OfflineDownload {
  /**
   * The server's download id, like "12.720p.d".
   */
  key: string;
  itemId: number;
  /**
   * The profile that saved it; only that profile's progress is sent back.
   */
  userId: number;
  type: ItemDetail["type"];
  title: string;
  /**
   * Like "Saltwater Kings · S1 E3", or the year.
   */
  subtitle: string;
  quality: DownloadQuality;
  status: "preparing" | "downloading" | "paused" | "ready" | "failed";
  /**
   * Making the copy on the server, 0 to 1.
   */
  preparing: number | null;
  /**
   * Unit is in bytes.
   */
  size: number | null;
  received: number;
  contentType: string;
  error: string | null;
  subtitles: Omit<DownloadSubtitle, "url">[];
  /**
   * Where watching stopped, and the length. Unit is in seconds.
   */
  position: number;
  duration: number | null;
  /**
   * Whether `position` was sent to the server since it changed.
   */
  synced: boolean;
  addedAt: number;
}

/**
 * Offline downloads on this device: saving titles in pieces to Cache Storage, and the service worker that plays them
 * (and opens the app) without a connection. Watch progress is kept here and sent to the server when it's reachable.
 */
export class OfflineController extends Controller {
  public downloads: OfflineDownload[] = [];
  /**
   * Bytes used and available for this site, when the browser says.
   */
  public storage: { used: number; quota: number } | null = null;

  private _running = new Map<string, AbortController>();

  constructor() {
    super();
    try {
      this.downloads = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    } catch {
      this.downloads = [];
    }
    addEventListener("online", () => this.sync(session.user?.id ?? null));
  }

  /**
   * Whether this browser can save downloads. Service workers and Cache Storage only work on https (or localhost).
   */
  public isSupported() {
    return isSecureContext && "serviceWorker" in navigator && "caches" in globalThis;
  }

  /**
   * Start the service worker. Only in built apps; the development server reloads too much for one.
   */
  public register() {
    // Vite fills in import.meta.env when building
    const env = (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env;
    if (!this.isSupported() || !env?.PROD) return;
    navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("The service worker didn't start", error));
  }

  public find(itemId: number) {
    return this.downloads.find((d) => d.itemId === itemId) ?? null;
  }

  public get(key: string) {
    return this.downloads.find((d) => d.key === key) ?? null;
  }

  /**
   * Where the service worker serves a download's files.
   */
  public url(key: string, part: "video" | "poster" | `sub/${number}.vtt`) {
    return `${MEDIA_PREFIX}${key}/${part}`;
  }

  private _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.downloads));
    } catch {
      // Storage full; the list is rebuilt from what's left next time
    }
    this.notify();
  }

  private _update(key: string, patch: Partial<OfflineDownload>) {
    this.downloads = this.downloads.map((d) => d.key === key ? { ...d, ...patch } : d);
    this._save();
  }

  /**
   * The sizes `item` can be saved at on this device.
   */
  public options(item: ItemDetail) {
    return BaseApi.POST<DownloadOptions>("/downloads/options", { itemId: item.id, capabilities: detectCapabilities() });
  }

  /**
   * Save `item` at `quality`. Runs in the background; `downloads` shows how it goes.
   * @throws When the server won't start it.
   */
  public async start(item: ItemDetail, quality: DownloadQuality, userId: number) {
    if (this.find(item.id)) await this.remove(this.find(item.id)!.key);
    const info = await BaseApi.POST<DownloadInfo>("/downloads", { itemId: item.id, quality, capabilities: detectCapabilities() });
    // Ask to keep downloads when space runs low; browsers may say no, which only means they could be cleared
    navigator.storage?.persist?.().catch(() => { });
    // The offline pages have to be in the app cache before the connection goes
    import("../pages/Downloads/Downloads.tsx");
    import("../pages/Downloads/OfflinePlayer.tsx");
    const subtitle = item.type === "episode" ? `${item.showTitle ?? ""} · ${episodeLabel(item)}` : item.year ? String(item.year) : "";
    const download: OfflineDownload = {
      key: info.id,
      itemId: item.id,
      userId,
      type: item.type,
      title: item.title,
      subtitle,
      quality,
      status: info.status === "ready" ? "downloading" : "preparing",
      preparing: info.progress,
      size: info.size,
      received: 0,
      contentType: info.contentType,
      error: null,
      subtitles: info.subtitles.map(({ url: _url, ...rest }) => rest),
      position: item.userData?.position ?? 0,
      duration: item.runtime ? item.runtime * 60 : null,
      synced: true,
      addedAt: Date.now(),
    };
    this.downloads = [download, ...this.downloads.filter((d) => d.key !== info.id)];
    this._save();
    this._saveExtras(download, item).catch(() => { });
    this._run(download.key);
  }

  /**
   * The poster and subtitles, saved next to the video.
   */
  private async _saveExtras(download: OfflineDownload, item: ItemDetail) {
    const cache = await caches.open(MEDIA_CACHE);
    const poster = item.artwork.poster ?? item.artwork.thumb;
    if (poster) {
      const res = await fetch(ItemsApi.imageUrl(poster, 500)).catch(() => null);
      if (res?.ok) await cache.put(this.url(download.key, "poster"), res);
    }
    for (const sub of download.subtitles) {
      const res = await fetch(`/api/downloads/${download.key}/subtitles/${sub.index}.vtt`, { headers: BaseApi.getHeaders(false) }).catch(() => null);
      if (res?.ok) await cache.put(this.url(download.key, `sub/${sub.index}.vtt`), new Response(await res.blob(), { headers: { "Content-Type": "text/vtt" } }));
    }
  }

  /**
   * Wait for the server's copy, then fetch the video piece by piece, skipping pieces already saved.
   */
  private async _run(key: string) {
    if (this._running.has(key)) return;
    const abort = new AbortController();
    this._running.set(key, abort);
    try {
      let info = await BaseApi.GET<DownloadInfo>(`/downloads/${key}`);
      while (info.status === "preparing") {
        this._update(key, { status: "preparing", preparing: info.progress });
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (abort.signal.aborted) return;
        info = await BaseApi.GET<DownloadInfo>(`/downloads/${key}`);
      }
      if (info.status === "failed") throw new Error(info.error ?? "The server couldn't make the copy.");

      const size = info.size ?? 0;
      const cache = await caches.open(MEDIA_CACHE);
      const chunks = Math.max(1, Math.ceil(size / CHUNK_SIZE));
      this._update(key, { status: "downloading", size, contentType: info.contentType, error: null });
      let received = 0;
      for (let i = 0; i < chunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(size, start + CHUNK_SIZE) - 1;
        const piece = this.url(key, "video").replace(/video$/, `chunk/${i}`);
        const existing = await cache.match(piece);
        if (existing) {
          received += end - start + 1;
          continue;
        }
        const res = await fetch(`/api/downloads/${key}/file`, { headers: { ...BaseApi.getHeaders(false), Range: `bytes=${start}-${end}` }, signal: abort.signal });
        if (!res.ok || !res.body) throw new Error(`The download stopped: ${res.status} ${res.statusText}`);
        // Counted as it arrives, so the progress bar moves within a piece too
        const reader = res.body.getReader();
        const parts: Uint8Array[] = [];
        let shown = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          received += value.length;
          // Saved twice a second at most; reads come in tiny pieces
          if (Date.now() - shown > 500) {
            shown = Date.now();
            this._update(key, { received });
          }
        }
        this._update(key, { received });
        await cache.put(piece, new Response(new Blob(parts as BlobPart[])));
      }
      await cache.put(this.url(key, "video").replace(/video$/, "manifest"), new Response(JSON.stringify({ size, chunkSize: CHUNK_SIZE, type: info.contentType }), { headers: { "Content-Type": "application/json" } }));
      this._update(key, { status: "ready", received: size, preparing: null });
      toasts.success(`${this.get(key)?.title ?? "The download"} is ready to watch offline`);
    } catch (error) {
      if (abort.signal.aborted) return;
      this._update(key, { status: "failed", error: (error as Error).message });
    } finally {
      this._running.delete(key);
      this.updateStorage();
    }
  }

  public pause(key: string) {
    this._running.get(key)?.abort();
    this._running.delete(key);
    this._update(key, { status: "paused" });
  }

  public resume(key: string) {
    this._update(key, { status: "downloading", error: null });
    this._run(key);
  }

  /**
   * Carry on with downloads that were going when the page closed.
   */
  public resumeAll() {
    for (const d of this.downloads) {
      if (d.status === "downloading" || d.status === "preparing") this._run(d.key);
    }
  }

  /**
   * Delete a download from this device.
   */
  public async remove(key: string) {
    this._running.get(key)?.abort();
    this._running.delete(key);
    const cache = await caches.open(MEDIA_CACHE);
    for (const request of await cache.keys()) {
      if (new URL(request.url).pathname.startsWith(`${MEDIA_PREFIX}${key}/`)) await cache.delete(request);
    }
    this.downloads = this.downloads.filter((d) => d.key !== key);
    this._save();
    this.updateStorage();
  }

  public async updateStorage() {
    const estimate = await navigator.storage?.estimate?.().catch(() => null);
    this.storage = estimate?.quota ? { used: estimate.usage ?? 0, quota: estimate.quota } : null;
    this.notify();
  }

  /**
   * Remember where watching offline stopped. Sent to the server by `sync()`.
   * @param position Unit is in seconds.
   */
  public saveProgress(key: string, position: number, duration: number | null) {
    this._update(key, { position, duration: duration ?? this.get(key)?.duration ?? null, synced: false });
  }

  /**
   * Send offline progress to the server for the signed-in profile's downloads. Quietly does nothing when offline.
   * @param userId The signed-in profile; others' downloads wait for them, so their progress isn't saved as this one's.
   */
  public async sync(userId: number | null) {
    if (userId === null) return;
    for (const d of this.downloads) {
      if (d.synced || d.userId !== userId) continue;
      const result = await PlaybackApi.saveProgress(d.itemId, d.position, d.duration);
      if (result) this._update(d.key, { synced: true });
    }
  }
}

export const offline = new OfflineController();

export default offline;
