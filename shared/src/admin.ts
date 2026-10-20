import type { ProfileColor } from "./profiles.ts";
import type { ItemType, Palette, TaskInfo } from "./media.ts";

//#region Dashboard

/**
 * One movie or episode someone is watching right now.
 */
export interface NowPlaying {
  id: string;
  user: { id: number; name: string; color: ProfileColor; avatar: string | null };
  /**
   * Like "TV · Chrome" or "Phone · Safari".
   */
  device: string;
  /**
   * The viewer is outside the local network.
   */
  isRemote: boolean;
  item: { id: number; title: string; poster: string | null; palette: Palette | null };
  /**
   * `direct` for direct play and repackaging, which don't touch the picture or sound.
   */
  kind: "direct" | "converting";
  /**
   * "Direct play", "Repackaged", "Converting on the GPU" and so on.
   */
  label: string;
  /**
   * Codecs and what happens to them, like "HEVC → H.264 1080p with NVENC · DTS → AAC 5.1".
   */
  detail: string;
  /**
   * Why it isn't played directly. `null` for direct play.
   */
  reason: string | null;
  /**
   * Unit is in seconds.
   */
  position: number;
  /**
   * Unit is in seconds.
   */
  duration: number;
  paused: boolean;
  /**
   * Bits per second sent to the viewer, or `null` when unknown.
   */
  bitrate: number | null;
  startedAt: string;
}

export interface SystemStats {
  cpu: {
    /**
     * 0 to 1, or `null` when the system doesn't say.
     */
    usage: number | null;
    cores: number;
  };
  /**
   * Unit is in bytes.
   */
  memory: { used: number; total: number } | null;
  /**
   * The GPU used for conversions. `null` when hardware acceleration is off.
   */
  gpu: {
    name: string;
    /**
     * 0 to 1, or `null` when the driver doesn't report it.
     */
    usage: number | null;
    conversions: number;
  } | null;
  /**
   * Space on the drives holding the libraries. Unit is in bytes. `null` when it can't be read.
   */
  storage: {
    used: number;
    total: number;
    /**
     * Mount points of the drives.
     */
    mounts: string[];
  } | null;
}

export interface ScheduledScan {
  libraryId: number;
  libraryName: string;
  lastScannedAt: string | null;
  /**
   * When the next scheduled scan is due. In the past means at the next check, within 15 minutes.
   */
  nextAt: string;
}

export interface DashboardInfo {
  server: {
    name: string;
    version: string;
    startedAt: string;
  };
  streams: NowPlaying[];
  /**
   * Conversions allowed at once, from the playback settings.
   */
  maxConversions: number;
  stats: SystemStats;
  tasks: TaskInfo[];
  nextScan: ScheduledScan | null;
  activity: ActivityInfo[];
}

//#endregion

//#region Activity

/**
 * What kind of thing happened, used for the dot colour in the feed.
 */
export type ActivityKind = "added" | "watched" | "signIn" | "import" | "delete" | "subtitles" | "together";

export interface ActivityInfo {
  id: number;
  kind: ActivityKind;
  /**
   * Ready to show, like "Mira finished Paper Moons".
   */
  message: string;
  userId: number | null;
  itemId: number | null;
  createdAt: string;
}

//#endregion

//#region Tasks

export interface TaskRecord extends TaskInfo {
  finishedAt: string;
  outcome: "done" | "failed";
  /**
   * Why it failed. `null` when it didn't.
   */
  error: string | null;
}

export interface TasksOverview {
  running: TaskInfo[];
  /**
   * Finished tasks, newest first.
   */
  history: TaskRecord[];
  scheduled: ScheduledScan[];
  scanIntervalHours: number;
}

//#endregion

//#region Logs

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  /**
   * Increasing number, so the page can ask for lines after the last one it has.
   */
  id: number;
  time: string;
  level: LogLevel;
  message: string;
  /**
   * Extra details as JSON, or `null`.
   */
  data: string | null;
}

//#endregion

//#region Integrations

/**
 * Sonarr or Radarr sees the media under `from`, and Cinemion under `to`.
 */
export interface PathMapping {
  from: string;
  to: string;
}

export interface ArrEvent {
  /**
   * The app's instance name, like "Sonarr" or "Radarr 4K".
   */
  app: string;
  eventType: string;
  at: string;
  /**
   * What Cinemion did with it.
   */
  result: string;
  /**
   * `true` when the reported folder isn't in a library, which usually means a path mapping is missing.
   */
  problem: boolean;
}

export interface IntegrationSettings {
  /**
   * Path of the address Sonarr and Radarr send to, like `/api/integrations/arr/<token>`.
   */
  arrPath: string;
  pathMappings: PathMapping[];
  lastEvent: ArrEvent | null;
}

//#endregion

//#region Webhooks

/**
 * Events outgoing webhooks can send, with the label the settings show.
 */
export const WEBHOOK_EVENTS = {
  "playback.started": "Playback started",
  "playback.paused": "Playback paused",
  "playback.resumed": "Playback resumed",
  "playback.stopped": "Playback stopped",
  "item.watched": "Finished watching",
  "item.added": "New movie or episode",
  "library.scanned": "Library scanned",
  "user.signedIn": "Someone signed in",
  "together.started": "Watch together started",
  "subtitles.downloaded": "Subtitles downloaded",
} as const;

export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return typeof value === "string" && value in WEBHOOK_EVENTS;
}

export interface WebhookDelivery {
  event: WebhookEvent | "test";
  at: string;
  ok: boolean;
  /**
   * HTTP status of the answer, or `null` when the request didn't get one.
   */
  status: number | null;
  error: string | null;
  /**
   * When the next try is planned, after a failure. `null` = no more tries.
   */
  retryAt: string | null;
}

export interface WebhookInfo {
  id: number;
  name: string;
  url: string;
  /**
   * Key for checking the `X-Cinemion-Signature` header.
   */
  secret: string;
  events: WebhookEvent[];
  enabled: boolean;
  lastDelivery: WebhookDelivery | null;
}

export interface SaveWebhookRequest {
  name: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
}

/**
 * A movie or episode in a webhook payload.
 */
export interface WebhookItem {
  id: number;
  type: ItemType;
  title: string;
  year: number | null;
  /**
   * Show title, for episodes.
   */
  show: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  /**
   * Link to the title's page, when the server's public address (`SITE_URL`) is set.
   */
  url: string | null;
}

export interface WebhookUser {
  id: number;
  name: string;
}

/**
 * The `data` of each webhook event.
 */
export interface WebhookPayloads {
  "playback.started": PlaybackEventData;
  "playback.paused": PlaybackEventData;
  "playback.resumed": PlaybackEventData;
  "playback.stopped": PlaybackEventData;
  "item.watched": { user: WebhookUser; item: WebhookItem };
  "item.added": { library: { id: number; name: string }; item: WebhookItem };
  "library.scanned": { library: { id: number; name: string }; added: number; removed: number };
  "user.signedIn": { user: WebhookUser; device: string; isRemote: boolean };
  "together.started": { host: WebhookUser; item: WebhookItem; code: string };
  "subtitles.downloaded": { user: WebhookUser; item: WebhookItem; language: string };
}

export interface PlaybackEventData {
  user: WebhookUser;
  item: WebhookItem;
  device: string;
  isRemote: boolean;
  mode: "direct" | "remux" | "transcode";
  /**
   * Unit is in seconds.
   */
  position: number;
  /**
   * Unit is in seconds.
   */
  duration: number;
}

//#endregion
