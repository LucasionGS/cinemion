import { type ReactNode, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "../../lib/Router.tsx";
import cx from "../../lib/cx.ts";
import { t } from "../../i18n/I18n.ts";
import IconButton from "../IconButton/IconButton.tsx";
import "./Row.scss";

export interface RowProps {
  title: ReactNode;
  /**
   * "See all" link target.
   */
  href?: string;
  /**
   * `wide` for 16:9 cards, `poster` for 2:3 posters, `person` for round photos, `square` for albums and artists.
   */
  kind: "wide" | "poster" | "person" | "square";
  children: ReactNode;
  className?: string;
}

/**
 * A titled row of cards that scrolls sideways, with arrow buttons on desktop.
 */
export default function Row(props: RowProps) {
  const { title, href, kind, children, className } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 4);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  function scroll(direction: number) {
    const el = scroller.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  }

  return (
    <section className={cx("cn-row", className)}>
      <div className="cn-row__header">
        <h2>{title}</h2>
        <div className="cn-row__tools">
          {href && <Link href={href} className="cn-row__all">{t("cards.row.seeAll")}</Link>}
          {overflows && <IconButton label={t("cards.row.scrollLeft")} icon={<ChevronLeft />} size="sm" className="cn-row__arrow" tabIndex={-1} onClick={() => scroll(-1)} />}
          {overflows && <IconButton label={t("cards.row.scrollRight")} icon={<ChevronRight />} size="sm" className="cn-row__arrow" tabIndex={-1} onClick={() => scroll(1)} />}
        </div>
      </div>
      <div ref={scroller} className={cx("cn-row__items", `cn-row__items--${kind}`)}>{children}</div>
    </section>
  );
}
