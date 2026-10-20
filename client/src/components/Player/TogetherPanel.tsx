import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, SendHorizontal, Users, X } from "lucide-react";
import { formatRoomCode, TOGETHER_CHAT_LIMIT, TOGETHER_REACTIONS, type TogetherChatMessage } from "@shared/together.ts";
import useController from "../../lib/useController.ts";
import { together } from "../../lib/Together.ts";
import { session } from "../../Session.ts";
import { toasts } from "../../lib/Toasts.ts";
import cx from "../../lib/cx.ts";
import Avatar from "../Avatar/Avatar.tsx";
import Button from "../Button/Button.tsx";
import IconButton from "../IconButton/IconButton.tsx";
import Switch from "../Switch/Switch.tsx";
import { formatClock } from "../../lib/playback.ts";
import type PlayerController from "./PlayerController.ts";

export interface TogetherPanelProps {
  controller: PlayerController;
}

const STATUS_TEXT = { loading: "Loading", buffering: "Buffering", ready: "In sync" };

type Tab = "chat" | "people";

/**
 * Start or manage a watch together session: the invite code, who's here, and who may control playback.
 */
export default function TogetherPanel(props: TogetherPanelProps) {
  const { controller } = props;
  const c = useController(controller);
  const t = useController(together);
  const [starting, setStarting] = useState(false);
  const connected = t.isConnected() && t.room?.itemId === c.item.id;
  const link = t.code ? `${location.origin}/together/${t.code}` : "";
  // Alone in a session, the invite is what's needed; with company, the chat
  const [tab, setTab] = useState<Tab>(() => (together.room?.members.length ?? 0) > 1 ? "chat" : "people");

  useEffect(() => {
    together.setChatVisible(connected && tab === "chat");
    return () => together.setChatVisible(false);
  }, [connected, tab]);

  async function start() {
    setStarting(true);
    try {
      await together.start(c.item.id, c.position);
      controller.connectTogether(together);
      // Starting shares where this player already is
      together.sendControl(c.playing ? "play" : "pause", c.position);
    } catch (error) {
      toasts.error("Couldn't start the session", (error as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toasts.success("Invite link copied");
    } catch {
      toasts.show({ title: "Share this link", description: link });
    }
  }

  return (
    <aside className="cn-track-panel cn-together-panel" aria-label="Watch together" data-focus-scope>
      <div className="cn-together-panel__header">
        <div>
          <h2>Watch together</h2>
          <span>Play, pause and seeking stay in sync for everyone.</span>
        </div>
        <IconButton label="Close" icon={<X />} variant="ghost" size="sm" onClick={() => controller.setTogetherOpen(false)} />
      </div>

      {!connected && (
        <div className="cn-together-panel__intro">
          <p>Start a session and share the code or link. Everyone watches on their own screen, from this server, in step with you.</p>
          {t.status === "connecting" && <p>Connecting…</p>}
          <Button variant="primary" icon={<Users />} loading={starting} onClick={start} data-autofocus>Start a session</Button>
        </div>
      )}

      {connected && t.room && (
        <div role="tablist" aria-label="Watch together" className="cn-together-panel__tabs">
          {(["chat", "people"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={cx("cn-track-panel__tab", tab === id && "cn-track-panel__tab--active")}
              onClick={() => setTab(id)}
            >
              {id === "chat" ? "Chat" : `People · ${t.room!.members.length}`}
              {id === "chat" && t.unread > 0 && <span className="cn-together-panel__unread" aria-label={`${t.unread} new`}>{t.unread}</span>}
            </button>
          ))}
        </div>
      )}

      {connected && t.room && tab === "chat" && <Chat />}

      {connected && t.room && tab === "people" && (
        <>
          <div className="cn-together-panel__section">
            <span className="cn-together-panel__label">Invite</span>
            <div className="cn-together-panel__invite">
              <span className="cn-together-panel__code" aria-label={`Code ${t.room.code.split("").join(" ")}`}>{formatRoomCode(t.room.code)}</span>
              <Button variant="primary" icon={<Copy />} onClick={copy}>Copy link</Button>
            </div>
          </div>
          <ul className="cn-together-panel__people" aria-label="People">
            {t.room.members.map((m) => (
              <li key={m.id} className="cn-together-panel__person">
                <Avatar profile={m.profile} size={2.5} />
                <span className="cn-together-panel__who">
                  <strong>{m.profile.name}{m.id === t.memberId ? " (you)" : ""}</strong>
                  <span>{[m.isHost ? "Host" : null, m.device].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={cx("cn-together-panel__status", `cn-together-panel__status--${m.status === "ready" && !m.inSync ? "drift" : m.status}`)}>
                  {m.status === "ready" && !m.inSync ? "Catching up" : STATUS_TEXT[m.status]}
                </span>
              </li>
            ))}
          </ul>
          <div className="cn-together-panel__footer">
            {t.isHost() && (
              <Switch label="Anyone can pause and seek" checked={t.room.anyoneControls} onChange={(on) => together.setAnyoneControls(on)} />
            )}
            {!t.isHost() && !t.room.anyoneControls && <p className="cn-together-panel__note">Only the host can pause and seek.</p>}
            <div className="cn-together-panel__actions">
              <Button
                variant="secondary"
                onClick={() => {
                  controller.disconnectTogether();
                  together.leave();
                }}
              >
                Leave
              </Button>
              {t.isHost() && <Button variant="danger" onClick={() => together.end()}>End for everyone</Button>}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * The room's messages, quick reactions and a box to write in.
 */
function Chat() {
  const t = useController(together);
  const [text, setText] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const stuckToBottom = useRef(true);

  // Follow new messages, unless the viewer scrolled up to read older ones
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stuckToBottom.current) el.scrollTop = el.scrollHeight;
  }, [t.messages]);

  function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    together.sendChat(text);
    setText("");
    stuckToBottom.current = true;
  }

  return (
    <div className="cn-together-chat" role="tabpanel">
      <ol
        ref={list}
        className="cn-together-chat__messages"
        aria-label="Messages"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {t.messages.length === 0 && <li className="cn-together-chat__empty">Say hi. Messages and reactions show for everyone in the session.</li>}
        {t.messages.map((m, i) => <ChatLine key={m.id} message={m} previous={t.messages[i - 1]} isMine={m.profile.id === session.user?.id} />)}
      </ol>
      <div className="cn-together-chat__reactions" aria-label="Reactions">
        {TOGETHER_REACTIONS.map((r) => (
          <button key={r} type="button" className="cn-together-chat__reaction" onClick={() => together.sendReaction(r)}>{r}</button>
        ))}
      </div>
      <form className="cn-together-chat__compose" onSubmit={send}>
        <input
          className="cn-field__input"
          value={text}
          maxLength={TOGETHER_CHAT_LIMIT}
          placeholder="Write a message"
          aria-label="Message"
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
        />
        <IconButton label="Send" icon={<SendHorizontal />} type="submit" disabled={!text.trim()} />
      </form>
    </div>
  );
}

function ChatLine(props: { message: TogetherChatMessage; previous?: TogetherChatMessage; isMine: boolean }) {
  const { message, previous, isMine } = props;
  // Messages from the same person within a couple of minutes share one name line
  const continued = previous?.memberId === message.memberId && message.at - previous.at < 2 * 60 * 1000;
  return (
    <li className={cx("cn-together-chat__line", continued && "cn-together-chat__line--continued")}>
      {!continued && <Avatar profile={message.profile} size={2} />}
      <div className="cn-together-chat__body">
        {!continued && (
          <span className="cn-together-chat__meta">
            <strong>{message.profile.name}{isMine ? " (you)" : ""}</strong>
            <span>at {formatClock(message.position)}</span>
          </span>
        )}
        <p>{message.text}</p>
      </div>
    </li>
  );
}
