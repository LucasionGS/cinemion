import type { TogetherAction, TogetherClientMessage, TogetherMember, TogetherRoom, TogetherServerMessage, TogetherState } from "@shared/together.ts";
import { MediaItem, User } from "../models/index.ts";
import Visibility from "../library/Visibility.ts";
import log from "../lib/Logger.ts";

/**
 * Rooms for watching together. Rooms live in memory: a restart ends them, and players simply carry on alone.
 */
export namespace WatchTogether {
  /**
   * What a room needs from a WebSocket.
   */
  export interface Socket {
    send(data: string): void;
    close(code?: number, reason?: string): void;
  }

  interface Member {
    id: string;
    user: User;
    socket: Socket;
    device: string;
    status: TogetherMember["status"];
    /**
     * Last reported position, and when (server ms).
     */
    position: number;
    reportedAt: number;
    joinedAt: number;
  }

  export interface Room {
    code: string;
    itemId: number;
    hostUserId: number;
    anyoneControls: boolean;
    state: TogetherState;
    members: Map<string, Member>;
    /**
     * When the last member left, so empty rooms can be closed. `null` while someone is in it.
     */
    emptySince: number | null;
  }

  // No 0/O or 1/I: codes get read out across the room
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const CODE_LENGTH = 7;
  /**
   * Empty rooms wait this long for people to come back (a page reload, the next episode loading).
   */
  const EMPTY_TIMEOUT = 2 * 60 * 1000;
  /**
   * How far from the shared position a member can drift and still count as in sync, in seconds.
   */
  const SYNC_TOLERANCE = 2.5;

  const _rooms = new Map<string, Room>();
  let _sweeper: ReturnType<typeof setInterval> | null = null;

  function newCode() {
    for (;;) {
      const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
      const code = [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
      if (!_rooms.has(code)) return code;
    }
  }

  /**
   * Where the shared playback is right now, in seconds.
   */
  export function positionNow(state: TogetherState, now = Date.now()) {
    return state.playing ? state.position + (now - state.at) / 1000 : state.position;
  }

  export function get(code: string) {
    return _rooms.get(code.toUpperCase()) ?? null;
  }

  /**
   * Open a room for `itemId`, starting at `position` seconds, paused until the host's player is ready.
   */
  export function create(host: User, itemId: number, position: number): Room {
    const room: Room = {
      code: newCode(),
      itemId,
      hostUserId: host.id,
      anyoneControls: true,
      state: { playing: false, position, at: Date.now() },
      members: new Map(),
      emptySince: Date.now(),
    };
    _rooms.set(room.code, room);
    log.info("Opened a watch together room", { code: room.code, host: host.name, item: itemId });
    startSweeper();
    return room;
  }

  function memberInfo(room: Room, m: Member, now: number): TogetherMember {
    const expected = positionNow(room.state, now);
    const reported = room.state.playing ? m.position + (now - m.reportedAt) / 1000 : m.position;
    return {
      id: m.id,
      profile: m.user.toProfileJSON(),
      device: m.device,
      status: m.status,
      inSync: m.status !== "loading" && Math.abs(reported - expected) < SYNC_TOLERANCE,
      isHost: m.user.id === room.hostUserId,
    };
  }

  export function info(room: Room): TogetherRoom {
    const now = Date.now();
    return {
      code: room.code,
      itemId: room.itemId,
      hostUserId: room.hostUserId,
      anyoneControls: room.anyoneControls,
      state: room.state,
      members: [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt).map((m) => memberInfo(room, m, now)),
    };
  }

  function send(socket: Socket, message: TogetherServerMessage) {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // The connection is closing; its close handler cleans up
    }
  }

  function broadcast(room: Room, message: TogetherServerMessage) {
    for (const m of room.members.values()) send(m.socket, message);
  }

  /**
   * Whether `member` may play, pause and seek. The host always can; others when allowed, or when the host isn't there.
   */
  function canControl(room: Room, member: Member) {
    if (member.user.id === room.hostUserId || room.anyoneControls) return true;
    return ![...room.members.values()].some((m) => m.user.id === room.hostUserId);
  }

  /**
   * A connection: waits for its "hello", then relays its messages to the room.
   */
  export class Connection {
    private _member: Member | null = null;
    private _room: Room | null = null;
    private _lastRoomBroadcast = 0;

    constructor(private readonly socket: Socket) { }

    public async receive(raw: string) {
      let message: TogetherClientMessage;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (message.type === "hello") return await this._hello(message);
      if (message.type === "ping") return send(this.socket, { type: "pong", t: message.t, serverTime: Date.now() });

      const room = this._room;
      const member = this._member;
      if (!room || !member) return send(this.socket, { type: "error", message: "Join a room first." });

      switch (message.type) {
        case "control":
          this._control(room, member, message.action, message.position);
          break;
        case "status":
          member.status = message.status;
          member.position = Number(message.position) || 0;
          member.reportedAt = Date.now();
          // Status changes every couple of seconds; others only need the overview now and then
          if (Date.now() - this._lastRoomBroadcast > 5000) {
            this._lastRoomBroadcast = Date.now();
            broadcast(room, { type: "room", room: info(room) });
          }
          break;
        case "item":
          if (member.user.id !== room.hostUserId) return send(this.socket, { type: "error", message: "Only the host can pick what's on." });
          room.itemId = Number(message.itemId);
          room.state = { playing: true, position: 0, at: Date.now() };
          broadcast(room, { type: "item", itemId: room.itemId, by: { memberId: member.id, name: member.user.name } });
          break;
        case "settings":
          if (member.user.id !== room.hostUserId) return send(this.socket, { type: "error", message: "Only the host can change this." });
          room.anyoneControls = !!message.anyoneControls;
          broadcast(room, { type: "room", room: info(room) });
          break;
        case "leave":
          this.close();
          this.socket.close(1000, "Left");
          break;
        case "end":
          if (member.user.id !== room.hostUserId) return send(this.socket, { type: "error", message: "Only the host can end the session for everyone." });
          end(room, `${member.user.name} ended the session.`);
          break;
      }
    }

    private async _hello(message: Extract<TogetherClientMessage, { type: "hello" }>) {
      const user = await User.fromToken(message.token ?? "");
      if (!user) {
        send(this.socket, { type: "error", message: "You need to sign in first." });
        return this.socket.close(4001, "Not signed in");
      }
      const room = get(String(message.code ?? ""));
      if (!room) {
        send(this.socket, { type: "ended", reason: "This watch together session has ended, or the code is wrong." });
        return this.socket.close(4004, "No such room");
      }
      const item = await MediaItem.findByPk(room.itemId);
      if (!item || !Visibility.canSee(user, item)) {
        send(this.socket, { type: "ended", reason: "This profile can't watch what's playing in that session." });
        return this.socket.close(4003, "Not allowed");
      }

      const member: Member = {
        id: crypto.randomUUID(),
        user,
        socket: this.socket,
        device: String(message.device ?? "").slice(0, 60) || "Browser",
        status: "loading",
        position: positionNow(room.state),
        reportedAt: Date.now(),
        joinedAt: Date.now(),
      };
      this._member = member;
      this._room = room;
      room.members.set(member.id, member);
      room.emptySince = null;
      send(this.socket, { type: "welcome", memberId: member.id, room: info(room), serverTime: Date.now() });
      broadcast(room, { type: "room", room: info(room) });
    }

    private _control(room: Room, member: Member, action: TogetherAction, position: number) {
      if (!canControl(room, member)) return send(this.socket, { type: "error", message: "Only the host can pause and seek in this session." });
      const pos = Math.max(0, Number(position) || 0);
      const playing = action === "play" ? true : action === "pause" ? false : room.state.playing;
      room.state = { playing, position: pos, at: Date.now() };
      member.position = pos;
      member.reportedAt = Date.now();
      broadcast(room, { type: "control", action, state: room.state, by: { memberId: member.id, name: member.user.name } });
    }

    /**
     * Take this connection out of its room.
     */
    public close() {
      const room = this._room;
      const member = this._member;
      this._room = null;
      this._member = null;
      if (!room || !member) return;
      room.members.delete(member.id);
      if (room.members.size === 0) room.emptySince = Date.now();
      else broadcast(room, { type: "room", room: info(room) });
    }
  }

  /**
   * Close a room for everyone.
   */
  export function end(room: Room, reason: string) {
    broadcast(room, { type: "ended", reason });
    for (const m of room.members.values()) {
      try {
        m.socket.close(1000, "Ended");
      } catch {
        // Already closed
      }
    }
    room.members.clear();
    _rooms.delete(room.code);
    log.info("Closed a watch together room", { code: room.code });
  }

  function startSweeper() {
    _sweeper ??= setInterval(() => {
      for (const room of _rooms.values()) {
        if (room.emptySince !== null && Date.now() - room.emptySince > EMPTY_TIMEOUT) end(room, "Everyone left.");
      }
    }, 30_000);
  }

  export function shutdown() {
    for (const room of [..._rooms.values()]) end(room, "The server is restarting.");
    if (_sweeper) clearInterval(_sweeper);
    _sweeper = null;
  }
}

export default WatchTogether;
