import type { StatsBucket, StatsTitle, TimeSplit } from "@shared/stats.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { Link } from "../../lib/Router.tsx";
import { i18n, t } from "../../i18n/I18n.ts";

/**
 * "12 h" or "45 min": time spent, rounded to what's worth reading.
 */
export function spent(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("stats.minutes", { count: minutes });
  const hours = seconds / 3600;
  return t("stats.hours", { count: hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours) });
}

export function total(split: TimeSplit) {
  return split.watching + split.listening + split.reading;
}

/**
 * The label under a bar: the weekday or day of the month, or the month.
 */
function bucketLabel(key: string, count: number) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d || 1);
  if (key.length === 7) return date.toLocaleDateString(i18n.locale, { month: "short" });
  return count <= 7 ? date.toLocaleDateString(i18n.locale, { weekday: "short" }) : String(d);
}

function bucketTitle(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d || 1);
  return key.length === 7 ? date.toLocaleDateString(i18n.locale, { month: "long", year: "numeric" }) : date.toLocaleDateString(i18n.locale, { weekday: "long", day: "numeric", month: "long" });
}

/**
 * Stacked bars of watching, listening and reading per day or month.
 */
export function TimeChart(props: { buckets: StatsBucket[] }) {
  const { buckets } = props;
  const max = Math.max(1, ...buckets.map(total));
  // Long ranges label every few bars, so the labels don't run into each other
  const every = buckets.length > 16 ? Math.ceil(buckets.length / 10) : 1;
  return (
    <div className="cn-stats__chart" role="img" aria-label={t("stats.chartLabel")}>
      <div className="cn-stats__bars">
        {buckets.map((b, i) => (
          <div key={b.key} className="cn-stats__bar" title={`${bucketTitle(b.key)}: ${spent(total(b))}`}>
            <div className="cn-stats__stack" style={{ height: `${total(b) / max * 100}%` }}>
              {b.reading > 0 && <span className="cn-stats__seg cn-stats__seg--reading" style={{ flexGrow: b.reading }} />}
              {b.listening > 0 && <span className="cn-stats__seg cn-stats__seg--listening" style={{ flexGrow: b.listening }} />}
              {b.watching > 0 && <span className="cn-stats__seg cn-stats__seg--watching" style={{ flexGrow: b.watching }} />}
            </div>
            <span className="cn-stats__bar-label">{i % every === 0 ? bucketLabel(b.key, buckets.length) : ""}</span>
          </div>
        ))}
      </div>
      <div className="cn-stats__legend" aria-hidden="true">
        <span><i className="cn-stats__seg--watching" /> {t("stats.watching")}</span>
        <span><i className="cn-stats__seg--listening" /> {t("stats.listening")}</span>
        <span><i className="cn-stats__seg--reading" /> {t("stats.reading")}</span>
      </div>
    </div>
  );
}

/**
 * The three totals, big.
 */
export function Totals(props: { totals: TimeSplit }) {
  const { totals } = props;
  return (
    <div className="cn-stats__totals">
      <div className="cn-stats__total cn-stats__total--watching"><span>{t("stats.watching")}</span><strong>{spent(totals.watching)}</strong></div>
      <div className="cn-stats__total cn-stats__total--listening"><span>{t("stats.listening")}</span><strong>{spent(totals.listening)}</strong></div>
      <div className="cn-stats__total cn-stats__total--reading"><span>{t("stats.reading")}</span><strong>{spent(totals.reading)}</strong></div>
    </div>
  );
}

/**
 * A ranked list of titles with a small poster, the time spent and how many.
 */
export function TopList(props: { title: string; items: StatsTitle[]; count: (n: number) => string; href?: (id: number) => string }) {
  const { title, items, count, href } = props;
  if (items.length === 0) return null;
  return (
    <section className="cn-settings__card cn-stats__top">
      <h2>{title}</h2>
      <ol>
        {items.map((item, i) => {
          const content = (
            <>
              <span className="cn-stats__rank">{i + 1}</span>
              <span className="cn-stats__thumb">{item.image && <img src={ItemsApi.imageUrl(item.image, 160)} alt="" loading="lazy" />}</span>
              <span className="cn-stats__name"><strong>{item.title}</strong><span>{count(item.count)}</span></span>
              <span className="cn-stats__time">{spent(item.seconds)}</span>
            </>
          );
          return <li key={`${item.id}-${item.title}`}>{item.id && href ? <Link href={href(item.id)}>{content}</Link> : <div>{content}</div>}</li>;
        })}
      </ol>
    </section>
  );
}

export function Genres(props: { genres: { name: string; seconds: number }[] }) {
  const { genres } = props;
  if (genres.length === 0) return null;
  const max = Math.max(...genres.map((g) => g.seconds));
  return (
    <section className="cn-settings__card">
      <h2>{t("stats.genres")}</h2>
      <div className="cn-stats__genres">
        {genres.map((g) => (
          <div key={g.name} className="cn-stats__genre">
            <span>{g.name}</span>
            <span className="cn-meter"><span style={{ width: `${g.seconds / max * 100}%` }} /></span>
            <span>{spent(g.seconds)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
