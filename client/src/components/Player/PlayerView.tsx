import { type CSSProperties, Fragment, type ReactNode, useEffect, useRef } from "react";
import { Captions, ChevronLeft, ChevronsRight, Users, Maximize, Minimize, Pause, PictureInPicture2, Play, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import useController from "../../lib/useController.ts";
import { deviceMode } from "../../lib/DeviceMode.ts";
import { episodeLabel, formatClock } from "../../lib/playback.ts";
import { activeCues } from "../../lib/vtt.ts";
import cx from "../../lib/cx.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import Button from "../Button/Button.tsx";
import IconButton from "../IconButton/IconButton.tsx";
import Spinner from "../Spinner/Spinner.tsx";
import Scrubber from "./Scrubber.tsx";
import TrackPanel, { modeLabel } from "./TrackPanel.tsx";
import Thumbnail from "./Thumbnail.tsx";
import SubtitleSearchDialog from "./SubtitleSearchDialog.tsx";
import TogetherPanel from "./TogetherPanel.tsx";
import Avatar from "../Avatar/Avatar.tsx";
import { together } from "../../lib/Together.ts";
import { toasts } from "../../lib/Toasts.ts";
import { formatDate } from "../../lib/format.ts";
import { session } from "../../Session.ts";
import { DEFAULT_PREFERENCES } from "@shared/profiles.ts";
import type PlayerController from "./PlayerController.ts";
import "./Player.scss";

export interface PlayerViewProps {
  controller: PlayerController;
  /**
   * Where playback starts, in seconds.
   */
  startAt: number;
}

/**
 * The full-screen player: video, subtitles, controls for desktop, phones and TVs, the track panel and "Up next".
 */
export default function PlayerView(props: PlayerViewProps) {
  const { controller, startAt } = props;
  const c = useController(controller);
  const { mode } = useController(deviceMode);
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const scrubSteps = useRef({ last: 0, count: 0 });

  useEffect(() => {
    controller.attach(video.current!, startAt);
    return () => controller.destroy();
  }, [controller]);

  // Follow the watch together session while it's about this title
  const t = useController(together);
  const following = t.isConnected() && t.room?.itemId === c.item.id;
  useEffect(() => {
    if (following) controller.connectTogether(together);
    else controller.disconnectTogether();
  }, [following, controller]);

  useEffect(() => {
    if (t.status !== "ended" || !t.endedReason) return;
    toasts.show({ title: "Watch together ended", description: t.endedReason });
    together.dismissEnded();
  }, [t.status, t.endedReason]);

  // Remote, keyboard and media keys. Runs before the app's spatial navigation, which skips handled keys.
  useEffect(() => {
    const isTv = mode === "tv";

    function scrubStep() {
      // Holding or tapping quickly speeds up: 10 s, then 30 s, then a minute per press
      const now = performance.now();
      const steps = scrubSteps.current;
      steps.count = now - steps.last < 600 ? steps.count + 1 : 0;
      steps.last = now;
      return steps.count > 12 ? 60 : steps.count > 5 ? 30 : 10;
    }

    function focusScrubber() {
      root.current?.querySelector<HTMLElement>("[data-scrubber]")?.focus({ preventScroll: true });
    }

    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      // Dialogs over the player handle their own keys
      if (controller.subtitleSearchOpen || (document.activeElement as HTMLElement | null)?.closest(".cn-dialog")) return;
      const active = document.activeElement as HTMLElement | null;
      // Writing in the chat: keys are letters, except Escape
      const typing = (active instanceof HTMLInputElement && active.type !== "range") || active instanceof HTMLTextAreaElement;
      if (typing && e.key !== "Escape") return;
      const inPanel = !!active?.closest(".cn-track-panel");
      const onScrubber = !!active?.hasAttribute("data-scrubber");
      const onControl = !!active && active !== document.body && !!root.current?.contains(active) && !onScrubber;
      const wasHidden = !controller.controlsVisible;
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      switch (e.key) {
        case " ":
        case "k":
        case "MediaPlayPause":
          if (inPanel && e.key === " ") return;
          handled();
          controller.togglePlay();
          controller.showControls();
          return;
        case "MediaPlay":
          handled();
          controller.play();
          return;
        case "MediaPause":
        case "MediaStop":
          handled();
          controller.pause();
          return;
        case "MediaFastForward":
        case "MediaRewind":
          handled();
          controller.seekBy(e.key === "MediaRewind" ? -10 : 10);
          return;
        case "MediaTrackNext":
          if (!controller.next) return;
          handled();
          controller.playNext();
          return;
        case "ArrowLeft":
        case "ArrowRight": {
          if (inPanel) return;
          const direction = e.key === "ArrowLeft" ? -1 : 1;
          if (isTv) {
            // Left and right scrub from the seek bar, or whenever the controls are hidden
            if (onControl && !wasHidden) return;
            handled();
            controller.scrubBy(direction * scrubStep());
            focusScrubber();
            return;
          }
          if (active instanceof HTMLInputElement && active.type === "range") return;
          handled();
          controller.seekBy(direction * 10);
          return;
        }
        case "ArrowUp":
        case "ArrowDown":
          if (inPanel) return;
          if (isTv) {
            controller.showControls();
            if (wasHidden || !active || active === document.body) {
              handled();
              focusScrubber();
            }
            return;
          }
          handled();
          controller.setVolume(controller.volume + (e.key === "ArrowUp" ? 0.05 : -0.05));
          controller.showControls();
          return;
        case "Enter":
          if (controller.scrubTarget !== null) {
            handled();
            controller.commitScrub();
            return;
          }
          if (isTv && (wasHidden || onScrubber)) {
            handled();
            controller.togglePlay();
            controller.showControls();
          }
          return;
        case "Escape":
        case "Backspace":
        case "GoBack":
        case "BrowserBack":
          if (controller.scrubTarget !== null) {
            handled();
            controller.cancelScrub();
            return;
          }
          if (controller.togetherOpen) {
            handled();
            controller.setTogetherOpen(false);
            return;
          }
          if (controller.panelOpen) {
            handled();
            controller.closePanel();
            root.current?.querySelector<HTMLElement>("[data-panel-toggle]")?.focus({ preventScroll: true });
            return;
          }
          // On TV, Back first hides the controls; the next Back leaves the player
          if (isTv && !wasHidden && controller.playing) {
            handled();
            controller.hideControls();
            return;
          }
          if (e.key === "Escape" && !isTv) return;
          handled();
          controller.onExit();
          return;
        case "f":
          if (isTv) return;
          handled();
          controller.toggleFullscreen(root.current!);
          return;
        case "m":
          handled();
          controller.toggleMute();
          controller.showControls();
          return;
        case "c":
          handled();
          controller.openPanel("subtitles");
          return;
        default:
          controller.showControls();
      }
    }

    addEventListener("keydown", onKey, { capture: true });
    return () => removeEventListener("keydown", onKey, { capture: true });
  }, [controller, mode]);

  // When TV controls appear, the remote starts on the seek bar
  useEffect(() => {
    if (mode !== "tv" || !c.controlsVisible) return;
    const active = document.activeElement;
    if (!active || active === document.body || !root.current?.contains(active)) {
      root.current?.querySelector<HTMLElement>("[data-scrubber]")?.focus({ preventScroll: true });
    }
  }, [mode, c.controlsVisible]);

  function onSurfaceClick() {
    if (mode === "mobile") {
      if (c.controlsVisible) controller.hideControls();
      else controller.showControls();
      return;
    }
    if (c.panelOpen) {
      controller.closePanel();
      return;
    }
    controller.togglePlay();
  }

  const item = c.item;
  const title = item.type === "episode" ? item.showTitle ?? item.title : item.title;
  const subtitle = item.type === "episode" ? `${episodeLabel(item)} · ${item.title}` : item.type === "video" ? (item.releaseDate ? formatDate(item.releaseDate) : null) : item.year ? String(item.year) : null;
  const cues = c.subtitleIndex !== null ? activeCues(c.cues, c.position) : [];
  const style = useController(session).user?.preferences.subtitles ?? DEFAULT_PREFERENCES.subtitles;
  const idle = !c.controlsVisible && !c.loading && !c.error;

  return (
    <div
      ref={root}
      className={cx("cn-player", "cn-dark-theme", `cn-player--${mode}`, idle && "cn-player--idle", c.panelOpen && "cn-player--panel")}
      onPointerMove={(e) => e.pointerType === "mouse" && controller.showControls()}
    >
      <video ref={video} className="cn-player__video" playsInline autoPlay preload="auto" />
      <div className="cn-player__surface" onClick={onSurfaceClick} onDoubleClick={() => mode === "desktop" && controller.toggleFullscreen(root.current!)} />

      {cues.length > 0 && !c.styled && (
        <div className={cx("cn-player__subtitles", `cn-player__subtitles--${style.size}`, `cn-player__subtitles--${style.color}`, `cn-player__subtitles--${style.background}`)} aria-live="off">
          {cues.map((cue) => <span key={cue.start + cue.text}>{renderCueText(cue.text)}</span>)}
        </div>
      )}

      {(c.loading || c.buffering) && !c.error && (
        <div className="cn-player__spinner"><Spinner size="3.5rem" label="Loading" /></div>
      )}

      {c.error && (
        <div className="cn-player__error" role="alert" data-focus-scope>
          <h2>This video can't play right now</h2>
          <p>{c.error}</p>
          <div className="cn-player__error-actions">
            <Button variant="primary" onClick={() => controller.load({ startAt: c.position })} data-autofocus>Try again</Button>
            <Button onClick={() => controller.onExit()}>Back</Button>
          </div>
        </div>
      )}

      <div className="cn-player__chrome" aria-hidden={idle || undefined}>
        <div className="cn-player__shade cn-player__shade--top" />
        <div className="cn-player__shade cn-player__shade--bottom" />

        <header className="cn-player__top">
          {mode !== "tv" && <IconButton label="Back" icon={<ChevronLeft />} variant="ghost" onClick={() => controller.onExit()} />}
          <div className="cn-player__titles">
            <span className="cn-player__title">{title}</span>
            {subtitle && <span className="cn-player__subtitle">{subtitle}</span>}
          </div>
          {mode === "mobile" && <TogetherButton controller={controller} />}
          {mode === "mobile" && <PanelToggle controller={controller} />}
        </header>

        {mode === "mobile" && (
          <div className="cn-player__center">
            <IconButton label="Back 10 seconds" icon={<SkipIcon direction={-1} />} variant="ghost" size="lg" onClick={() => controller.seekBy(-10)} />
            <IconButton label={c.playing ? "Pause" : "Play"} icon={c.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />} size="lg" className="cn-player__big-play" onClick={() => controller.togglePlay()} />
            <IconButton label="Forward 10 seconds" icon={<SkipIcon direction={1} />} variant="ghost" size="lg" onClick={() => controller.seekBy(10)} />
          </div>
        )}

        {mode === "tv" && c.scrubTarget !== null && c.trickplay && <Filmstrip controller={controller} />}

        <div className="cn-player__bottom">
          {mode === "mobile" && (
            <div className="cn-player__times">
              <span>{formatClock(c.position)}</span>
              <span>-{formatClock(Math.max(0, c.duration - c.position))}</span>
            </div>
          )}
          <Scrubber controller={controller} />
          {mode === "tv" ? <TvRow controller={controller} /> : mode === "mobile" ? <MobileRow controller={controller} root={root} /> : <DesktopRow controller={controller} root={root} />}
        </div>
      </div>

      {c.panelOpen && <TrackPanel controller={controller} />}
      {c.togetherOpen && <TogetherPanel controller={controller} />}
      {t.notice && (
        <div key={t.notice.id} className="cn-together-notice" role="status">
          {t.notice.profile && <Avatar profile={t.notice.profile} size={1.75} />}
          <span>{t.notice.text}</span>
        </div>
      )}
      {t.reactions.length > 0 && (
        <div className="cn-reactions" aria-hidden="true">
          {t.reactions.map((r) => (
            <span key={r.id} className="cn-reactions__item" style={{ "--lane": r.lane } as CSSProperties}>
              <span className="cn-reactions__emoji">{r.reaction}</span>
              <span className="cn-reactions__name">{r.profile.name}</span>
            </span>
          ))}
        </div>
      )}
      {c.info?.canSearchSubtitles && (
        <SubtitleSearchDialog controller={controller} open={c.subtitleSearchOpen} onOpenChange={(open) => controller.setSubtitleSearchOpen(open)} container={root.current} />
      )}
      {c.intro && !c.error && c.nextCountdown === null && <SkipIntro controller={controller} />}
      {c.nextCountdown !== null && c.next && !c.error && <NextUp controller={controller} />}
    </div>
  );
}

function DesktopRow(props: { controller: PlayerController; root: React.RefObject<HTMLDivElement | null> }) {
  const { controller, root } = props;
  const c = useController(controller);
  const VolumeIcon = c.muted || c.volume === 0 ? VolumeX : c.volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="cn-player__row">
      <IconButton label={c.playing ? "Pause (Space)" : "Play (Space)"} icon={c.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />} variant="ghost" onClick={() => controller.togglePlay()} />
      <IconButton label="Back 10 seconds (←)" icon={<SkipIcon direction={-1} />} variant="ghost" onClick={() => controller.seekBy(-10)} />
      <IconButton label="Forward 10 seconds (→)" icon={<SkipIcon direction={1} />} variant="ghost" onClick={() => controller.seekBy(10)} />
      {c.next && <IconButton label="Next episode" icon={<SkipForward />} variant="ghost" onClick={() => controller.playNext()} />}
      <div className="cn-player__volume">
        <IconButton label={c.muted ? "Unmute (M)" : "Mute (M)"} icon={<VolumeIcon />} variant="ghost" onClick={() => controller.toggleMute()} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={c.muted ? 0 : c.volume}
          aria-label="Volume"
          className="cn-player__volume-slider"
          style={{ "--value": `${(c.muted ? 0 : c.volume) * 100}%` } as React.CSSProperties}
          onChange={(e) => controller.setVolume(Number(e.target.value))}
        />
      </div>
      <span className="cn-player__clock">{formatClock(c.position)} <span>/ {formatClock(c.duration)}</span></span>
      <div className="cn-player__end">
        <StreamBadge controller={controller} />
        <PanelToggle controller={controller} />
        <TogetherButton controller={controller} />
        {document.pictureInPictureEnabled && <IconButton label="Picture in picture" icon={<PictureInPicture2 />} variant="ghost" onClick={() => controller.togglePictureInPicture()} />}
        <IconButton label={c.fullscreen ? "Exit full screen (F)" : "Full screen (F)"} icon={c.fullscreen ? <Minimize /> : <Maximize />} variant="ghost" onClick={() => controller.toggleFullscreen(root.current!)} />
      </div>
    </div>
  );
}

function MobileRow(props: { controller: PlayerController; root: React.RefObject<HTMLDivElement | null> }) {
  const { controller, root } = props;
  const c = useController(controller);
  return (
    <div className="cn-player__row">
      {c.next && <Button variant="ghost" size="sm" icon={<SkipForward />} onClick={() => controller.playNext()}>Next episode</Button>}
      <div className="cn-player__end">
        <StreamBadge controller={controller} />
        <IconButton label={c.fullscreen ? "Exit full screen" : "Full screen"} icon={c.fullscreen ? <Minimize /> : <Maximize />} variant="ghost" onClick={() => controller.toggleFullscreen(root.current!)} />
      </div>
    </div>
  );
}

function TvRow(props: { controller: PlayerController }) {
  const { controller } = props;
  const c = useController(controller);

  if (c.scrubTarget !== null) {
    const delta = c.scrubTarget - c.position;
    return (
      <div className="cn-player__row">
        <span className="cn-player__clock">{formatClock(c.scrubTarget)} <span>/ {formatClock(c.duration)}</span></span>
        <span className="cn-player__delta">{delta >= 0 ? "+" : "-"}{formatClock(Math.abs(delta))}</span>
        <div className="cn-player__hints">
          <Hint keys="◀ ▶">Seek</Hint>
          <Hint keys="OK">Jump here</Hint>
          <Hint keys="Back">Cancel</Hint>
        </div>
      </div>
    );
  }

  return (
    <div className="cn-player__row">
      <span className="cn-player__clock">{formatClock(c.position)} <span>/ {formatClock(c.duration)}</span></span>
      <div className="cn-player__end">
        <StreamBadge controller={controller} />
        <Button variant="secondary" icon={c.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />} onClick={() => controller.togglePlay()}>{c.playing ? "Pause" : "Play"}</Button>
        <Button variant="secondary" icon={<Captions />} onClick={() => controller.openPanel()} data-panel-toggle>Subtitles &amp; audio</Button>
        <TogetherButton controller={controller} />
        {c.next && <Button variant="secondary" icon={<SkipForward />} onClick={() => controller.playNext()}>Next episode</Button>}
      </div>
    </div>
  );
}

/**
 * TV scrubbing: the frame being jumped to, large, with the frames around it.
 */
function Filmstrip(props: { controller: PlayerController }) {
  const { scrubTarget, trickplay, duration } = useController(props.controller);
  if (scrubTarget === null || !trickplay) return null;
  const step = Math.max(10, trickplay.interval);
  const frames = [-3, -2, -1, 0, 1, 2, 3].map((k) => ({ k, time: scrubTarget + k * step })).filter((f) => f.time >= 0 && f.time <= duration);

  return (
    <div className="cn-filmstrip" aria-hidden="true">
      {frames.map(({ k, time }) => (
        <div key={k} className={cx("cn-filmstrip__frame", k === 0 && "cn-filmstrip__frame--current")} style={{ opacity: 1 - Math.abs(k) * 0.22 }}>
          <Thumbnail trickplay={trickplay} time={time} className="cn-filmstrip__image" />
          <span>{formatClock(time)}</span>
        </div>
      ))}
    </div>
  );
}

function Hint(props: { keys: string; children: ReactNode }) {
  return <span className="cn-player__hint"><kbd>{props.keys}</kbd>{props.children}</span>;
}

/**
 * Opens the watch together panel. While in a session it shows how many are watching.
 */
function TogetherButton(props: { controller: PlayerController }) {
  const { controller } = props;
  const { togetherOpen, item } = useController(controller);
  const t = useController(together);
  const { mode } = useController(deviceMode);
  const count = t.isConnected() && t.room?.itemId === item.id ? t.room.members.length : 0;
  const toggle = () => controller.setTogetherOpen(!togetherOpen);
  const unread = count && !togetherOpen && t.unread > 0 ? <span className="cn-player__unread" aria-label={`${t.unread} new messages`}>{t.unread}</span> : null;

  if (mode === "tv") {
    return <Button variant="secondary" icon={<Users />} onClick={toggle}>{count ? `${count} watching` : "Watch together"}{unread}</Button>;
  }
  if (count > 0) {
    return (
      <button type="button" className={cx("cn-player__watching", togetherOpen && "cn-player__watching--open")} aria-expanded={togetherOpen} onClick={toggle}>
        <Users aria-hidden="true" /> {count} watching{unread}
      </button>
    );
  }
  return <IconButton label="Watch together" icon={<Users />} variant="ghost" className={cx(togetherOpen && "cn-player__panel-toggle--open")} aria-expanded={togetherOpen} onClick={toggle} />;
}

function PanelToggle(props: { controller: PlayerController }) {
  const { controller } = props;
  const { panelOpen } = useController(controller);
  return (
    <IconButton
      label="Subtitles, audio and quality (C)"
      icon={<Captions />}
      variant="ghost"
      className={cx("cn-player__panel-toggle", panelOpen && "cn-player__panel-toggle--open")}
      aria-expanded={panelOpen}
      data-panel-toggle
      onClick={() => panelOpen ? controller.closePanel() : controller.openPanel()}
    />
  );
}

function StreamBadge(props: { controller: PlayerController }) {
  const { info, currentHeight } = useController(props.controller);
  if (!info) return null;
  // With automatic quality, the size playing now
  const height = info.video.ladder ? currentHeight : info.video.height;
  const size = height ? (height >= 2000 ? "4K" : `${height}p`) : null;
  // Repackaging doesn't touch the picture or sound, so it reads as direct too
  const label = info.mode !== "transcode" ? "Direct" : info.video.action === "copy" ? "Audio converted" : info.video.ladder ? "Auto" : "Converted";
  const text = [size, info.video.hdr ? "HDR" : null, label].filter(Boolean).join(" · ");
  // On TV it's only a label; the remote shouldn't stop on it
  if (deviceMode.isTv()) return <span className="cn-player__badge">{text}</span>;
  return (
    <button type="button" className="cn-player__badge" title={modeLabel(info)} tabIndex={-1} onClick={() => props.controller.openPanel("quality")}>
      {text}
    </button>
  );
}

/**
 * "Skip intro", while an intro plays. It stays up when the controls hide, since that's when it's needed.
 */
function SkipIntro(props: { controller: PlayerController }) {
  const { controller } = props;
  const c = useController(controller);
  return (
    <div className={cx("cn-skip", c.controlsVisible && "cn-skip--raised")} data-focus-scope={deviceMode.isTv() ? true : undefined}>
      <Button variant="secondary" icon={<ChevronsRight />} onClick={() => controller.skipIntro()} data-autofocus={deviceMode.isTv() || undefined}>Skip intro</Button>
    </div>
  );
}

function NextUp(props: { controller: PlayerController }) {
  const { controller } = props;
  const { next, nextCountdown } = useController(controller);
  if (!next) return null;
  const image = next.artwork.thumb ?? next.artwork.backdrop;

  return (
    <div className="cn-next-up" role="region" aria-label="Up next" data-focus-scope={deviceMode.isTv() ? true : undefined}>
      {image && <img src={ItemsApi.imageUrl(image, 342)} alt="" className="cn-next-up__image" />}
      <div className="cn-next-up__body">
        <span className="cn-next-up__eyebrow">{next.type === "episode" ? `Up next · ${episodeLabel(next)}` : "Up next"}</span>
        <strong>{next.title}</strong>
        <span className="cn-next-up__countdown">Starts in {nextCountdown} s</span>
        <div className="cn-next-up__actions">
          <Button variant="primary" size="sm" icon={<Play fill="currentColor" />} onClick={() => controller.playNext()} data-autofocus>Play now</Button>
          <Button variant="ghost" size="sm" onClick={() => controller.dismissNext()}>Hide</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The circular "10" arrows of the seek buttons.
 */
function SkipIcon(props: { direction: 1 | -1 }) {
  const back = props.direction < 0;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {back ? <path d="M4 12a8 8 0 1 0 2.5-5.8" /> : <path d="M20 12a8 8 0 1 1-2.5-5.8" />}
      {back ? <path d="M4 4v4h4" /> : <path d="M20 4v4h-4" />}
      <text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none" fontFamily="var(--cn-font-body)">10</text>
    </svg>
  );
}

/**
 * Subtitle text with its line breaks and `<i>`, `<b>`, `<u>` tags, without using raw HTML.
 */
function renderCueText(text: string): ReactNode {
  const out: ReactNode[] = [];
  const stack: { tag: string; children: ReactNode[] }[] = [{ tag: "", children: out }];
  let key = 0;
  for (const part of text.split(/(<\/?[ibu]>|\n)/)) {
    if (!part) continue;
    const top = stack[stack.length - 1];
    const open = part.match(/^<([ibu])>$/);
    const close = part.match(/^<\/([ibu])>$/);
    if (part === "\n") top.children.push(<br key={key++} />);
    else if (open) stack.push({ tag: open[1], children: [] });
    else if (close && stack.length > 1) {
      const done = stack.pop()!;
      const Tag = done.tag === "i" ? "i" : done.tag === "b" ? "b" : "u";
      stack[stack.length - 1].children.push(<Tag key={key++}>{done.children}</Tag>);
    }
    else if (!close) top.children.push(<Fragment key={key++}>{part}</Fragment>);
  }
  // Tags left open at the end still apply
  while (stack.length > 1) {
    const done = stack.pop()!;
    stack[stack.length - 1].children.push(<Fragment key={key++}>{done.children}</Fragment>);
  }
  return out;
}
