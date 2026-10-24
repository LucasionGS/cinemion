import { useEffect, useState } from "react";
import { CircleHelp, Sparkles } from "lucide-react";
import type { LibraryInfo } from "@shared/api.ts";
import type { ClipsOverview, GameSort } from "@shared/clips.ts";
import ClipsApi from "../../Api/ClipsApi.ts";
import { router } from "../../lib/Router.tsx";
import useController from "../../lib/useController.ts";
import { toasts } from "../../lib/Toasts.ts";
import { formatDuration } from "../../lib/playback.ts";
import { rich, t, type TranslationKey } from "../../i18n/I18n.ts";
import PosterCard from "../../components/PosterCard/PosterCard.tsx";
import ClipCard from "../../components/ClipCard/ClipCard.tsx";
import Row from "../../components/Row/Row.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Select from "../../components/Select/Select.tsx";
import Button from "../../components/Button/Button.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import ClipBrowser from "./ClipBrowser.tsx";
import "../Library/Library.scss";
import "./Clips.scss";

type View = "games" | "clips";

const SORTS: { value: GameSort; label: TranslationKey }[] = [
  { value: "recent", label: "clips.library.sort.recent" },
  { value: "title", label: "clips.library.sort.title" },
  { value: "clips", label: "clips.library.sort.clips" },
];

export interface ClipsLibraryProps {
  library: LibraryInfo;
}

/**
 * A Clips library: its games as covers, with the newest clips below, or every clip on the "All clips" tab.
 */
export default function ClipsLibrary(props: ClipsLibraryProps) {
  const { library } = props;
  const { query } = useController(router);
  const view: View = query.get("view") === "clips" ? "clips" : "games";
  const initialGame = query.get("game") === "none" ? "none" : query.get("game") ? Number(query.get("game")) : null;
  const [sort, setSort] = useState<GameSort>("recent");
  const [overview, setOverview] = useState<ClipsOverview | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    ClipsApi.overview(library.id, sort).then(setOverview).catch((error) => toasts.error(t("clips.library.couldntLoad"), (error as Error).message));
  }, [library.id, sort, version, !!library.scan]);

  function show(next: View, game?: "none") {
    router.navigate(`/library/${library.id}${next === "clips" ? `?view=clips${game ? `&game=${game}` : ""}` : ""}`, { replace: true, keepScroll: next === view });
  }

  const empty = overview && overview.clipCount === 0;
  const counts = overview
    ? [t("clips.counts.clips", { count: overview.clipCount }), t("clips.counts.games", { count: overview.gameCount })]
    : [];

  return (
    <div className="cn-library cn-clips">
      <header className="cn-library__header">
        <div>
          <h1>{library.name}</h1>
          <p>{[...counts, library.scan ? t("clips.library.scanning") : null].filter(Boolean).join(t("common.dotSeparator"))}</p>
        </div>
        <div className="cn-library__filters">
          <SegmentedControl<View> label={t("clips.library.show")} value={view} onChange={(v) => show(v)} options={[{ value: "games", label: t("clips.library.games") }, { value: "clips", label: t("clips.library.allClips") }]} />
          {view === "games" && <Select label={t("clips.library.sortGames")} value={sort} options={SORTS.map((s) => ({ value: s.value, label: t(s.label) }))} onChange={(e) => setSort(e.target.value as GameSort)} className="cn-library__select" />}
        </div>
      </header>

      {!overview && <div className="cn-library__loading"><Spinner size="2rem" /></div>}

      {empty && (
        <section className="cn-library__empty">
          <h2>{t("clips.library.emptyTitle")}</h2>
          <p>
            {library.scan
              ? t("clips.library.emptyScanning")
              : t("clips.library.emptyHint", { paths: library.paths.join(t("common.listSeparator")) })}
          </p>
        </section>
      )}

      {view === "games" && overview && !empty && (
        <>
          {overview.suggestedCount > 0 && (
            <section className="cn-clips__notice">
              <Sparkles aria-hidden="true" />
              <p>
                {rich("clips.library.suggestion", { count: overview.suggestedCount, clips: <strong>{t("clips.counts.clips", { count: overview.suggestedCount })}</strong> })}
              </p>
              <Button size="sm" onClick={() => show("clips", "none")}>{t("clips.library.haveALook")}</Button>
            </section>
          )}
          <div className="cn-library__grid">
            {overview.games.map((game) => (
              <PosterCard
                key={game.id}
                item={game}
                subtitle={[t("clips.counts.clips", { count: game.clipCount }), game.totalSeconds >= 60 ? formatDuration(game.totalSeconds) : null].filter(Boolean).join(t("common.dotSeparator"))}
              />
            ))}
            {overview.noGameCount > 0 && <NoGameCard count={overview.noGameCount} onOpen={() => show("clips", "none")} />}
          </div>
          {overview.recent.length > 0 && (
            <Row title={t("clips.library.newest")} kind="wide" href={`/library/${library.id}?view=clips`}>
              {overview.recent.map((clip) => <ClipCard key={clip.id} item={clip} />)}
            </Row>
          )}
        </>
      )}

      {view === "clips" && overview && !empty && (
        <ClipBrowser libraryId={library.id} games={overview.games} initialGame={initialGame} onChanged={() => setVersion((v) => v + 1)} />
      )}
    </div>
  );
}

/**
 * The tile for clips without a game, after the games.
 */
function NoGameCard(props: { count: number; onOpen: () => void }) {
  const { count, onOpen } = props;
  return (
    <div className="cn-poster">
      <button type="button" className="cn-poster__button" onClick={onOpen} aria-label={t("clips.library.noGameLabel", { count })}>
        <span className="cn-poster__art cn-clips__no-game"><CircleHelp aria-hidden="true" /></span>
      </button>
      <div className="cn-poster__meta">
        <span className="cn-poster__title">{t("clips.library.noGame")}</span>
        <span className="cn-poster__sub">{t("clips.counts.clips", { count })}</span>
      </div>
    </div>
  );
}
