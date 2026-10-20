import type { CSSProperties } from "react";
import type { TrickplayInfo } from "@shared/playback.ts";
import cx from "../../lib/cx.ts";

export interface ThumbnailProps {
  trickplay: TrickplayInfo;
  /**
   * Position in the video, in seconds.
   */
  time: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * The seek thumbnail closest to `time`, cut out of its sheet. Sized by CSS; the sheet scales with it.
 */
export default function Thumbnail(props: ThumbnailProps) {
  const { trickplay, time, className, style } = props;
  const { interval, columns, rows, count, width, height, sheetUrl } = trickplay;
  const index = Math.max(0, Math.min(count - 1, Math.round(time / interval)));
  const perSheet = columns * rows;
  const sheet = Math.floor(index / perSheet);
  const within = index % perSheet;
  const column = within % columns;
  const row = Math.floor(within / columns);

  return (
    <span
      className={cx("cn-thumbnail", className)}
      aria-hidden="true"
      style={{
        aspectRatio: `${width} / ${height}`,
        backgroundImage: `url(${sheetUrl.replace("{n}", String(sheet))})`,
        backgroundSize: `${columns * 100}% ${rows * 100}%`,
        backgroundPosition: `${columns > 1 ? (column / (columns - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
        ...style,
      }}
    />
  );
}
