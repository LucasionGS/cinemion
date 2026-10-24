import { useEffect, useState } from "react";
import { Flame, PartyPopper, Tv } from "lucide-react";
import type { ProfileStats, ServerStats, StatsPeriod } from "@shared/stats.ts";
import StatsApi from "../../Api/StatsApi.ts";
import UsersApi from "../../Api/UsersApi.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { session } from "../../Session.ts";
import { Link } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import useController from "../../lib/useController.ts";
import { formatDate } from "../../lib/format.ts";
import { t, type TranslationKey } from "../../i18n/I18n.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import Avatar from "../../components/Avatar/Avatar.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import Switch from "../../components/Switch/Switch.tsx";
import { Genres, spent, TimeChart, TopList, total, Totals } from "./StatsParts.tsx";
import "../Settings/Settings.scss";
import "../Settings/Admin.scss";
import "./Stats.scss";

const PERIODS: { value: StatsPeriod; label: TranslationKey }[] = [
  { value: "week", label: "stats.period.week" },
  { value: "month", label: "stats.period.month" },
  { value: "year", label: "stats.period.year" },
  { value: "all", label: "stats.period.all" },
];

export interface StatsProps {
  /**
   * `everyone` shows the whole server, for people who manage it.
   */
  scope: "me" | "everyone";
}

/**
 * Time spent watching, listening and reading, what it went to, streaks and binges. People who manage the server also
 * see everyone's, and what nobody watches.
 */
export default function Stats(props: StatsProps) {
  const { scope } = props;
  useController(session);
  const canManage = session.can("SERVER_MANAGE");
  const [period, setPeriod] = useState<StatsPeriod>("month");
  const [mine, setMine] = useState<ProfileStats | null>(null);
  const [server, setServer] = useState<ServerStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const everyone = scope === "everyone" && canManage;
  const year = new Date().getMonth() === 0 ? new Date().getFullYear() - 1 : new Date().getFullYear();

  useEffect(() => {
    setError(null);
    if (everyone) StatsApi.server(period).then(setServer).catch((e: Error) => setError(e.message));
    else StatsApi.mine(period).then(setMine).catch((e: Error) => setError(e.message));
  }, [period, everyone]);

  const data = everyone ? server : mine;

  return (
    <AppShell>
      <div className="cn-stats">
        <header className="cn-stats__header">
          <div>
            <h1>{everyone ? t("stats.everyoneTitle") : t("stats.title")}</h1>
            <p>{everyone ? t("stats.everyoneIntro") : t("stats.intro")}</p>
          </div>
          <Link href={`/year/${year}`} className="cn-stats__year-link"><PartyPopper aria-hidden="true" /> {t("stats.yearLink", { year: String(year) })}</Link>
        </header>

        <div className="cn-stats__controls">
          {canManage && (
            <nav className="cn-stats__tabs" aria-label={t("stats.whose")}>
              <Link href="/stats" className={!everyone ? "cn-stats__tab cn-stats__tab--active" : "cn-stats__tab"}>{t("stats.you")}</Link>
              <Link href="/stats/everyone" className={everyone ? "cn-stats__tab cn-stats__tab--active" : "cn-stats__tab"}>{t("stats.everyone")}</Link>
            </nav>
          )}
          <SegmentedControl<StatsPeriod> label={t("stats.periodLabel")} value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p.value, label: t(p.label) }))} />
        </div>

        {!data && !error && <Spinner size="2rem" />}
        {error && <p className="cn-stats__empty">{error}</p>}

        {data && total(data.totals) === 0 && (
          <section className="cn-stats__empty">
            <h2>{t("stats.emptyTitle")}</h2>
            <p>{t("stats.emptyText")}</p>
          </section>
        )}

        {data && total(data.totals) > 0 && (
          <>
            <Totals totals={data.totals} />
            <section className="cn-settings__card">
              <TimeChart buckets={data.buckets} />
              <p className="cn-stats__counts">
                {[
                  data.counts.movies && t("stats.counts.movies", { count: data.counts.movies }),
                  data.counts.episodes && t("stats.counts.episodes", { count: data.counts.episodes }),
                  data.counts.tracks && t("stats.counts.tracks", { count: data.counts.tracks }),
                  data.counts.books && t("stats.counts.books", { count: data.counts.books }),
                  t("stats.counts.days", { count: data.counts.days }),
                ].filter(Boolean).join(t("common.dotSeparator"))}
              </p>
            </section>

            {mine && !everyone && <Highlights stats={mine} />}
            {server && everyone && <Everyone stats={server} />}

            <div className="cn-stats__grid">
              <TopList title={t("stats.topShows")} items={data.topShows} count={(n) => t("stats.counts.episodes", { count: n })} href={(id) => `/item/${id}`} />
              <TopList title={t("stats.topMovies")} items={data.topMovies} count={(n) => t("stats.counts.plays", { count: n })} href={(id) => `/item/${id}`} />
              {mine && !everyone && <TopList title={t("stats.topArtists")} items={mine.topArtists} count={(n) => t("stats.counts.plays", { count: n })} href={(id) => `/artist/${id}`} />}
              {mine && !everyone && <TopList title={t("stats.topBooks")} items={mine.topBooks} count={(n) => t("stats.counts.sittings", { count: n })} href={(id) => `/book/${id}`} />}
              {mine && !everyone && <Genres genres={mine.topGenres} />}
            </div>
          </>
        )}

        {server && everyone && <NobodyWatches stats={server} />}
        {mine && !everyone && <PrivacyCard isPrivate={mine.private} onChange={(value) => setMine({ ...mine, private: value })} />}
      </div>
    </AppShell>
  );
}

function Highlights(props: { stats: ProfileStats }) {
  const { stats } = props;
  return (
    <div className="cn-stats__highlights">
      <div className="cn-stats__highlight">
        <Flame aria-hidden="true" />
        <div>
          <strong>{stats.streak.current > 0 ? t("stats.streak.current", { count: stats.streak.current }) : t("stats.streak.none")}</strong>
          <span>{t("stats.streak.longest", { count: stats.streak.longest })}</span>
        </div>
      </div>
      {stats.binge && (
        <div className="cn-stats__highlight">
          <Tv aria-hidden="true" />
          <div>
            <strong>{t("stats.binge.title", { count: stats.binge.episodes, show: stats.binge.title })}</strong>
            <span>{t("stats.binge.when", { date: formatDate(stats.binge.day) })}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Everyone(props: { stats: ServerStats }) {
  const { stats } = props;
  const max = Math.max(1, ...stats.profiles.map((p) => total(p.totals)));
  return (
    <section className="cn-settings__card">
      <h2>{t("stats.people")}</h2>
      <div className="cn-stats__people">
        {stats.profiles.map((p) => (
          <div key={p.id} className="cn-stats__person">
            <Avatar profile={p} size={2} />
            <span className="cn-stats__person-name">{p.name}</span>
            <span className="cn-meter"><span style={{ width: `${total(p.totals) / max * 100}%` }} /></span>
            <span className="cn-stats__time">{spent(total(p.totals))}</span>
          </div>
        ))}
      </div>
      {stats.privateProfiles > 0 && <p className="cn-settings__row-text"><span>{t("stats.privateProfiles", { count: stats.privateProfiles })}</span></p>}
    </section>
  );
}

/**
 * What's in the libraries that nobody ever played.
 */
function NobodyWatches(props: { stats: ServerStats }) {
  const { stats } = props;
  if (stats.untouched.length === 0) return null;
  return (
    <section className="cn-settings__card">
      <h2>{t("stats.untouched.title")}</h2>
      <p className="cn-settings__row-text"><span>{t("stats.untouched.text")}</span></p>
      <div className="cn-stats__people">
        {stats.untouched.map((l) => (
          <div key={l.id} className="cn-stats__person">
            <span className="cn-stats__person-name">{l.name}</span>
            <span className="cn-meter"><span style={{ width: `${l.titles ? l.untouched / l.titles * 100 : 0}%` }} /></span>
            <span className="cn-stats__time">{t("stats.untouched.count", { count: l.untouched, total: l.titles })}</span>
          </div>
        ))}
      </div>
      {stats.neverPlayed.length > 0 && (
        <>
          <h3 className="cn-https__subheading">{t("stats.untouched.oldest")}</h3>
          <div className="cn-stats__never">
            {stats.neverPlayed.map((title) => (
              <Link key={title.id} href={`/item/${title.id}`} className="cn-stats__never-item">
                <span className="cn-stats__thumb">{title.image && <img src={ItemsApi.imageUrl(title.image, 160)} alt="" loading="lazy" />}</span>
                <span className="cn-stats__name"><strong>{title.title}</strong><span>{t("stats.untouched.added", { library: title.libraryName, date: formatDate(title.addedAt.slice(0, 10)) })}</span></span>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function PrivacyCard(props: { isPrivate: boolean; onChange: (value: boolean) => void }) {
  const { isPrivate, onChange } = props;
  const [saving, setSaving] = useState(false);
  async function change(value: boolean) {
    const user = session.user;
    if (!user) return;
    setSaving(true);
    try {
      session.setUser(await UsersApi.updateSelf({ preferences: { ...user.preferences, privateStats: value } }));
      onChange(value);
    } catch (error) {
      toasts.error(t("common.couldntSave"), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="cn-settings__card">
      <Switch label={t("stats.private.label")} description={t("stats.private.description")} checked={isPrivate} disabled={saving} onChange={change} />
    </section>
  );
}
