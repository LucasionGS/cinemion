import { encodeHex } from "@std/encoding/hex";
import type { HardwareAcceleration as Kind, PlaybackMode } from "@shared/playback.ts";
import type { NowPlaying, PlaybackEventData, WebhookItem, WebhookUser } from "@shared/admin.ts";
import { MediaItem, type MediaFile, User } from "../models/index.ts";
import ItemLabels from "../library/ItemLabels.ts";
import PlaybackDecider from "./PlaybackDecider.ts";
import Events from "../integrations/Events.ts";
import log from "../lib/Logger.ts";

/**
 * Who is watching what right now. Players register when they start, report their position and pauses, and end
 * when they close. Players that stop reporting (a closed laptop, a lost connection) drop off after a while.
 */
export namespace ActivePlayback {
  export interface Entry {
    id: string;
    userId: number;
    itemId: number;
    fileId: number;
    device: string;
    isRemote: boolean;
    mode: PlaybackMode;
    stream: Stream;
    sessionId: string | null;
    /**
     * Unit is in seconds.
     */
    position: number;
    /**
     * Unit is in seconds.
     */
    duration: number;
    paused: boolean;
    startedAt: number;
    lastSeen: number;
    /**
     * The user and item as webhooks describe them, loaded once.
     */
    meta: Promise<{ user: WebhookUser; item: WebhookItem }>;
  }

  /**
   * How the stream is made, in words for the dashboard.
   */
  export interface Stream {
    kind: NowPlaying["kind"];
    label: string;
    detail: string;
    reason: string | null;
    bitrate: number | null;
  }

  /**
   * Players report every 10 seconds, but background tabs may only run timers once a minute.
   */
  export const STALE_AFTER = 150_000;

  const HARDWARE_NAMES: Record<Kind, string> = { none: "the CPU", vaapi: "VA-API", qsv: "Quick Sync", nvenc: "NVENC" };

  const _entries = new Map<string, Entry>();
  let _reaper: ReturnType<typeof setInterval> | null = null;

  function resolution(height: number | null) {
    return height ? (height >= 2000 ? "4K" : `${height}p`) : null;
  }

  function hdrName(hdr: string | null) {
    if (!hdr) return null;
    return hdr === "dolby-vision" ? "Dolby Vision" : hdr === "hlg" ? "HLG" : "HDR10";
  }

  function channels(count: number) {
    return count === 1 ? "mono" : count === 2 ? "stereo" : count === 6 ? "5.1" : count === 8 ? "7.1" : `${count} channels`;
  }

  /**
   * Describe what happens to the picture and sound, like "HEVC → H.264 1080p with NVENC · DTS → AAC 5.1".
   */
  export function describe(file: MediaFile, decision: PlaybackDecider.Decision, hardware: Kind): Stream {
    const { video, audio, mode } = decision;
    const name = PlaybackDecider.codecName;
    const parts: string[] = [];

    if (video.action === "copy") {
      parts.push([name(video.source), resolution(file.height), hdrName(file.hdr)].filter(Boolean).join(" "));
    }
    else {
      const target = [`${name(video.source)} → ${name(video.codec)}`, resolution(video.height ?? file.height)].filter(Boolean).join(" ");
      parts.push(`${target}${hardware !== "none" ? ` with ${HARDWARE_NAMES[hardware]}` : ""}${video.toneMap ? ", HDR to SDR" : ""}`);
    }

    if (audio) {
      const source = file.audio.find((a) => a.index === audio.index);
      const sourceName = name(source?.codec ?? audio.codec);
      parts.push(audio.action === "copy" ? `${sourceName} ${channels(source?.channels ?? audio.channels)}` : `${sourceName} → AAC ${channels(audio.channels)}`);
    }
    if (mode === "direct") parts.push("original file");
    else if (mode === "remux") parts.push("repackaged");

    let label: string;
    if (mode === "direct") label = "Direct play";
    else if (mode === "remux") label = "Repackaged";
    else if (video.action === "copy") label = "Converting audio";
    else label = hardware !== "none" ? "Converting on the GPU" : "Converting";

    const audioBitrate = audio?.action === "convert" ? (audio.channels > 2 ? 384_000 : 192_000) : 0;
    const bitrate = video.action === "convert" && video.bitrate ? video.bitrate + audioBitrate : file.bitrate;

    return {
      kind: mode === "transcode" ? "converting" : "direct",
      label,
      detail: parts.join(" · "),
      reason: mode === "direct" ? null : decision.reasons.join(" ") || null,
      bitrate: bitrate ?? null,
    };
  }

  async function loadMeta(userId: number, itemId: number) {
    const [user, item] = await Promise.all([User.findByPk(userId), MediaItem.findByPk(itemId)]);
    if (!item) throw new Error("The title is gone.");
    return { user: { id: userId, name: user?.name ?? "Someone" }, item: await ItemLabels.forWebhook(item) };
  }

  async function eventData(entry: Entry): Promise<PlaybackEventData> {
    const { user, item } = await entry.meta;
    return { user, item, device: entry.device, isRemote: entry.isRemote, mode: entry.mode, position: Math.round(entry.position), duration: Math.round(entry.duration) };
  }

  function emit(event: "playback.started" | "playback.paused" | "playback.resumed" | "playback.stopped", entry: Entry) {
    eventData(entry).then((data) => Events.emit(event, data)).catch(() => { });
  }

  function startReaper() {
    _reaper ??= setInterval(() => {
      for (const entry of _entries.values()) {
        if (Date.now() - entry.lastSeen > STALE_AFTER) {
          log.debug("Playback stopped reporting", { playback: entry.id });
          end(entry.id);
        }
      }
    }, 15_000);
  }

  /**
   * Note a stream that started. With `previousId` (from the same user and title), that entry is updated instead,
   * so switching quality or audio track doesn't look like a new viewing.
   */
  export function register(opts: {
    previousId?: string;
    userId: number;
    itemId: number;
    file: MediaFile;
    decision: PlaybackDecider.Decision;
    hardware: Kind;
    sessionId: string | null;
    position: number;
    duration: number;
    device: string;
    isRemote: boolean;
  }): Entry {
    startReaper();
    const stream = describe(opts.file, opts.decision, opts.hardware);
    const previous = opts.previousId ? _entries.get(opts.previousId) : undefined;
    if (previous && previous.userId === opts.userId && previous.itemId === opts.itemId) {
      Object.assign(previous, { fileId: opts.file.id, mode: opts.decision.mode, stream, sessionId: opts.sessionId, position: opts.position, duration: opts.duration, lastSeen: Date.now() });
      return previous;
    }

    const entry: Entry = {
      id: encodeHex(crypto.getRandomValues(new Uint8Array(16))),
      userId: opts.userId,
      itemId: opts.itemId,
      fileId: opts.file.id,
      device: opts.device,
      isRemote: opts.isRemote,
      mode: opts.decision.mode,
      stream,
      sessionId: opts.sessionId,
      position: opts.position,
      duration: opts.duration,
      paused: false,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      meta: loadMeta(opts.userId, opts.itemId),
    };
    entry.meta.catch(() => { });
    _entries.set(entry.id, entry);
    emit("playback.started", entry);
    return entry;
  }

  /**
   * A player's regular report. Returns `false` when the entry has ended, like after the server restarted.
   */
  export function report(id: string, update: { position?: number; paused?: boolean }) {
    const entry = _entries.get(id);
    if (!entry) return false;
    entry.lastSeen = Date.now();
    if (typeof update.position === "number" && update.position >= 0) entry.position = update.position;
    if (typeof update.paused === "boolean" && update.paused !== entry.paused) {
      entry.paused = update.paused;
      emit(update.paused ? "playback.paused" : "playback.resumed", entry);
    }
    return true;
  }

  export function end(id: string) {
    const entry = _entries.get(id);
    if (!entry) return;
    _entries.delete(id);
    emit("playback.stopped", entry);
  }

  export function list() {
    return [..._entries.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  /**
   * The dashboard's "Now playing" cards.
   */
  export async function nowPlaying(): Promise<NowPlaying[]> {
    const entries = list();
    if (entries.length === 0) return [];
    const users = new Map((await User.findAll({ where: { id: [...new Set(entries.map((e) => e.userId))] } })).map((u) => [u.id, u]));
    const items = new Map((await MediaItem.findAll({ where: { id: [...new Set(entries.map((e) => e.itemId))] } })).map((i) => [i.id, i]));

    const result: NowPlaying[] = [];
    for (const entry of entries) {
      const user = users.get(entry.userId);
      const item = items.get(entry.itemId);
      if (!item) continue;
      const label = await ItemLabels.describe(item);
      result.push({
        id: entry.id,
        user: user ? { id: user.id, name: user.name, color: user.color, avatar: user.avatar } : { id: entry.userId, name: "Someone", color: "slate", avatar: null },
        device: entry.device,
        isRemote: entry.isRemote,
        item: { id: item.id, title: label.title, poster: label.poster, palette: label.palette },
        kind: entry.stream.kind,
        label: entry.stream.label,
        detail: entry.stream.detail,
        reason: entry.stream.reason,
        position: entry.position,
        duration: entry.duration,
        paused: entry.paused,
        bitrate: entry.stream.bitrate,
        startedAt: new Date(entry.startedAt).toISOString(),
      });
    }
    return result;
  }

  export function shutdown() {
    if (_reaper) clearInterval(_reaper);
    _reaper = null;
  }
}

export default ActivePlayback;
