import { type ReactNode, useState } from "react";
import type { ItemSummary } from "@shared/media.ts";
import { PROFILE_COLORS } from "@shared/profiles.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import cx from "../../lib/cx.ts";
import "./PosterCard.scss";

export interface PosterCardProps {
  item: ItemSummary;
  /**
   * Line under the title. Default is the year, or the number of seasons for shows.
   */
  subtitle?: string;
  onClick?: () => void;
  /**
   * Extra controls in the corner, like a menu for managers.
   */
  actions?: ReactNode;
  /**
   * Small label on the artwork, like "Unmatched".
   */
  badge?: string;
  className?: string;
}

const FALLBACK_COLORS = Object.values(PROFILE_COLORS).map((c) => c.bg);

/**
 * A stable colour per title, so posterless titles don't all look the same.
 */
function fallbackColor(title: string) {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

/**
 * A 2:3 poster with the title underneath. Titles without a poster get a tile in their own colours.
 */
export default function PosterCard(props: PosterCardProps) {
  const { item, subtitle, onClick, actions, badge, className } = props;
  const [broken, setBroken] = useState(false);
  const poster = item.artwork.poster && !broken ? item.artwork.poster : null;
  const tint = item.palette?.accent ?? fallbackColor(item.title);
  const sub = subtitle ?? (item.type === "show" ? `${item.childCount} ${item.childCount === 1 ? "season" : "seasons"}` : item.year ? String(item.year) : "");

  return (
    <div className={cx("cn-poster", className)}>
      <button type="button" className="cn-poster__button" onClick={onClick} aria-label={`${item.title}${item.year ? ` (${item.year})` : ""}`}>
        <span className="cn-poster__art" style={poster ? undefined : { background: `linear-gradient(160deg, ${tint} 0%, ${item.palette?.base ?? "#0B0D12"} 110%)` }}>
          {poster
            ? <img src={ItemsApi.imageUrl(poster, 342)} srcSet={`${ItemsApi.imageUrl(poster, 342)} 342w, ${ItemsApi.imageUrl(poster, 500)} 500w, ${ItemsApi.imageUrl(poster, 780)} 780w`} sizes="(min-width: 1600px) 15vw, 11rem" alt="" loading="lazy" onError={() => setBroken(true)} />
            : <span className="cn-poster__fallback">{item.title}</span>}
          {badge && <span className="cn-poster__badge">{badge}</span>}
        </span>
      </button>
      <div className="cn-poster__meta">
        <span className="cn-poster__title" title={item.title}>{item.title}</span>
        {sub && <span className="cn-poster__sub">{sub}</span>}
      </div>
      {actions && <div className="cn-poster__actions">{actions}</div>}
    </div>
  );
}
