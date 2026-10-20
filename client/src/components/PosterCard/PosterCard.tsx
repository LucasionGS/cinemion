import { type ReactNode, useState } from "react";
import { Check } from "lucide-react";
import type { CollectionSummary, ItemSummary } from "@shared/media.ts";
import { PROFILE_COLORS } from "@shared/profiles.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { router } from "../../lib/Router.tsx";
import cx from "../../lib/cx.ts";
import "./PosterCard.scss";

const FALLBACK_COLORS = Object.values(PROFILE_COLORS).map((c) => c.bg);

/**
 * A stable colour per title, so posterless titles don't all look the same.
 */
export function fallbackColor(title: string) {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

export type PosterItem = ItemSummary | (CollectionSummary & { type: "collection" });

export interface PosterCardProps {
  item: PosterItem;
  /**
   * Line under the title. Default is the year, the number of seasons, or the number of movies.
   */
  subtitle?: string;
  /**
   * Default opens the title's page.
   */
  onClick?: () => void;
  /**
   * Called when the card is hovered or focused, e.g. to retint the page.
   */
  onSelect?: () => void;
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

/**
 * A 2:3 poster with the title underneath. Titles without a poster get a tile in their own colours.
 */
export default function PosterCard(props: PosterCardProps) {
  const { item, subtitle, onClick, onSelect, actions, badge, className } = props;
  const [broken, setBroken] = useState(false);
  const isCollection = item.type === "collection";
  const title = isCollection ? item.name : item.title;
  const poster = item.artwork.poster && !broken ? item.artwork.poster : null;
  const tint = item.palette?.accent ?? fallbackColor(title);
  const userData = isCollection ? null : item.userData;
  // Shows that are partly watched show how many episodes are left
  const remaining = userData && !userData.watched && userData.unwatchedCount && userData.progress ? userData.unwatchedCount : null;

  let sub = subtitle;
  if (sub === undefined) {
    if (isCollection) sub = `${item.itemCount} movies`;
    else if (item.type === "show") sub = `${item.childCount} ${item.childCount === 1 ? "season" : "seasons"}`;
    else sub = item.year ? String(item.year) : "";
  }

  const open = onClick ?? (() => router.navigate(isCollection ? `/collection/${item.id}` : `/item/${item.id}`));

  return (
    <div className={cx("cn-poster", className)}>
      <button type="button" className="cn-poster__button" onClick={open} onMouseEnter={onSelect} onFocus={onSelect} aria-label={`${title}${!isCollection && item.year ? ` (${item.year})` : ""}`}>
        <span className="cn-poster__art" style={poster ? undefined : { background: `linear-gradient(160deg, ${tint} 0%, ${item.palette?.base ?? "#0B0D12"} 110%)` }}>
          {poster
            ? <img src={ItemsApi.imageUrl(poster, 342)} srcSet={`${ItemsApi.imageUrl(poster, 342)} 342w, ${ItemsApi.imageUrl(poster, 500)} 500w, ${ItemsApi.imageUrl(poster, 780)} 780w`} sizes="(min-width: 1600px) 15vw, 11rem" alt="" loading="lazy" onError={() => setBroken(true)} />
            : <span className="cn-poster__fallback">{title}</span>}
          {badge && <span className="cn-poster__badge">{badge}</span>}
          {userData?.watched && <span className="cn-poster__corner" aria-label="Watched"><Check /></span>}
          {remaining !== null && <span className="cn-poster__corner cn-poster__corner--count" aria-label={`${remaining} unwatched`}>{remaining}</span>}
          {!!userData?.progress && !userData.watched && userData.unwatchedCount === null && (
            <span className="cn-poster__progress"><span style={{ width: `${Math.round(userData.progress * 100)}%` }} /></span>
          )}
        </span>
      </button>
      <div className="cn-poster__meta">
        <span className="cn-poster__title" title={title}>{title}</span>
        {sub && <span className="cn-poster__sub">{sub}</span>}
      </div>
      {actions && <div className="cn-poster__actions">{actions}</div>}
    </div>
  );
}
