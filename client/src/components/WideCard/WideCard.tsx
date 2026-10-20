import { useState } from "react";
import { Check, Folder } from "lucide-react";
import type { ItemSummary } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { router } from "../../lib/Router.tsx";
import { episodeLabel, formatDuration, timeLeft } from "../../lib/playback.ts";
import { formatDate } from "../../lib/format.ts";
import cx from "../../lib/cx.ts";
import { fallbackColor } from "../PosterCard/PosterCard.tsx";
import "./WideCard.scss";

export interface WideCardProps {
  item: ItemSummary;
  /**
   * `continue` puts the time left first; `episode` shows the episode number and length; `video` shows the date and
   * length of a video, or the number of videos in a folder.
   */
  variant?: "continue" | "episode" | "video";
  onClick?: () => void;
  onSelect?: () => void;
  selected?: boolean;
  className?: string;
}

/**
 * A 16:9 card with a still or backdrop, for "Continue watching", "Next up", episode lists, and videos and folders.
 */
export default function WideCard(props: WideCardProps) {
  const { item, variant = "continue", onClick, onSelect, selected = false, className } = props;
  const [broken, setBroken] = useState(false);
  const image = (item.artwork.thumb ?? item.artwork.backdrop ?? null);
  const showImage = image && !broken;
  const isEpisode = item.type === "episode";
  const isFolder = item.type === "folder";
  const left = timeLeft(item);
  const progress = item.userData?.progress && !item.userData.watched ? item.userData.progress : null;

  // Title on the art: the show for "continue" episodes, the episode itself in episode lists
  const artTitle = isEpisode && variant === "continue" ? item.showTitle ?? item.title : item.title;
  const line1 = isEpisode
    ? variant === "continue" ? `${episodeLabel(item)} · ${item.title}` : `${item.episodeNumber}. ${item.title}`
    : item.title;
  const date = item.releaseDate ? formatDate(item.releaseDate, true) : null;
  let line2: string;
  if (variant === "continue") line2 = left ?? (isEpisode ? "Up next" : item.type === "video" ? date ?? "" : item.year ? String(item.year) : "");
  else if (isFolder) line2 = `${item.childCount} ${item.childCount === 1 ? "video" : "videos"}`;
  else if (variant === "video") line2 = [date, left].filter(Boolean).join(" · ");
  else line2 = [item.runtime ? formatDuration(item.runtime * 60) : null, left].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      className={cx("cn-wide", selected && "cn-wide--selected", variant === "video" && "cn-wide--video", isFolder && "cn-wide--folder", className)}
      onClick={onClick ?? (() => router.navigate(`/item/${item.id}`))}
      onMouseEnter={onSelect}
      onFocus={onSelect}
    >
      <span className="cn-wide__art" style={showImage ? undefined : { background: `linear-gradient(160deg, ${item.palette?.accent ?? fallbackColor(artTitle)} 0%, ${item.palette?.base ?? "#0B0D12"} 110%)` }}>
        {showImage && <img src={ItemsApi.imageUrl(image!, 500)} srcSet={`${ItemsApi.imageUrl(image!, 500)} 500w, ${ItemsApi.imageUrl(image!, 780)} 780w`} sizes="26rem" alt="" loading="lazy" onError={() => setBroken(true)} />}
        <span className="cn-wide__shade" />
        {variant === "continue" && <span className="cn-wide__title">{artTitle}</span>}
        {variant === "episode" && <span className="cn-wide__number">E{item.episodeNumber}</span>}
        {isFolder && <span className="cn-wide__number cn-wide__folder"><Folder aria-hidden="true" />{item.childCount}</span>}
        {variant === "video" && item.type === "video" && item.runtime && <span className="cn-wide__length">{formatDuration(item.runtime * 60)}</span>}
        {item.userData?.watched && <span className="cn-wide__watched" aria-label="Watched"><Check /></span>}
        {progress !== null && <span className="cn-wide__progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></span>}
      </span>
      <span className="cn-wide__meta">
        <span className="cn-wide__line1">{line1}</span>
        {line2 && <span className="cn-wide__line2">{line2}</span>}
      </span>
    </button>
  );
}
