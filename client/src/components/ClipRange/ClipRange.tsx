import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { ItemDetail } from "@shared/media.ts";
import PlayerController from "../Player/PlayerController.ts";
import useController from "../../lib/useController.ts";
import { formatClock } from "../../lib/playback.ts";
import cx from "../../lib/cx.ts";
import { rich, t } from "../../i18n/I18n.ts";
import IconButton from "../IconButton/IconButton.tsx";
import "./ClipRange.scss";

export interface ClipRangeProps {
  item: ItemDetail;
  duration: number;
  /**
   * The part that's kept, in seconds.
   */
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  /**
   * Where the start may go, like the keyframes of a cut that isn't converted. The start snaps to the one at or
   * before where it's put. Left out = anywhere.
   */
  snapStart?: number[];
}

const NUDGE = 0.1;
const NUDGE_BIG = 1;
const MIN_LENGTH = 0.5;

/**
 * Choose a part of a clip: a preview of the video, and a bar with handles for the start and the end. The preview
 * jumps to whichever handle moves, and "Play" plays just the chosen part.
 */
export default function ClipRange(props: ClipRangeProps) {
  const { item, duration, start, end, onChange, snapStart } = props;
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  // The preview streams through the regular player, so clips the browser can't play directly still show
  const controller = useMemo(() => new PlayerController(item, () => { }, () => { }), [item.id]);
  useController(controller);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    controller.attach(el, start);
    controller.pause();
    return () => controller.destroy();
  }, [controller]);

  // Stop at the end of the chosen part
  const position = controller.position;
  useEffect(() => {
    if (controller.playing && position >= end) {
      controller.pause();
      controller.seek(start);
    }
  }, [position, end]);

  function snap(time: number) {
    if (!snapStart?.length) return time;
    return [...snapStart].reverse().find((k) => k <= time + 0.001) ?? 0;
  }

  /**
   * Move a handle. The preview follows, except while dragging: every jump could start a new conversion.
   */
  function set(handle: "start" | "end", time: number, preview = true) {
    const clamped = Math.max(0, Math.min(duration, time));
    if (handle === "start") {
      const next = snap(Math.min(clamped, end - MIN_LENGTH));
      onChange(next, end);
      if (preview) controller.seek(next);
    }
    else {
      const next = Math.max(clamped, start + MIN_LENGTH);
      onChange(start, next);
      if (preview) controller.seek(Math.max(start, next - 0.5));
    }
  }

  function endDrag() {
    if (!dragging) return;
    controller.seek(dragging === "start" ? start : Math.max(start, end - 0.5));
    setDragging(null);
  }

  function timeAt(clientX: number) {
    const rect = track.current!.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * duration;
  }

  function onPointerDown(handle: "start" | "end") {
    return (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(handle);
      controller.pause();
    };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (dragging) set(dragging, timeAt(e.clientX), false);
  }

  function onKey(handle: "start" | "end") {
    return (e: KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? NUDGE_BIG : NUDGE;
      const current = handle === "start" ? start : end;
      // Snapped starts move a keyframe at a time
      if (handle === "start" && snapStart?.length && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        const index = snapStart.indexOf(start);
        const next = snapStart[Math.max(0, Math.min(snapStart.length - 1, index + (e.key === "ArrowRight" ? 1 : -1)))];
        if (next < end - MIN_LENGTH) set("start", next);
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowUp") set(handle, current + step);
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") set(handle, current - step);
      else if (e.key === "Home") set(handle, 0);
      else if (e.key === "End") set(handle, duration);
      else return;
      e.preventDefault();
    };
  }

  function togglePlay() {
    if (controller.playing) {
      controller.pause();
      return;
    }
    if (position < start || position >= end - 0.1) controller.seek(start);
    controller.play();
  }

  const percent = (time: number) => `${duration ? (time / duration) * 100 : 0}%`;

  return (
    <div className="cn-clip-range">
      <div className="cn-clip-range__preview cn-dark-theme">
        <video ref={video} playsInline poster={item.artwork.thumb ? `/api/images/${item.artwork.thumb}?w=1280` : undefined} />
      </div>
      <div className="cn-clip-range__controls">
        <IconButton label={controller.playing ? t("clips.range.pause") : t("clips.range.play")} icon={controller.playing ? <Pause /> : <Play />} onClick={togglePlay} />
        <div
          ref={track}
          className="cn-clip-range__track"
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerDown={(e) => controller.seek(Math.max(0, Math.min(duration, timeAt(e.clientX))))}
        >
          {snapStart?.map((k) => <span key={k} className="cn-clip-range__tick" style={{ left: percent(k) }} />)}
          <span className="cn-clip-range__part" style={{ left: percent(start), width: percent(end - start) }} />
          <span className="cn-clip-range__playhead" style={{ left: percent(position) }} />
          {(["start", "end"] as const).map((handle) => (
            <div
              key={handle}
              role="slider"
              tabIndex={0}
              aria-label={handle === "start" ? t("clips.range.start") : t("clips.range.end")}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration * 10) / 10}
              aria-valuenow={Math.round((handle === "start" ? start : end) * 10) / 10}
              aria-valuetext={formatClock(handle === "start" ? start : end)}
              className={cx("cn-clip-range__handle", `cn-clip-range__handle--${handle}`, dragging === handle && "cn-clip-range__handle--dragging")}
              style={{ left: percent(handle === "start" ? start : end) }}
              onPointerDown={onPointerDown(handle)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onKeyDown={onKey(handle)}
            />
          ))}
        </div>
      </div>
      <div className="cn-clip-range__times">
        <span>{rich("clips.range.from", { time: <strong>{formatPrecise(start)}</strong> })}</span>
        <span>{rich("clips.range.keeps", { time: <strong>{formatPrecise(end - start)}</strong> })}</span>
        <span>{rich("clips.range.to", { time: <strong>{formatPrecise(end)}</strong> })}</span>
      </div>
    </div>
  );
}

/**
 * "1:05.4": a clock with tenths of a second, since cuts are made to the moment.
 */
function formatPrecise(seconds: number) {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  return `${formatClock(Math.floor(tenths / 10))}.${tenths % 10}`;
}
