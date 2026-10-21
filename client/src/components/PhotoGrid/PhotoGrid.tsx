import { type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Check, ImageOff, Play } from "lucide-react";
import type { PhotoSummary } from "@shared/photos.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { justify } from "../../lib/justify.ts";
import { formatClock } from "../../lib/playback.ts";
import { formatDateTime } from "../../lib/format.ts";
import { deviceMode } from "../../lib/DeviceMode.ts";
import useController from "../../lib/useController.ts";
import cx from "../../lib/cx.ts";
import "./PhotoGrid.scss";

export interface PhotoGridProps {
  items: PhotoSummary[];
  /**
   * `day` puts a heading above each day; `month` adds month headings with the days under them.
   */
  groupBy?: "none" | "day" | "month";
  onOpen: (index: number) => void;
  /**
   * The selected ids while picking photos, or `null` when not picking.
   */
  selected?: Set<number> | null;
  onToggle?: (id: number) => void;
}

interface Section {
  key: string;
  /**
   * Month heading, shown when the month changes.
   */
  month: string | null;
  day: string | null;
  items: PhotoSummary[];
}

// Row heights per layout, in rem; the gap between pictures is in pixels
const ROW_HEIGHT = { desktop: 13, mobile: 7.5, tv: 10 };
const GAP = { desktop: 4, mobile: 2, tv: 6 };

/**
 * Photos and videos in rows that keep each picture's shape, optionally under day and month headings. Off-screen
 * sections skip rendering, so long lists stay quick.
 */
export default function PhotoGrid(props: PhotoGridProps) {
  const { items, groupBy = "none", onOpen, selected = null, onToggle } = props;
  const { mode } = useController(deviceMode);
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const target = ROW_HEIGHT[mode] * rem;
  const gap = GAP[mode];
  const indexOf = useMemo(() => new Map(items.map((item, i) => [item.id, i])), [items]);
  const sections = useMemo(() => group(items, groupBy), [items, groupBy]);

  return (
    <div ref={ref} className={cx("cn-photo-grid", selected && "cn-photo-grid--selecting")}>
      {width > 0 && sections.map((section) => {
        const rows = justify(section.items, (p) => p.aspect, width, target, gap);
        const height = rows.reduce((sum, row) => sum + row.height + gap, 0);
        return (
          <section key={section.key} className="cn-photo-grid__section" style={{ containIntrinsicSize: `auto ${Math.round(height)}px` }}>
            {section.month && <h2 className="cn-photo-grid__month">{section.month}</h2>}
            {section.day && <h3 className="cn-photo-grid__day">{section.day}</h3>}
            {rows.map((row, r) => (
              <div key={r} className="cn-photo-grid__row" style={{ height: row.height, gap }}>
                {row.items.map((photo) => (
                  <Tile
                    key={photo.id}
                    photo={photo}
                    style={row.partial ? { width: photo.aspect * row.height, flex: "none" } : { flex: `${photo.aspect} 1 0px` }}
                    sizes={`${Math.round(photo.aspect * row.height)}px`}
                    selected={selected ? selected.has(photo.id) : null}
                    onClick={() => selected && onToggle ? onToggle(photo.id) : onOpen(indexOf.get(photo.id) ?? 0)}
                  />
                ))}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Tile(props: { photo: PhotoSummary; style: CSSProperties; sizes: string; selected: boolean | null; onClick: () => void }) {
  const { photo, style, sizes, selected, onClick } = props;
  const [broken, setBroken] = useState(false);
  const when = photo.takenAt ? formatDateTime(photo.takenAt) : "date unknown";
  const label = `${photo.type === "video" ? "Video" : "Photo"}, ${when}`;
  const image = photo.image && !broken ? photo.image : null;
  return (
    <button
      type="button"
      className={cx("cn-photo-tile", selected && "cn-photo-tile--selected")}
      style={style}
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected === null ? undefined : selected}
    >
      {image
        ? (
          <img
            src={ItemsApi.imageUrl(image, 500)}
            srcSet={`${ItemsApi.imageUrl(image, 342)} 342w, ${ItemsApi.imageUrl(image, 500)} 500w, ${ItemsApi.imageUrl(image, 780)} 780w`}
            sizes={sizes}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
          />
        )
        : <span className="cn-photo-tile__empty"><ImageOff aria-hidden="true" /></span>}
      {photo.type === "video" && (
        <span className="cn-photo-tile__length"><Play aria-hidden="true" />{photo.duration ? formatClock(photo.duration) : ""}</span>
      )}
      {selected !== null && <span className="cn-photo-tile__check" aria-hidden="true">{selected && <Check />}</span>}
    </button>
  );
}

/**
 * Split photos into days (and months), in the order they come.
 */
function group(items: PhotoSummary[], by: PhotoGridProps["groupBy"]): Section[] {
  if (by === "none" || !by) return [{ key: "all", month: null, day: null, items }];
  const thisYear = new Date().getFullYear();
  const sections: Section[] = [];
  let lastMonth: string | null = null;
  for (const item of items) {
    const day = item.takenAt?.slice(0, 10) ?? "unknown";
    let section = sections[sections.length - 1];
    if (!section || section.key !== day) {
      const [y, m, d] = day.split("-").map(Number);
      const date = day === "unknown" ? null : new Date(y, m - 1, d);
      const month = day.slice(0, 7);
      const monthTitle = date ? date.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "No date";
      // Under a month heading the year is already there; on their own, days in other years say which
      const withYear = by === "day" && date && y !== thisYear;
      const dayTitle = date ? date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}) }) : "No date";
      section = { key: day, month: by === "month" && month !== lastMonth ? monthTitle : null, day: by === "month" && !date ? null : dayTitle, items: [] };
      lastMonth = month;
      sections.push(section);
    }
    section.items.push(item);
  }
  return sections;
}

/**
 * The element's width in pixels, kept up to date as it resizes.
 */
function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return width;
}
