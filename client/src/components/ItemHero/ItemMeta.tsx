import { Star } from "lucide-react";
import type { ItemDetail, MediaFileInfo } from "@shared/media.ts";
import { formatDuration } from "../../lib/playback.ts";
import "./ItemMeta.scss";

/**
 * Quality badges from the best of the item's files: resolution, HDR, surround sound, subtitles.
 */
export function qualityBadges(files: MediaFileInfo[]) {
  if (files.length === 0) return [];
  const best = [...files].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
  const badges: string[] = [];
  const height = best.height ?? 0;
  if (height >= 2000) badges.push("4K");
  else if (height >= 1000) badges.push("1080p");
  else if (height >= 700) badges.push("720p");
  else if (height > 0) badges.push("SD");
  const hdr = files.map((f) => f.hdr).find(Boolean);
  if (hdr) badges.push(hdr === "dolby-vision" ? "Dolby Vision" : hdr === "hlg" ? "HLG" : "HDR10");
  const channels = Math.max(0, ...files.flatMap((f) => f.audio.map((a) => a.channels)));
  if (channels >= 8) badges.push("7.1");
  else if (channels >= 6) badges.push("5.1");
  if (files.some((f) => f.subtitles.length > 0)) badges.push("CC");
  return badges;
}

export interface ItemMetaProps {
  item: ItemDetail;
}

/**
 * The line of facts under a title: year, length, genres, ratings, age rating and quality. With IMDb, Rotten Tomatoes
 * and Metacritic scores (from OMDb), TMDB's own score steps aside.
 */
export default function ItemMeta(props: ItemMetaProps) {
  const { item } = props;
  const year = item.type === "show" && item.year ? `${item.year}` : item.releaseDate?.slice(0, 4) ?? (item.year ? String(item.year) : null);
  const length = item.type === "show"
    ? `${item.childCount} ${item.childCount === 1 ? "season" : "seasons"}`
    : item.runtime ? formatDuration(item.runtime * 60) : null;

  return (
    <div className="cn-meta">
      {year && <span>{year}</span>}
      {length && <span>{length}</span>}
      {item.genres.length > 0 && <span>{item.genres.slice(0, 3).join(", ")}</span>}
      {item.rating !== null && item.ratings?.imdb == null && <span className="cn-meta__rating"><Star aria-hidden="true" />{item.rating.toFixed(1)}</span>}
      {item.ratings?.imdb != null && <Score label="IMDb" name="IMDb rating" value={item.ratings.imdb.toFixed(1)} detail={item.ratings.imdbVotes ? `${item.ratings.imdbVotes.toLocaleString()} votes` : null} />}
      {item.ratings?.rottenTomatoes != null && <Score label="RT" name="Rotten Tomatoes" value={`${item.ratings.rottenTomatoes}%`} />}
      {item.ratings?.metacritic != null && <Score label="MC" name="Metacritic" value={String(item.ratings.metacritic)} />}
      {item.contentRating && <span className="cn-meta__badge cn-meta__badge--outline">{item.contentRating}</span>}
      {qualityBadges(item.files).map((b) => <span key={b} className="cn-meta__badge">{b}</span>)}
    </div>
  );
}

function Score(props: { label: string; name: string; value: string; detail?: string | null }) {
  const { label, name, value, detail } = props;
  return (
    <span className="cn-meta__score" title={detail ? `${name}, ${detail}` : name}>
      <b aria-label={name}>{label}</b> {value}
    </span>
  );
}
