import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ItemDetail, ItemSummary } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { Link, router } from "../../lib/Router.tsx";
import { applyAmbient } from "../../lib/ambient.ts";
import { episodeLabel, formatDuration } from "../../lib/playback.ts";
import useController from "../../lib/useController.ts";
import cx from "../../lib/cx.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import ItemHero from "../../components/ItemHero/ItemHero.tsx";
import ItemMeta from "../../components/ItemHero/ItemMeta.tsx";
import ItemActions from "../../components/ItemActions/ItemActions.tsx";
import Row from "../../components/Row/Row.tsx";
import PosterCard from "../../components/PosterCard/PosterCard.tsx";
import WideCard from "../../components/WideCard/WideCard.tsx";
import PersonCard from "../../components/PersonCard/PersonCard.tsx";
import Select from "../../components/Select/Select.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import Button from "../../components/Button/Button.tsx";
import "./Item.scss";

export interface ItemProps {
  id: number;
}

/**
 * The page for a movie, show or episode. Seasons open their show with that season selected.
 */
export default function Item(props: ItemProps) {
  const { id } = props;
  const { item, error, reload } = useItem(id);

  // The page takes the title's colours
  useEffect(() => {
    if (item) applyAmbient(item.palette);
    return () => applyAmbient(null);
  }, [item?.palette?.accent]);

  useEffect(() => {
    if (item?.type === "season" && item.parentId) router.navigate(`/item/${item.parentId}?season=${item.seasonNumber}`, { replace: true });
  }, [item]);

  return (
    <AppShell>
      {!item && !error && <div className="cn-item__loading"><Spinner size="2rem" /></div>}
      {error && (
        <section className="cn-item__missing">
          <h1>This title isn't available</h1>
          <p>{error}</p>
          <Button variant="primary" onClick={() => router.navigate("/")}>Go home</Button>
        </section>
      )}
      {item?.type === "movie" && <MovieView item={item} reload={reload} />}
      {item?.type === "show" && <ShowView item={item} reload={reload} />}
      {item?.type === "episode" && <EpisodeView item={item} reload={reload} />}
    </AppShell>
  );
}

interface ViewProps {
  item: ItemDetail;
  reload: () => void;
}

//#region Movie

function MovieView(props: ViewProps) {
  const { item, reload } = props;
  return (
    <div className="cn-item">
      <ItemHero title={item.title} artwork={item.artwork} palette={item.palette}>
        <ItemMeta item={item} />
        <ItemActions item={item} onChanged={reload} />
        {item.tagline && <p className="cn-item__tagline">{item.tagline}</p>}
        {item.overview && <p className="cn-item__overview">{item.overview}</p>}
      </ItemHero>
      <Details item={item} />
      <Cast item={item} />
      {item.collection && (
        <Link href={`/collection/${item.collection.id}`} className="cn-item__collection">
          <span>Part of</span>
          <strong>{item.collection.name}</strong>
          <span>{item.collection.itemCount} movies</span>
        </Link>
      )}
      {item.similar.length > 0 && (
        <Row title="More like this" kind="poster">
          {item.similar.map((s) => <PosterCard key={s.id} item={s} />)}
        </Row>
      )}
    </div>
  );
}

/**
 * Director, writers, studio, and pickers for version, audio and subtitles.
 */
function Details(props: { item: ItemDetail }) {
  const { item } = props;
  const [fileIndex, setFileIndex] = useState(0);
  const file = item.files[fileIndex] ?? item.files[0];
  const directors = item.credits.filter((c) => c.kind === "director").map((c) => c.name);
  const writers = item.credits.filter((c) => c.kind === "writer").map((c) => c.name);

  const facts = [
    directors.length ? { label: directors.length > 1 ? "Directors" : "Director", value: directors.join(", ") } : null,
    writers.length ? { label: writers.length > 1 ? "Writers" : "Writer", value: writers.slice(0, 3).join(", ") } : null,
    item.studios.length ? { label: item.type === "show" ? "Network" : "Studio", value: item.studios.join(", ") } : null,
  ].filter((f): f is { label: string; value: string } => !!f);

  return (
    <section className="cn-item__details">
      {facts.map((f) => (
        <div key={f.label} className="cn-item__fact">
          <span>{f.label}</span>
          <strong>{f.value}</strong>
        </div>
      ))}
      {item.files.length > 1 && (
        <Select label="Version" value={String(fileIndex)} onChange={(e) => setFileIndex(Number(e.target.value))} options={item.files.map((f, i) => ({ value: String(i), label: versionLabel(f) }))} />
      )}
      {file && file.audio.length > 0 && (
        <Select label="Audio" options={file.audio.map((a) => ({ value: String(a.index), label: trackLabel(a.language, a.title, channelLabel(a.channels), a.codec) }))} defaultValue={String(file.audio.find((a) => a.isDefault)?.index ?? file.audio[0].index)} />
      )}
      {file && file.subtitles.length > 0 && (
        <Select label="Subtitles" options={[{ value: "off", label: "Off" }, ...file.subtitles.map((s) => ({ value: String(s.index), label: trackLabel(s.language, s.title, s.isForced ? "Forced" : null, null) }))]} defaultValue={String(file.subtitles.find((s) => s.isForced || s.isDefault)?.index ?? "off")} />
      )}
    </section>
  );
}

function versionLabel(file: ItemDetail["files"][number]) {
  const height = file.height ?? 0;
  const resolution = height >= 2000 ? "4K" : height >= 1000 ? "1080p" : height >= 700 ? "720p" : height ? "SD" : "Unknown";
  const size = file.size > 1e9 ? `${(file.size / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(file.size / 1e6))} MB`;
  return `${resolution}${file.hdr ? " HDR" : ""} · ${file.videoCodec?.toUpperCase() ?? "?"} · ${size}`;
}

function channelLabel(channels: number) {
  return channels >= 8 ? "7.1" : channels >= 6 ? "5.1" : channels === 1 ? "Mono" : "Stereo";
}

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

function languageName(code: string | null) {
  if (!code) return "Unknown";
  try {
    return LANGUAGE_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}

function trackLabel(language: string | null, title: string | null, extra: string | null, codec: string | null) {
  return [languageName(language), title, extra, codec?.toUpperCase()].filter(Boolean).join(" · ");
}

function Cast(props: { item: ItemDetail }) {
  const { item } = props;
  // Directors and writers are listed in the details; the row is for the people on screen, then the rest
  const people = [...item.credits.filter((c) => c.kind === "cast"), ...item.credits.filter((c) => c.kind !== "cast" && c.kind !== "director" && c.kind !== "writer")];
  if (people.length === 0) return null;
  const roleLabel = (kind: string, character: string | null) => kind === "cast" ? character : kind.charAt(0).toUpperCase() + kind.slice(1);
  return (
    <Row title="Cast & crew" kind="person">
      {people.map((c, i) => <PersonCard key={`${c.personId}-${i}`} person={c} role={roleLabel(c.kind, c.character)} />)}
    </Row>
  );
}

//#endregion

//#region Show

function ShowView(props: ViewProps) {
  const { item, reload } = props;
  const { query } = useController(router);
  const seasons = item.children;
  const fromQuery = query.get("season");
  const initial = seasons.find((s) => String(s.seasonNumber) === fromQuery) ?? seasons.find((s) => s.seasonNumber !== 0) ?? seasons[0];
  const [seasonId, setSeasonId] = useState<number | null>(initial?.id ?? null);
  const [next, setNext] = useState<ItemSummary | null>(null);
  const [seasonKey, setSeasonKey] = useState(0);

  useEffect(() => {
    ItemsApi.next(item.id).then(setNext).catch(() => setNext(null));
  }, [item.id, item.userData?.unwatchedCount]);

  const refresh = useCallback(() => {
    reload();
    setSeasonKey((k) => k + 1);
  }, [reload]);

  return (
    <div className="cn-item">
      <ItemHero title={item.title} artwork={item.artwork} palette={item.palette}>
        <ItemMeta item={item} />
        <ItemActions item={item} playTarget={next} onChanged={refresh} />
        {next && <p className="cn-item__next">{next.userData?.position ? "Continue with" : "Up next:"} {episodeLabel(next)} · {next.title}</p>}
        {item.overview && <p className="cn-item__overview">{item.overview}</p>}
      </ItemHero>

      {seasons.length > 0 && (
        <section className="cn-item__seasons">
          <div className="cn-item__tabs" role="tablist" aria-label="Seasons">
            {seasons.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={s.id === seasonId}
                className={cx("cn-item__tab", s.id === seasonId && "cn-item__tab--active")}
                onClick={() => {
                  setSeasonId(s.id);
                  router.navigate(`/item/${item.id}?season=${s.seasonNumber}`, { replace: true });
                }}
              >
                {s.title}
                {!!s.userData?.unwatchedCount && s.userData.unwatchedCount < s.childCount && <span className="cn-item__tab-count">{s.userData.unwatchedCount}</span>}
              </button>
            ))}
          </div>
          {seasonId !== null && <SeasonEpisodes key={`${seasonId}-${seasonKey}`} seasonId={seasonId} />}
        </section>
      )}

      <Details item={item} />
      <Cast item={item} />
      {item.similar.length > 0 && (
        <Row title="More like this" kind="poster">
          {item.similar.map((s) => <PosterCard key={s.id} item={s} />)}
        </Row>
      )}
    </div>
  );
}

function SeasonEpisodes(props: { seasonId: number }) {
  const { seasonId } = props;
  const { item: season } = useItem(seasonId);
  if (!season) return <div className="cn-item__loading"><Spinner /></div>;
  return (
    <div className="cn-item__episodes">
      {season.children.map((episode) => <WideCard key={episode.id} item={episode} variant="episode" />)}
    </div>
  );
}

//#endregion

//#region Episode

function EpisodeView(props: ViewProps) {
  const { item, reload } = props;
  const { item: season } = useItem(item.parentId);
  const episodes = season?.children ?? [];
  const index = episodes.findIndex((e) => e.id === item.id);
  const previous = index > 0 ? episodes[index - 1] : null;
  const following = index >= 0 && index < episodes.length - 1 ? episodes[index + 1] : null;
  const aired = item.releaseDate ? new Date(item.releaseDate).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : null;

  return (
    <div className="cn-item">
      <ItemHero
        title={item.title}
        artwork={{ ...item.artwork, poster: null, logo: null }}
        palette={item.palette}
        hidePoster
        eyebrow={<><Link href={`/item/${item.showId}`}>{item.showTitle}</Link> · {episodeLabel(item)}</>}
      >
        <div className="cn-meta">
          {aired && <span>{aired}</span>}
          {item.runtime && <span>{formatDuration(item.runtime * 60)}</span>}
          {item.contentRating && <span className="cn-meta__badge cn-meta__badge--outline">{item.contentRating}</span>}
        </div>
        <ItemActions item={item} onChanged={reload} />
        {item.overview && <p className="cn-item__overview">{item.overview}</p>}
        <div className="cn-item__step">
          {previous && <Button variant="ghost" icon={<ChevronLeft />} onClick={() => router.navigate(`/item/${previous.id}`)}>{episodeLabel(previous)}</Button>}
          {following && <Button variant="ghost" onClick={() => router.navigate(`/item/${following.id}`)}>{episodeLabel(following)}<ChevronRight /></Button>}
        </div>
      </ItemHero>
      <Details item={item} />
      <Cast item={item} />
      {episodes.length > 1 && (
        <Row title={`More from ${season?.title ?? "this season"}`} kind="wide">
          {episodes.filter((e) => e.id !== item.id).map((e) => <WideCard key={e.id} item={e} variant="episode" />)}
        </Row>
      )}
    </div>
  );
}

//#endregion

/**
 * Load an item; `reload()` fetches it again after a change.
 */
function useItem(id: number | null) {
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    ItemsApi.get(id)
      .then((result) => {
        if (!cancelled) setItem(result);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return useMemo(() => ({ item, error, reload }), [item, error, reload]);
}
