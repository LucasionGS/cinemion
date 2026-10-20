import type { HardwareAcceleration, HardwareTestResult, PlaybackDevices, PlaybackInfo, PlaybackSettings, StartPlaybackRequest } from "@shared/playback.ts";
import type { ItemSummary } from "@shared/media.ts";
import BaseApi from "./BaseApi.ts";

export namespace PlaybackApi {
  /**
   * Start playing a movie or episode. The server picks direct play, repackaging or conversion.
   */
  export function start(itemId: number, request: StartPlaybackRequest) {
    return BaseApi.POST<PlaybackInfo>(`/playback/${itemId}/start`, request);
  }

  /**
   * Stop a conversion. Uses `keepalive` so it still goes out while the page closes.
   */
  export function stop(sessionId: string) {
    fetch(`/api/playback/session/${sessionId}`, { method: "DELETE", keepalive: true }).catch(() => { });
  }

  /**
   * Keep a paused conversion alive.
   */
  export async function ping(sessionId: string) {
    const res = await fetch(`/api/playback/session/${sessionId}/ping`, { method: "POST" }).catch(() => null);
    return !!res?.ok;
  }

  /**
   * Remember where playback is. Uses `keepalive` so the last position is saved when the page closes.
   * @param position Unit is in seconds.
   * @param duration Unit is in seconds.
   */
  export async function saveProgress(itemId: number, position: number, duration: number | null) {
    const res = await fetch(`/api/items/${itemId}/progress`, {
      method: "PUT",
      headers: BaseApi.getHeaders(),
      body: JSON.stringify({ position, duration }),
      keepalive: true,
    }).catch(() => null);
    return res?.ok ? await res.json() as ItemSummary : null;
  }

  export function getSettings() {
    return BaseApi.GET<PlaybackSettings>("/playback/settings");
  }

  export function setSettings(settings: Partial<PlaybackSettings>) {
    return BaseApi.PUT<PlaybackSettings>("/playback/settings", settings);
  }

  /**
   * GPUs the server can see, and the conversion cache size.
   */
  export function devices() {
    return BaseApi.GET<PlaybackDevices>("/playback/devices");
  }

  /**
   * Convert a short clip with `kind` to see whether it works and how fast.
   */
  export function test(kind: HardwareAcceleration, device: string) {
    return BaseApi.POST<HardwareTestResult>("/playback/test", { kind, device });
  }

  export function clearCache() {
    return BaseApi.DELETE<{ cacheSize: number }>("/playback/cache");
  }
}

export default PlaybackApi;
