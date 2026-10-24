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
import { t, type TranslationKey } from "../../i18n/I18n.ts";
import type PlayerController from "./PlayerController.ts";

export interface TogetherPanelProps {
  controller: PlayerController;
}

const STATUS_TEXT: Record<"loading" | "buffering" | "ready", TranslationKey> = {
  loading: "together.panel.status.loading",
  buffering: "together.panel.status.buffering",
  ready: "together.panel.status.ready",
};

type Tab = "chat" | "people";

/**
 * Start or manage a watch together session: the invite code, who's here, and who may control playback.
 */
export default function TogetherPanel(props: TogetherPanelProps) {
  const { controller } = props;
  const c = useController(controller);
  const group = useController(together);
  const [starting, setStarting] = useState(false);
  const connected = group.isConnected() && group.room?.itemId === c.item.id;
  const link = group.code ? `${location.origin}/together/${group.code}` : "";
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
      toasts.error(t("together.panel.startFailed"), (error as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toasts.success(t("together.panel.linkCopied"));
    } catch {
      toasts.show({ title: t("together.panel.shareLink"), description: link });
    }
  }

  return (
    <aside className="cn-track-panel cn-together-panel" aria-label={t("together.panel.title")} data-focus-scope>
      <div className="cn-together-panel__header">
        <div>
          <h2>{t("together.panel.title")}</h2>
          <span>{t("together.panel.intro")}</span>
        </div>
        <IconButton label={t("common.close")} icon={<X />} variant="ghost" size="sm" onClick={() => controller.setTogetherOpen(false)} />
      </div>

      {!connected && (
        <div className="cn-together-panel__intro">
          <p>{t("together.panel.pitch")}</p>
          {group.status === "connecting" && <p>{t("together.panel.connecting")}</p>}
          <Button variant="primary" icon={<Users />} loading={starting} onClick={start} data-autofocus>{t("together.panel.start")}</Button>
        </div>
      )}

      {connected && group.room && (
        <div role="tablist" aria-label={t("together.panel.title")} className="cn-together-panel__tabs">
          {(["chat", "people"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={cx("cn-track-panel__tab", tab === id && "cn-track-panel__tab--active")}
              onClick={() => setTab(id)}
            >
              {id === "chat" ? t("together.panel.tabs.chat") : t("together.panel.tabs.people", { count: group.room!.members.length })}
              {id === "chat" && group.unread > 0 && <span className="cn-together-panel__unread" aria-label={t("together.panel.tabs.unread", { count: group.unread })}>{group.unread}</span>}
            </button>
          ))}
        </div>
      )}

      {connected && group.room && tab === "chat" && <Chat />}

      {connected && group.room && tab === "people" && (
        <>
          <div className="cn-together-panel__section">
            <span className="cn-together-panel__label">{t("together.panel.invite")}</span>
            <div className="cn-together-panel__invite">
              <span className="cn-together-panel__code" aria-label={t("together.panel.code", { code: group.room.code.split("").join(" ") })}>{formatRoomCode(group.room.code)}</span>
              <Button variant="primary" icon={<Copy />} onClick={copy}>{t("together.panel.copyLink")}</Button>
            </div>
          </div>
          <ul className="cn-together-panel__people" aria-label={t("together.panel.people")}>
            {group.room.members.map((m) => (
              <li key={m.id} className="cn-together-panel__person">
                <Avatar profile={m.profile} size={2.5} />
                <span className="cn-together-panel__who">
                  <strong>{m.id === group.memberId ? t("together.panel.you", { name: m.profile.name }) : m.profile.name}</strong>
                  <span>{m.isHost ? (m.device ? t("together.panel.hostOnDevice", { device: m.device }) : t("together.panel.host")) : m.device}</span>
                </span>
                <span className={cx("cn-together-panel__status", `cn-together-panel__status--${m.status === "ready" && !m.inSync ? "drift" : m.status}`)}>
                  {m.status === "ready" && !m.inSync ? t("together.panel.status.catchingUp") : t(STATUS_TEXT[m.status])}
                </span>
              </li>
            ))}
          </ul>
          <div className="cn-together-panel__footer">
            {group.isHost() && (
              <Switch label={t("together.panel.anyoneControls")} checked={group.room.anyoneControls} onChange={(on) => together.setAnyoneControls(on)} />
            )}
            {!group.isHost() && !group.room.anyoneControls && <p className="cn-together-panel__note">{t("together.panel.onlyHostNote")}</p>}
            <div className="cn-together-panel__actions">
              <Button
                variant="secondary"
                onClick={() => {
                  controller.disconnectTogether();
                  together.leave();
                }}
              >
                {t("together.panel.leave")}
              </Button>
              {group.isHost() && <Button variant="danger" onClick={() => together.end()}>{t("together.panel.endForEveryone")}</Button>}
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
  const group = useController(together);
  const [text, setText] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const stuckToBottom = useRef(true);

  // Follow new messages, unless the viewer scrolled up to read older ones
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stuckToBottom.current) el.scrollTop = el.scrollHeight;
  }, [group.messages]);

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
        aria-label={t("together.chat.messages")}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {group.messages.length === 0 && <li className="cn-together-chat__empty">{t("together.chat.empty")}</li>}
        {group.messages.map((m, i) => <ChatLine key={m.id} message={m} previous={group.messages[i - 1]} isMine={m.profile.id === session.user?.id} />)}
      </ol>
      <div className="cn-together-chat__reactions" aria-label={t("together.chat.reactions")}>
        {TOGETHER_REACTIONS.map((r) => (
          <button key={r} type="button" className="cn-together-chat__reaction" onClick={() => together.sendReaction(r)}>{r}</button>
        ))}
      </div>
      <form className="cn-together-chat__compose" onSubmit={send}>
        <input
          className="cn-field__input"
          value={text}
          maxLength={TOGETHER_CHAT_LIMIT}
          placeholder={t("together.chat.placeholder")}
          aria-label={t("together.chat.message")}
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
        />
        <IconButton label={t("together.chat.send")} icon={<SendHorizontal />} type="submit" disabled={!text.trim()} />
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
            <strong>{isMine ? t("together.panel.you", { name: message.profile.name }) : message.profile.name}</strong>
            <span>{t("together.chat.at", { time: formatClock(message.position) })}</span>
          </span>
        )}
        <p>{message.text}</p>
      </div>
    </li>
  );
}
