import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import { formatClock } from "../../lib/playback.ts";
import useController from "../../lib/useController.ts";
import { deviceMode } from "../../lib/DeviceMode.ts";
import cx from "../../lib/cx.ts";
import { t } from "../../i18n/I18n.ts";
import Thumbnail from "./Thumbnail.tsx";
import type PlayerController from "./PlayerController.ts";

export interface ScrubberProps {
  controller: PlayerController;
}

/**
 * The seek bar: played and loaded parts, a handle, and the time under the pointer.
 * Dragging seeks on release; on TV, the remote moves `scrubTarget` and OK jumps there.
 */
export default function Scrubber(props: ScrubberProps) {
  const { controller } = props;
  const { position, duration, bufferedEnd, scrubTarget, trickplay } = useController(controller);
  const { mode } = useController(deviceMode);
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const total = duration || 1;
  const shown = dragging ?? scrubTarget ?? position;
  const percent = (time: number) => `${Math.max(0, Math.min(100, (time / total) * 100))}%`;

  function timeAt(e: PointerEvent) {
    const rect = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * total;
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(timeAt(e));
    controller.showControls();
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const time = timeAt(e);
    if (e.pointerType === "mouse") setHover(time);
    if (dragging !== null) {
      setDragging(time);
      controller.showControls();
    }
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (dragging === null) return;
    controller.seek(timeAt(e));
    setDragging(null);
  }

  const bubble = dragging ?? scrubTarget ?? hover;
  // On TV the filmstrip shows the thumbnails (and the time) instead
  const showThumbnail = !!trickplay && mode !== "tv";

  return (
    <div
      className="cn-scrubber"
      role="slider"
      tabIndex={0}
      aria-label={t("player.scrubber.label")}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={t("player.scrubber.value", { position: formatClock(shown), duration: formatClock(duration) })}
      data-scrubber
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDragging(null)}
      onPointerLeave={() => setHover(null)}
    >
      {bubble !== null && !(mode === "tv" && trickplay) && (
        // With a thumbnail, keep the bubble inside the bar instead of hanging off the screen's edge
        <span
          className={cx("cn-scrubber__bubble", showThumbnail && "cn-scrubber__bubble--thumbnail")}
          style={{ left: showThumbnail ? `clamp(var(--scrubber-thumbnail-half), ${percent(bubble)}, calc(100% - var(--scrubber-thumbnail-half)))` : percent(bubble) }}
        >
          {showThumbnail && <Thumbnail trickplay={trickplay!} time={bubble} className="cn-scrubber__thumbnail" />}
          <span className="cn-scrubber__time">{formatClock(bubble)}</span>
        </span>
      )}
      <div ref={track} className="cn-scrubber__track">
        <span className="cn-scrubber__buffered" style={{ width: percent(Math.max(bufferedEnd, position)) }} />
        {scrubTarget !== null && (
          <span className="cn-scrubber__target" style={{ left: percent(Math.min(position, scrubTarget)), width: `${(Math.abs(scrubTarget - position) / total) * 100}%` }} />
        )}
        <span className="cn-scrubber__played" style={{ width: percent(scrubTarget !== null ? Math.min(position, scrubTarget) : shown) }} />
        <span className="cn-scrubber__handle" style={{ left: percent(shown) }} />
      </div>
    </div>
  );
}
