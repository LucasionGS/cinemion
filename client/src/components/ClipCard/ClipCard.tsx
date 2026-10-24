import { useEffect, useState } from "react";
import { Check, Sparkles, Star } from "lucide-react";
import type { ItemSummary } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import ClipsApi from "../../Api/ClipsApi.ts";
import { router } from "../../lib/Router.tsx";
import { formatClock } from "../../lib/playback.ts";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import { toasts } from "../../lib/Toasts.ts";
import cx from "../../lib/cx.ts";
import { fallbackColor } from "../PosterCard/PosterCard.tsx";
import "../WideCard/WideCard.scss";
import "./ClipCard.scss";

export interface ClipCardProps {
  item: ItemSummary;
  /**
   * Name the game on the card. Off on a game's own page, where every clip is from it.
   */
  showGame?: boolean;
  /**
   * While picking clips: whether this one is picked. `null` or left out = not picking.
   */
  selected?: boolean | null;
  onToggle?: () => void;
  onSelect?: () => void;
  className?: string;
}

/**
 * A game clip as a 16:9 card: its thumbnail with the length, a star, and the game (or what picture recognition
 * thinks it is).
 */
export default function ClipCard(props: ClipCardProps) {
  const { item, showGame = true, selected = null, onToggle, onSelect, className } = props;
  const [broken, setBroken] = useState(false);
  const [favorite, setFavorite] = useState(item.userData?.favorite ?? false);
  const clip = item.clip;
  const image = item.artwork.thumb ?? item.artwork.backdrop;
  const picking = selected !== null;
  const progress = item.userData?.progress && !item.userData.watched ? item.userData.progress : null;
  const when = clip?.takenAt ? formatDateTime(clip.takenAt, true) : item.releaseDate ? formatDate(item.releaseDate, true) : null;
  const gameName = clip?.game?.title ?? "No game";

  useEffect(() => setFavorite(item.userData?.favorite ?? false), [item.userData?.favorite]);

  // A clip with its own title shows it; the others are known by their game and when they were recorded
  let line1: string;
  let line2: string | null;
  if (clip?.titled) {
    line1 = item.title;
    line2 = showGame ? [gameName, when].filter(Boolean).join(" · ") : when;
  }
  else if (showGame) {
    line1 = gameName;
    line2 = when;
  }
  else {
    line1 = when ?? item.title;
    line2 = null;
  }

  async function toggleFavorite() {
    const next = !favorite;
    setFavorite(next);
    try {
      await ClipsApi.setFavorite([item.id], next);
    } catch (error) {
      setFavorite(!next);
      toasts.error("Couldn't star the clip", (error as Error).message);
    }
  }

  return (
    <div className={cx("cn-clip", picking && "cn-clip--picking", selected && "cn-clip--selected", className)}>
      <button
        type="button"
        className={cx("cn-wide", "cn-clip__open", selected && "cn-wide--selected")}
        onClick={picking ? onToggle : () => router.navigate(`/item/${item.id}`)}
        onMouseEnter={onSelect}
        onFocus={onSelect}
        aria-pressed={picking ? !!selected : undefined}
        aria-label={[line1, line2].filter(Boolean).join(", ")}
      >
        <span className="cn-wide__art cn-dark-theme" style={image && !broken ? undefined : { background: `linear-gradient(160deg, ${item.palette?.accent ?? fallbackColor(gameName)} 0%, ${item.palette?.base ?? "#0B0D12"} 110%)` }}>
          {image && !broken && <img src={ItemsApi.imageUrl(image, 500)} srcSet={`${ItemsApi.imageUrl(image, 500)} 500w, ${ItemsApi.imageUrl(image, 780)} 780w`} sizes="22rem" alt="" loading="lazy" onError={() => setBroken(true)} />}
          <span className="cn-wide__shade" />
          {clip?.seconds ? <span className="cn-wide__length">{formatClock(clip.seconds)}</span> : null}
          {clip?.suggestion && !clip.game && (
            <span className="cn-clip__suggestion" title={`Looks like ${clip.suggestion.title}`}>
              <Sparkles aria-hidden="true" />{clip.suggestion.title}?
            </span>
          )}
          {picking && <span className="cn-clip__check" aria-hidden="true">{selected && <Check />}</span>}
          {item.userData?.watched && !picking && <span className="cn-wide__watched" aria-label="Watched"><Check /></span>}
          {progress !== null && <span className="cn-wide__progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></span>}
        </span>
        <span className="cn-wide__meta">
          <span className="cn-wide__line1">{line1}</span>
          {line2 && <span className="cn-wide__line2">{line2}</span>}
        </span>
      </button>
      {!picking && (
        <button
          type="button"
          className={cx("cn-clip__star", favorite && "cn-clip__star--on")}
          aria-label={favorite ? "Take the star off" : "Star this clip"}
          aria-pressed={favorite}
          title={favorite ? "Starred" : "Star"}
          onClick={toggleFavorite}
        >
          <Star />
        </button>
      )}
    </div>
  );
}
