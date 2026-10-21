import { useState } from "react";
import { Images } from "lucide-react";
import type { PhotoAlbumSummary } from "@shared/photos.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { router } from "../../lib/Router.tsx";
import cx from "../../lib/cx.ts";
import { fallbackColor } from "../PosterCard/PosterCard.tsx";
import "../WideCard/WideCard.scss";
import "./PhotoAlbumCard.scss";

export interface PhotoAlbumCardProps {
  album: PhotoAlbumSummary;
  className?: string;
}

/**
 * An album of a Photos library (a folder, or one someone made) as a 16:9 cover with two cards stacked behind it,
 * like folders in Videos libraries.
 */
export default function PhotoAlbumCard(props: PhotoAlbumCardProps) {
  const { album, className } = props;
  const [broken, setBroken] = useState(false);
  const cover = album.cover && !broken ? album.cover : null;
  const href = `/photos/${album.kind}/${album.id}`;

  return (
    <button type="button" className={cx("cn-wide cn-wide--video cn-wide--folder cn-photo-album", className)} onClick={() => router.navigate(href)}>
      <span className="cn-wide__art cn-dark-theme" style={cover ? undefined : { background: `linear-gradient(160deg, ${album.palette?.accent ?? fallbackColor(album.title)} 0%, ${album.palette?.base ?? "#0B0D12"} 110%)` }}>
        {cover && <img src={ItemsApi.imageUrl(cover, 500)} srcSet={`${ItemsApi.imageUrl(cover, 500)} 500w, ${ItemsApi.imageUrl(cover, 780)} 780w`} sizes="26rem" alt="" loading="lazy" onError={() => setBroken(true)} />}
        <span className="cn-wide__number cn-wide__folder"><Images aria-hidden="true" />{(album.photoCount + album.videoCount).toLocaleString()}</span>
      </span>
      <span className="cn-wide__meta">
        <span className="cn-wide__line1">{album.title}</span>
        <span className="cn-wide__line2">{albumLine(album)}</span>
      </span>
    </button>
  );
}

/**
 * "86 photos", "214 photos · 6 videos" or "Empty".
 */
export function albumCounts(album: Pick<PhotoAlbumSummary, "photoCount" | "videoCount">) {
  const { photoCount: p, videoCount: v } = album;
  if (p + v === 0) return "Empty";
  return [p ? `${p.toLocaleString()} ${p === 1 ? "photo" : "photos"}` : null, v ? `${v.toLocaleString()} ${v === 1 ? "video" : "videos"}` : null].filter(Boolean).join(" · ");
}

/**
 * The card's second line: how much is in it and when, like "220 items · July 2024" or "38 photos · 2019 – 2026".
 */
function albumLine(album: PhotoAlbumSummary) {
  const total = album.photoCount + album.videoCount;
  const what = total === 0 ? "Empty" : album.videoCount === 0 ? `${total.toLocaleString()} ${total === 1 ? "photo" : "photos"}` : album.photoCount === 0 ? `${total.toLocaleString()} ${total === 1 ? "video" : "videos"}` : `${total.toLocaleString()} items`;
  if (!album.from || !album.to) return what;
  const [fy, fm] = album.from.split("-").map(Number);
  const [ty, tm] = album.to.split("-").map(Number);
  const when = fy !== ty ? `${fy} – ${ty}` : new Date(ty, tm - 1, 1).toLocaleDateString(undefined, { month: fm === tm ? "long" : undefined, year: "numeric" });
  return `${what} · ${when}`;
}
