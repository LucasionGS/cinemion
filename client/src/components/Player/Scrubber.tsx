import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import { formatClock } from "../../lib/playback.ts";
import useController from "../../lib/useController.ts";
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
  const { position, duration, bufferedEnd, scrubTarget } = useController(controller);
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

  return (
    <div
      className="cn-scrubber"
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${formatClock(shown)} of ${formatClock(duration)}`}
      data-scrubber
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDragging(null)}
      onPointerLeave={() => setHover(null)}
    >
      {bubble !== null && (
        <span className="cn-scrubber__bubble" style={{ left: percent(bubble) }}>{formatClock(bubble)}</span>
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
