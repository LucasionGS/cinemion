import type { ProfileSummary } from "@shared/api.ts";
import type { TogetherAction, TogetherChatMessage, TogetherClientMessage, TogetherMember, TogetherReaction, TogetherRoom, TogetherServerMessage, TogetherState } from "@shared/together.ts";
import Controller from "./Controller.ts";
import BaseApi from "../Api/BaseApi.ts";
import { deviceMode } from "./DeviceMode.ts";
import { session } from "../Session.ts";
import { formatClock } from "./playback.ts";
import { t } from "../i18n/I18n.ts";

/**
 * Something another member did, for the short notice at the top of the player.
 */
export interface TogetherNotice {
  id: number;
  text: string;
  profile: ProfileSummary | null;
}

/**
 * A reaction floating over the video. `lane` spreads them out side by side.
 */
export interface FloatingReaction {
  id: number;
  reaction: TogetherReaction;
  profile: ProfileSummary;
  lane: number;
}

/**
 * This device's place in a watch together room: the WebSocket, the shared state and server clock.
 * One at a time; the player subscribes to it while it's open.
 */
export class TogetherSession extends Controller {
  public code: string | null = null;
  public room: TogetherRoom | null = null;
  public memberId: string | null = null;
  public status: "idle" | "connecting" | "connected" | "ended" = "idle";
  /**
   * Why the session ended, shown once.
   */
  public endedReason: string | null = null;
  public notice: TogetherNotice | null = null;
  public messages: TogetherChatMessage[] = [];
  /**
   * Chat messages from others since the chat was last on screen.
   */
  public unread = 0;
  public reactions: FloatingReaction[] = [];
  /**
   * Whether the chat is on screen, so new messages count as read instead of showing as notices.
   */
  private _chatVisible = false;

  private _socket: WebSocket | null = null;
  /**
   * Server time minus local time, in ms. Measured with pings, so drift correction isn't fooled by clocks being off.
   */
  private _clockOffset = 0;
  private _bestRtt = Infinity;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _retries = 0;
  private _noticeId = 0;
  private _reactionId = 0;
  private _noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private _controlListeners = new Set<(state: TogetherState, byMe: boolean) => void>();
  private _itemListeners = new Set<(itemId: number) => void>();
  private _welcomeWaiters: ((ok: boolean) => void)[] = [];

  private static readonly STORAGE_KEY = "cn-together";

  constructor() {
    super();
    // A page kept in the back/forward cache would stay in the room with its socket open; it rejoins when it comes back
    addEventListener("pagehide", (e) => {
      if (!e.persisted || !this._socket) return;
      this._disconnect();
      this.status = "connecting";
    });
    addEventListener("pageshow", (e) => {
      if (e.persisted && this.code && !this._socket) this._connect();
    });
  }

  public isConnected() {
    return this.status === "connected" && !!this.room;
  }

  public isHost() {
    return !!this.room && this.room.hostUserId === session.user?.id;
  }

  /**
   * Whether this device may play, pause and seek.
   */
  public canControl() {
    const room = this.room;
    if (!room) return true;
    if (this.isHost() || room.anyoneControls) return true;
    return !room.members.some((m) => m.isHost);
  }

  public serverNow() {
    return Date.now() + this._clockOffset;
  }

  /**
   * Where the shared playback is right now, in seconds.
   */
  public expectedPosition() {
    const state = this.room?.state;
    if (!state) return 0;
    return state.playing ? state.position + (this.serverNow() - state.at) / 1000 : state.position;
  }

  /**
   * The member list without this device.
   */
  public others(): TogetherMember[] {
    return this.room?.members.filter((m) => m.id !== this.memberId) ?? [];
  }

  /**
   * Start a room for a title and join it.
   */
  public async start(itemId: number, position: number) {
    const { code } = await BaseApi.POST<{ code: string }>("/together", { itemId, position });
    await this.join(code);
    return code;
  }

  /**
   * Join a room. Resolves once the server has let this device in.
   * @throws When the room doesn't exist or this profile can't join.
   */
  public join(code: string): Promise<void> {
    if (this.code === code && this.isConnected()) return Promise.resolve();
    this._disconnect();
    this.code = code;
    this.status = "connecting";
    this.endedReason = null;
    this._retries = 0;
    this.notify();
    try {
      sessionStorage.setItem(TogetherSession.STORAGE_KEY, code);
    } catch {
      // Reloading the page leaves the room, that's all
    }
    const welcomed = new Promise<void>((resolve, reject) => {
      this._welcomeWaiters.push((ok) => ok ? resolve() : reject(new Error(this.endedReason ?? t("together.errors.couldntJoin"))));
    });
    this._connect();
    return welcomed;
  }

  /**
   * The room this tab was in before a reload, if any.
   */
  public rememberedCode() {
    try {
      return sessionStorage.getItem(TogetherSession.STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private _connect() {
    const code = this.code;
    if (!code) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/api/together/ws`);
    this._socket = socket;

    socket.onopen = () => {
      this._send({ type: "hello", token: BaseApi.getToken() ?? "", code, device: deviceLabel() });
    };
    socket.onmessage = (event) => {
      try {
        this._receive(JSON.parse(event.data) as TogetherServerMessage);
      } catch (error) {
        console.warn("Bad watch together message", error);
      }
    };
    socket.onclose = (event) => {
      if (this._socket !== socket) return;
      this._socket = null;
      if (this._pingTimer) clearInterval(this._pingTimer);
      // 1000 and 4xxx are deliberate (left, ended, refused); anything else is a dropped connection
      if (this.status === "ended" || event.code === 1000 || event.code >= 4000) {
        this._finish(this.endedReason ?? (event.code >= 4000 ? event.reason : null));
        return;
      }
      if (this._retries++ < 10) {
        this.status = "connecting";
        this.notify();
        setTimeout(() => this.code === code && this._connect(), Math.min(1000 * this._retries, 5000));
      }
      else {
        this._finish(t("together.errors.lostConnection"));
      }
    };
  }

  private _receive(message: TogetherServerMessage) {
    switch (message.type) {
      case "welcome":
        this.memberId = message.memberId;
        this.room = message.room;
        this.status = "connected";
        this._retries = 0;
        this._clockOffset = message.serverTime - Date.now();
        this.messages = message.chat ?? [];
        this._startPings();
        this._welcomeWaiters.splice(0).forEach((done) => done(true));
        break;
      case "room": {
        const before = new Set(this.room?.members.map((m) => m.id));
        const after = new Set(message.room.members.map((m) => m.id));
        for (const m of message.room.members) {
          if (!before.has(m.id) && m.id !== this.memberId && this.room) this._showNotice(t("together.notice.joined", { name: m.profile.name }), m.profile);
        }
        for (const m of this.room?.members ?? []) {
          if (!after.has(m.id) && m.id !== this.memberId) this._showNotice(t("together.notice.left", { name: m.profile.name }), m.profile);
        }
        this.room = message.room;
        break;
      }
      case "control": {
        if (!this.room) return;
        this.room = { ...this.room, state: message.state };
        const byMe = message.by.memberId === this.memberId;
        if (!byMe) {
          const values = { name: message.by.name, time: formatClock(message.state.position) };
          const text = message.action === "play" ? t("together.notice.played", values) : message.action === "pause" ? t("together.notice.paused", values) : t("together.notice.jumped", values);
          const profile = this.room.members.find((m) => m.id === message.by.memberId)?.profile ?? null;
          this._showNotice(text, profile);
        }
        this._controlListeners.forEach((l) => l(message.state, byMe));
        break;
      }
      case "item":
        if (this.room) this.room = { ...this.room, itemId: message.itemId, state: { playing: true, position: 0, at: this.serverNow() } };
        this._itemListeners.forEach((l) => l(message.itemId));
        break;
      case "chat": {
        this.messages = [...this.messages.slice(-199), message.message];
        const fromOther = message.message.memberId !== this.memberId;
        if (fromOther && !this._chatVisible) {
          this.unread++;
          this._showNotice(t("together.notice.chat", { name: message.message.profile.name, text: message.message.text }), message.message.profile);
        }
        break;
      }
      case "reaction": {
        const id = ++this._reactionId;
        this.reactions = [...this.reactions.slice(-11), { id, reaction: message.reaction, profile: message.profile, lane: id % 5 }];
        setTimeout(() => {
          this.reactions = this.reactions.filter((r) => r.id !== id);
          this.notify();
        }, 3200);
        break;
      }
      case "pong": {
        const rtt = Date.now() - message.t;
        // The quickest round trip gives the most accurate offset
        if (rtt <= this._bestRtt * 1.5) {
          this._bestRtt = Math.min(this._bestRtt, rtt);
          this._clockOffset = message.serverTime - (message.t + rtt / 2);
        }
        return;
      }
      case "ended":
        this.endedReason = message.reason;
        this.status = "ended";
        this._welcomeWaiters.splice(0).forEach((done) => done(false));
        break;
      case "error":
        this._showNotice(message.message, null);
        break;
    }
    this.notify();
  }

  private _startPings() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._bestRtt = Infinity;
    const ping = () => this._send({ type: "ping", t: Date.now() });
    for (let i = 0; i < 3; i++) setTimeout(ping, i * 300);
    this._pingTimer = setInterval(ping, 15_000);
  }

  private _send(message: TogetherClientMessage) {
    if (this._socket?.readyState === WebSocket.OPEN) this._socket.send(JSON.stringify(message));
  }

  private _showNotice(text: string, profile: ProfileSummary | null) {
    this.notice = { id: ++this._noticeId, text, profile };
    if (this._noticeTimer) clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => {
      this.notice = null;
      this.notify();
    }, 3500);
    this.notify();
  }

  public sendControl(action: TogetherAction, position: number) {
    this._send({ type: "control", action, position });
  }

  public sendStatus(status: TogetherMember["status"], position: number) {
    this._send({ type: "status", status, position });
  }

  /**
   * Host only: move everyone on to another title, like the next episode.
   */
  public sendItem(itemId: number) {
    this._send({ type: "item", itemId });
  }

  public sendChat(text: string) {
    this._send({ type: "chat", text });
  }

  public sendReaction(reaction: TogetherReaction) {
    this._send({ type: "react", reaction });
  }

  /**
   * Tell the session whether the chat is on screen. While it is, new messages are read right away.
   */
  public setChatVisible(visible: boolean) {
    this._chatVisible = visible;
    if (visible && this.unread) {
      this.unread = 0;
      this.notify();
    }
  }

  public setAnyoneControls(anyoneControls: boolean) {
    this._send({ type: "settings", anyoneControls });
  }

  public onControl(listener: (state: TogetherState, byMe: boolean) => void) {
    this._controlListeners.add(listener);
    return () => this._controlListeners.delete(listener);
  }

  public onItem(listener: (itemId: number) => void) {
    this._itemListeners.add(listener);
    return () => this._itemListeners.delete(listener);
  }

  /**
   * Leave the room. Others carry on.
   */
  public leave() {
    this._send({ type: "leave" });
    this._finish(null);
  }

  /**
   * Host only: close the room for everyone.
   */
  public end() {
    this._send({ type: "end" });
  }

  private _disconnect() {
    const socket = this._socket;
    this._socket = null;
    if (this._pingTimer) clearInterval(this._pingTimer);
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000);
  }

  private _finish(reason: string | null) {
    this._disconnect();
    this.status = reason ? "ended" : "idle";
    this.endedReason = reason;
    this.room = null;
    this.memberId = null;
    this.code = null;
    this.messages = [];
    this.unread = 0;
    this.reactions = [];
    this._welcomeWaiters.splice(0).forEach((done) => done(false));
    try {
      sessionStorage.removeItem(TogetherSession.STORAGE_KEY);
    } catch {
      // Nothing stored
    }
    this.notify();
  }

  /**
   * Forget an ended session's message.
   */
  public dismissEnded() {
    if (this.status !== "ended") return;
    this.status = "idle";
    this.endedReason = null;
    this.notify();
  }
}

/**
 * "Firefox on a computer", "TV", "MediaHub": how other members see this device.
 */
function deviceLabel() {
  if (deviceMode.host === "mediahub") return "MediaHub";
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : t("together.device.browser");
  if (deviceMode.mode === "tv") return t("together.device.tv");
  return t(deviceMode.mode === "mobile" ? "together.device.onPhone" : "together.device.onComputer", { browser });
}

export const together = new TogetherSession();

export default together;
