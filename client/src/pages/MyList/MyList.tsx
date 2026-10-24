import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import type { WatchlistEntry, WatchlistKind, WatchlistOverview } from "@shared/watchlist.ts";
import WatchlistApi from "../../Api/WatchlistApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import { timeAgo } from "../../lib/format.ts";
import { rich, t, type TranslationKey } from "../../i18n/I18n.ts";
import { Link } from "../../lib/Router.tsx";
import AppShell from "../../components/AppShell/AppShell.tsx";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import PosterCard, { fallbackColor } from "../../components/PosterCard/PosterCard.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import "../Search/Search.scss";
import "./MyList.scss";

const KINDS: Record<WatchlistKind, TranslationKey> = {
  movie: "myList.kind.movie",
  show: "myList.kind.show",
  video: "myList.kind.video",
};

/**
 * "My list": what the profile wants to watch, the titles that are here first, then the ones that aren't yet.
 */
export default function MyList() {
  const [data, setData] = useState<WatchlistOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    WatchlistApi.overview().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  async function remove(entry: WatchlistEntry) {
    try {
      setData(await WatchlistApi.removeEntry(entry.id));
      toasts.success(t("itemActions.removedFromList", { title: entry.title }));
    } catch (e) {
      toasts.error(t("itemActions.updateFailed"), (e as Error).message);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      const result = await WatchlistApi.sync();
      setData(result);
      if (result.trakt.error) toasts.error(t("myList.trakt.syncFailed"), result.trakt.error);
      else toasts.success(t("myList.trakt.synced"));
    } catch (e) {
      toasts.error(t("myList.trakt.syncFailed"), (e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const here = data?.entries.filter((e) => e.item) ?? [];
  const waiting = data?.entries.filter((e) => !e.item) ?? [];

  return (
    <AppShell>
      <div className="cn-mylist">
        <header className="cn-mylist__header">
          <div>
            <h1>{t("myList.title")}</h1>
            <p>{t("myList.intro")}</p>
          </div>
          {data?.trakt.linked && <Button icon={<RefreshCw />} onClick={sync} loading={syncing}>{t("myList.trakt.syncNow")}</Button>}
        </header>

        {data && (
          <p className="cn-mylist__trakt">
            {data.trakt.linked
              ? data.trakt.error
                ? t("myList.trakt.failed", { error: data.trakt.error })
                : data.trakt.syncedAt ? t("myList.trakt.syncedAgo", { ago: timeAgo(data.trakt.syncedAt) }) : t("myList.trakt.notYet")
              : rich("myList.trakt.notLinked", { link: (text) => <Link href="/settings/profile">{text}</Link> })}
          </p>
        )}

        {!data && !error && <Spinner size="2rem" />}
        {error && <p className="cn-mylist__trakt">{error}</p>}

        {data && data.entries.length === 0 && (
          <section className="cn-mylist__empty">
            <h2>{t("myList.empty.title")}</h2>
            <p>{t("myList.empty.text")}</p>
          </section>
        )}

        {here.length > 0 && (
          <section className="cn-mylist__section">
            <h2>{t("myList.here", { count: here.length })}</h2>
            <div className="cn-search__grid">
              {here.map((entry) => (
                <PosterCard
                  key={entry.id}
                  item={entry.item!}
                  badge={entry.arrivedAt && Date.now() - Date.parse(entry.arrivedAt) < 7 * 24 * 60 * 60 * 1000 ? t("myList.justArrived") : undefined}
                  actions={<IconButton label={t("itemActions.removeFromList")} icon={<X />} size="sm" onClick={() => remove(entry)} />}
                />
              ))}
            </div>
          </section>
        )}

        {waiting.length > 0 && (
          <section className="cn-mylist__section">
            <h2>{t("myList.waiting", { count: waiting.length })}</h2>
            <p className="cn-mylist__note">{t("myList.waitingText")}</p>
            <div className="cn-search__grid">
              {waiting.map((entry) => <WaitingCard key={entry.id} entry={entry} onRemove={() => remove(entry)} />)}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

interface WaitingCardProps {
  entry: WatchlistEntry;
  onRemove: () => void;
}

/**
 * A title on the list that isn't in a library: a tile in its own colours, linking to where it can be read about.
 */
function WaitingCard(props: WaitingCardProps) {
  const { entry, onRemove } = props;
  const art = (
    <span className="cn-poster__art cn-dark-theme" style={{ background: `linear-gradient(160deg, ${fallbackColor(entry.title)} 0%, #0B0D12 110%)` }}>
      <span className="cn-poster__fallback">{entry.title}</span>
      <span className="cn-poster__badge">{t("myList.notHere")}</span>
    </span>
  );
  const label = entry.year ? t("cards.poster.withYear", { title: entry.title, year: String(entry.year) }) : entry.title;
  return (
    <div className="cn-poster cn-mylist__waiting">
      {entry.link
        ? <a className="cn-poster__button" href={entry.link} target="_blank" rel="noreferrer" aria-label={label}>{art}</a>
        : <span className="cn-poster__button" aria-label={label}>{art}</span>}
      <div className="cn-poster__meta">
        <span className="cn-poster__title" title={entry.title}>{entry.title}</span>
        <span className="cn-poster__sub">{[entry.year ? String(entry.year) : null, t(KINDS[entry.kind])].filter(Boolean).join(t("common.dotSeparator"))}</span>
      </div>
      <div className="cn-poster__actions"><IconButton label={t("itemActions.removeFromList")} icon={<X />} size="sm" onClick={onRemove} /></div>
    </div>
  );
}
