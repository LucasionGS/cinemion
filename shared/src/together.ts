import type { ProfileSummary } from "./api.ts";
import type { ItemSummary } from "./media.ts";

/**
 * Watching together: everyone in a room plays the same title, and play, pause and seeking stay in sync.
 * Each viewer streams on their own; only the playback state is shared, over a WebSocket at `/api/together/ws`.
 */

/**
 * The shared playback state. `position` was the position at server time `at` (ms); while playing it moves on from there.
 */
export interface TogetherState {
  playing: boolean;
  position: number;
  at: number;
}

export interface TogetherMember {
  /**
   * One per connection, so the same profile can join from two devices.
   */
  id: string;
  profile: ProfileSummary;
  /**
   * Like "Chrome on a desktop" or "TV".
   */
  device: string;
  status: "loading" | "ready" | "buffering";
  /**
   * Within a couple of seconds of everyone else.
   */
  inSync: boolean;
  isHost: boolean;
}

export interface TogetherRoom {
  /**
   * Seven characters like "KX429QM", shown as "KX4-29QM".
   */
  code: string;
  itemId: number;
  hostUserId: number;
  /**
   * Off: only the host can play, pause and seek.
   */
  anyoneControls: boolean;
  state: TogetherState;
  members: TogetherMember[];
}

/**
 * What the join page shows before joining.
 */
export interface TogetherPreview {
  code: string;
  item: ItemSummary;
  host: ProfileSummary;
  state: TogetherState;
  members: TogetherMember[];
  serverTime: number;
}

export type TogetherAction = "play" | "pause" | "seek";

/**
 * A line in the room's chat.
 */
export interface TogetherChatMessage {
  id: string;
  memberId: string;
  profile: ProfileSummary;
  text: string;
  /**
   * Server time it was sent, in ms.
   */
  at: number;
  /**
   * Where the shared playback was when it was sent, in seconds.
   */
  position: number;
}

/**
 * The reactions anyone can send. They float over the video for everyone for a moment.
 */
export const TOGETHER_REACTIONS = ["❤️", "😂", "😮", "😢", "👏", "🔥"] as const;
export type TogetherReaction = typeof TOGETHER_REACTIONS[number];

/**
 * Longest chat message, in characters.
 */
export const TOGETHER_CHAT_LIMIT = 500;

export type TogetherClientMessage =
  | { type: "hello"; token: string; code: string; device: string }
  | { type: "control"; action: TogetherAction; position: number }
  | { type: "status"; status: TogetherMember["status"]; position: number }
  | { type: "ping"; t: number }
  | { type: "item"; itemId: number }
  | { type: "settings"; anyoneControls: boolean }
  | { type: "chat"; text: string }
  | { type: "react"; reaction: TogetherReaction }
  | { type: "leave" }
  | { type: "end" };

export type TogetherServerMessage =
  | { type: "welcome"; memberId: string; room: TogetherRoom; serverTime: number; chat: TogetherChatMessage[] }
  | { type: "chat"; message: TogetherChatMessage }
  | { type: "reaction"; reaction: TogetherReaction; memberId: string; profile: ProfileSummary }
  | { type: "room"; room: TogetherRoom }
  | { type: "control"; action: TogetherAction; state: TogetherState; by: { memberId: string; name: string } }
  | { type: "item"; itemId: number; by: { memberId: string; name: string } }
  | { type: "pong"; t: number; serverTime: number }
  | { type: "ended"; reason: string }
  | { type: "error"; message: string };

/**
 * "KX4-29QM" from "KX429QM", for showing and reading out.
 */
export function formatRoomCode(code: string) {
  return code.length > 3 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

/**
 * The code from whatever was typed or pasted: lower case, dashes, spaces or a whole invite link.
 */
export function parseRoomCode(input: string) {
  const fromLink = input.match(/together\/([A-Za-z0-9-]+)/)?.[1] ?? input;
  return fromLink.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
