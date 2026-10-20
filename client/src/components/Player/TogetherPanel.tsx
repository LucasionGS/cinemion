import { useState } from "react";
import { Copy, Users, X } from "lucide-react";
import { formatRoomCode } from "@shared/together.ts";
import useController from "../../lib/useController.ts";
import { together } from "../../lib/Together.ts";
import { toasts } from "../../lib/Toasts.ts";
import cx from "../../lib/cx.ts";
import Avatar from "../Avatar/Avatar.tsx";
import Button from "../Button/Button.tsx";
import IconButton from "../IconButton/IconButton.tsx";
import Switch from "../Switch/Switch.tsx";
import type PlayerController from "./PlayerController.ts";

export interface TogetherPanelProps {
  controller: PlayerController;
}

const STATUS_TEXT = { loading: "Loading", buffering: "Buffering", ready: "In sync" };

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
