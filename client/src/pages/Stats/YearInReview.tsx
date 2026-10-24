import { useEffect, useState } from "react";
import { BookOpen, CalendarHeart, Clapperboard, Flame, Music, Share2, Sparkles, Tv } from "lucide-react";
import type { YearInReview as Review } from "@shared/stats.ts";
import StatsApi from "../../Api/StatsApi.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { router } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import { copyText } from "../../lib/clipboard.ts";
import { formatDate } from "../../lib/format.ts";
import { i18n, t } from "../../i18n/I18n.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import Avatar from "../../components/Avatar/Avatar.tsx";
import Button from "../../components/Button/Button.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import { spent, total } from "./StatsParts.tsx";
import "./Stats.scss";

export interface YearInReviewProps {
  year: number;
}

/**
 * A year at a glance, for the profile or the whole household: hours, the favourites, the busiest month, the longest
 * streak and the biggest binge, with a summary to share.
 */
export default function YearInReview(props: YearInReviewProps) {
  const { year } = props;
  const [scope, setScope] = useState<"me" | "household">("me");
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const thisYear = new Date().getFullYear();

  useEffect(() => {
    setReview(null);
    setError(null);
    StatsApi.year(year, scope).then(setReview).catch((e: Error) => setError(e.message));
  }, [year, scope]);

  async function share() {
    if (!review) return;
    const lines = [
      t("review.share.heading", { name: review.name, year: String(year) }),
      t("review.share.hours", { time: spent(total(review.totals)) }),
      review.topShow && t("review.share.show", { title: review.topShow.title }),
      review.topMovie && t("review.share.movie", { title: review.topMovie.title }),
      review.topArtist && t("review.share.artist", { title: review.topArtist.title }),
      review.longestStreak > 1 && t("review.share.streak", { count: review.longestStreak }),
    ].filter(Boolean).join("\n");
    try {
      if (navigator.share) await navigator.share({ title: t("review.title", { year: String(year) }), text: lines });
      else if (await copyText(lines)) toasts.success(t("review.share.copied"));
    } catch {
      // Closing the share sheet isn't a failure
    }
  }

  const month = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleDateString(i18n.locale, { month: "long" });
  const maxMonth = review ? Math.max(1, ...review.months.map(total)) : 1;

  return (
    <AppShell>
      <div className="cn-review">
        <header className="cn-review__hero">
          <span className="cn-review__eyebrow"><Sparkles aria-hidden="true" /> {t("review.eyebrow")}</span>
          <h1>{t("review.title", { year: String(year) })}</h1>
          <div className="cn-review__controls">
            <SegmentedControl<"me" | "household"> label={t("review.whose")} value={scope} onChange={setScope} options={[{ value: "me", label: t("review.me") }, { value: "household", label: t("review.household") }]} />
            <div className="cn-review__years">
              {year > thisYear - 5 && <Button size="sm" variant="ghost" onClick={() => router.navigate(`/year/${year - 1}`)}>{String(year - 1)}</Button>}
              {year < thisYear && <Button size="sm" variant="ghost" onClick={() => router.navigate(`/year/${year + 1}`)}>{String(year + 1)}</Button>}
              {review && total(review.totals) > 0 && <Button size="sm" icon={<Share2 />} onClick={share}>{t("review.share.button")}</Button>}
            </div>
          </div>
        </header>

        {!review && !error && <Spinner size="2rem" />}
        {error && <p className="cn-stats__empty">{error}</p>}
        {review && total(review.totals) === 0 && (
          <section className="cn-stats__empty">
            <h2>{t("review.emptyTitle")}</h2>
            <p>{t("review.emptyText", { year: String(year) })}</p>
          </section>
        )}

        {review && total(review.totals) > 0 && (
          <div className="cn-review__cards">
            <section className="cn-review__card cn-review__card--big">
              <span>{scope === "me" ? t("review.youSpent") : t("review.householdSpent", { name: review.name })}</span>
              <strong>{spent(total(review.totals))}</strong>
              <span>
                {[
                  review.totals.watching > 0 && t("review.watching", { time: spent(review.totals.watching) }),
                  review.totals.listening > 0 && t("review.listening", { time: spent(review.totals.listening) }),
                  review.totals.reading > 0 && t("review.reading", { time: spent(review.totals.reading) }),
                ].filter(Boolean).join(t("common.dotSeparator"))}
              </span>
              <span>{t("review.days", { count: review.counts.days })}</span>
            </section>

            {review.topShow && <Favourite icon={<Tv />} label={t("review.topShow")} title={review.topShow.title} image={review.topShow.image} detail={t("stats.counts.episodes", { count: review.topShow.count })} />}
            {review.topMovie && <Favourite icon={<Clapperboard />} label={t("review.topMovie")} title={review.topMovie.title} image={review.topMovie.image} detail={t("stats.counts.plays", { count: review.topMovie.count })} />}
            {review.topArtist && <Favourite icon={<Music />} label={t("review.topArtist")} title={review.topArtist.title} image={review.topArtist.image} detail={spent(review.topArtist.seconds)} />}
            {review.topBook && <Favourite icon={<BookOpen />} label={t("review.topBook")} title={review.topBook.title} image={review.topBook.image} detail={spent(review.topBook.seconds)} />}

            <section className="cn-review__card cn-review__card--wide">
              <span className="cn-review__label"><CalendarHeart aria-hidden="true" /> {review.busiestMonth ? t("review.busiest", { month: month(review.busiestMonth) }) : t("review.months")}</span>
              <div className="cn-review__months">
                {review.months.map((m) => (
                  <div key={m.key} className={m.key === review.busiestMonth ? "cn-review__month cn-review__month--best" : "cn-review__month"} title={`${month(m.key)}: ${spent(total(m))}`}>
                    <span style={{ height: `${total(m) / maxMonth * 100}%` }} />
                    <small>{month(m.key).slice(0, 1).toUpperCase()}</small>
                  </div>
                ))}
              </div>
            </section>

            {(review.longestStreak > 1 || review.binge) && (
              <section className="cn-review__card">
                <span className="cn-review__label"><Flame aria-hidden="true" /> {t("review.records")}</span>
                {review.longestStreak > 1 && <strong>{t("review.streak", { count: review.longestStreak })}</strong>}
                {review.binge && <span>{t("review.binge", { count: review.binge.episodes, show: review.binge.title, date: formatDate(review.binge.day) })}</span>}
              </section>
            )}

            {review.topGenres.length > 0 && (
              <section className="cn-review__card">
                <span className="cn-review__label">{t("review.genres")}</span>
                <div className="cn-review__chips">{review.topGenres.map((g) => <span key={g.name}>{g.name}</span>)}</div>
              </section>
            )}

            {review.first && (
              <section className="cn-review__card">
                <span className="cn-review__label">{t("review.first")}</span>
                <strong>{review.first.title}</strong>
                <span>{formatDate(review.first.day)}</span>
              </section>
            )}

            {review.people.length > 1 && (
              <section className="cn-review__card cn-review__card--wide">
                <span className="cn-review__label">{t("review.people")}</span>
                <div className="cn-stats__people">
                  {review.people.map((p) => (
                    <div key={p.id} className="cn-stats__person">
                      <Avatar profile={p} size={2} />
                      <span className="cn-stats__person-name">{p.name}</span>
                      <span className="cn-stats__time">{spent(p.seconds)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Favourite(props: { icon: React.ReactNode; label: string; title: string; image: string | null; detail: string }) {
  const { icon, label, title, image, detail } = props;
  return (
    <section className="cn-review__card cn-review__card--favourite">
      {image && <img className="cn-review__art" src={ItemsApi.imageUrl(image, 500)} alt="" loading="lazy" />}
      <span className="cn-review__label">{icon} {label}</span>
      <strong>{title}</strong>
      <span>{detail}</span>
    </section>
  );
}
