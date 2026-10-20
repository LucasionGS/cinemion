import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ItemDetail, ItemSummary } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import { Link, router } from "../../lib/Router.tsx";
import { applyAmbient } from "../../lib/ambient.ts";
import { chooseTracks, defaultSubtitle, episodeLabel, formatDuration } from "../../lib/playback.ts";
import { formatDate } from "../../lib/format.ts";
import useController from "../../lib/useController.ts";
import cx from "../../lib/cx.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import ItemHero from "../../components/ItemHero/ItemHero.tsx";
import ItemMeta, { qualityBadges } from "../../components/ItemHero/ItemMeta.tsx";
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
 * The page for a movie, show, episode, video or folder. Seasons open their show with that season selected.
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
      {item?.type === "video" && <VideoView item={item} reload={reload} />}
      {item?.type === "folder" && <FolderView item={item} reload={reload} />}
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
        <Select
          label="Version"
          value={String(fileIndex)}
          onChange={(e) => {
            const index = Number(e.target.value);
            setFileIndex(index);
            chooseTracks(item.id, { fileId: item.files[index].id, audioIndex: undefined, subtitleIndex: undefined });
          }}
          options={item.files.map((f, i) => ({ value: String(i), label: versionLabel(f) }))}
        />
      )}
      {file && file.audio.length > 0 && (
        <Select
          key={`audio-${file.id}`}
          label="Audio"
          options={file.audio.map((a) => ({ value: String(a.index), label: trackLabel(a.language, a.title, channelLabel(a.channels), a.codec) }))}
          defaultValue={String(file.audio.find((a) => a.isDefault)?.index ?? file.audio[0].index)}
          onChange={(e) => chooseTracks(item.id, { fileId: file.id, audioIndex: Number(e.target.value) })}
        />
      )}
      {file && file.subtitles.length > 0 && (
        <Select
          key={`subtitles-${file.id}`}
          label="Subtitles"
          options={[{ value: "off", label: "Off" }, ...file.subtitles.map((s) => ({ value: String(s.index), label: trackLabel(s.language, s.title, s.isForced ? "Forced" : s.isImage ? "Picture" : null, null) }))]}
          defaultValue={String(defaultSubtitle(file)?.index ?? "off")}
          onChange={(e) => chooseTracks(item.id, { fileId: file.id, subtitleIndex: e.target.value === "off" ? null : Number(e.target.value) })}
        />
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

//#region Videos and folders

/**
 * "Home videos › Holiday 2024 › Day 2": the library and the folders above a video or folder.
 */
function FolderPath(props: { item: ItemDetail }) {
  const { item } = props;
  const library = LibrariesApi.useLibraries()?.find((l) => l.id === item.libraryId);
  return (
    <nav aria-label="Folders" className="cn-item__path">
      {library && <Link href={`/library/${library.id}`}>{library.name}</Link>}
      {item.folders.map((f) => <Link key={f.id} href={`/item/${f.id}`}>{f.title}</Link>)}
    </nav>
  );
}

function VideoView(props: ViewProps) {
  const { item, reload } = props;
  const parent = item.folders.at(-1);
  const library = LibrariesApi.useLibraries()?.find((l) => l.id === item.libraryId);

  return (
    <div className="cn-item">
      <ItemHero title={item.title} artwork={{ ...item.artwork, poster: null, logo: null }} palette={item.palette} hidePoster eyebrow={<FolderPath item={item} />}>
        <div className="cn-meta">
          {item.releaseDate && <span>{formatDate(item.releaseDate)}</span>}
          {item.runtime && <span>{formatDuration(item.runtime * 60)}</span>}
          {item.genres.length > 0 && <span>{item.genres.join(", ")}</span>}
          {item.contentRating && <span className="cn-meta__badge cn-meta__badge--outline">{item.contentRating}</span>}
          {qualityBadges(item.files).map((b) => <span key={b} className="cn-meta__badge">{b}</span>)}
        </div>
        <ItemActions item={item} onChanged={reload} />
        {item.overview && <p className="cn-item__overview">{item.overview}</p>}
      </ItemHero>
      <Details item={item} />
      {item.similar.length > 0 && (
        <Row title={`More in ${parent?.title ?? library?.name ?? "this folder"}`} href={parent ? `/item/${parent.id}` : library ? `/library/${library.id}` : undefined} kind="wide">
          {item.similar.map((v) => <WideCard key={v.id} item={v} variant="video" />)}
        </Row>
      )}
    </div>
  );
}

type FolderSort = "title" | "date" | "added";

/**
 * Subfolders first, then videos, each in the chosen order.
 */
function sortFolder(items: ItemSummary[], sort: FolderSort) {
  const compare = (a: ItemSummary, b: ItemSummary) => {
    if (sort === "date") return (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") || a.title.localeCompare(b.title);
    if (sort === "added") return b.addedAt.localeCompare(a.addedAt);
    return a.title.localeCompare(b.title, undefined, { numeric: true });
  };
  return [...items].sort((a, b) => (a.type === "folder" ? 0 : 1) - (b.type === "folder" ? 0 : 1) || compare(a, b));
}

function FolderView(props: ViewProps) {
  const { item, reload } = props;
  const [next, setNext] = useState<ItemSummary | null>(null);
  const [sort, setSort] = useState<FolderSort>("title");
  const children = useMemo(() => sortFolder(item.children, sort), [item.children, sort]);
  const folders = item.children.filter((c) => c.type === "folder").length;

  useEffect(() => {
    ItemsApi.next(item.id).then(setNext).catch(() => setNext(null));
  }, [item.id, item.userData?.unwatchedCount]);

  const counts = [
    folders ? `${folders} ${folders === 1 ? "folder" : "folders"}` : null,
    `${item.childCount} ${item.childCount === 1 ? "video" : "videos"}`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="cn-item">
      <ItemHero title={item.title} artwork={{ ...item.artwork, poster: null, logo: null }} palette={item.palette} hidePoster eyebrow={<FolderPath item={item} />}>
        <div className="cn-meta">
          <span>{counts}</span>
          {item.releaseDate && <span>Newest from {formatDate(item.releaseDate)}</span>}
        </div>
        <ItemActions item={item} playTarget={next} onChanged={reload} />
        {next && <p className="cn-item__next">{next.userData?.position ? "Continue with" : "Up next:"} {next.title}</p>}
        {item.overview && <p className="cn-item__overview">{item.overview}</p>}
      </ItemHero>

      <section className="cn-item__folder" aria-label="In this folder">
        <div className="cn-item__folder-head">
          <h2>In this folder</h2>
          <Select
            label="Sort by"
            value={sort}
            onChange={(e) => setSort(e.target.value as FolderSort)}
            options={[{ value: "title", label: "Title" }, { value: "date", label: "Date" }, { value: "added", label: "Recently added" }]}
          />
        </div>
        {children.length === 0 && <p className="cn-item__next">Nothing in here that this profile can watch.</p>}
        <div className="cn-item__videos">
          {children.map((c) => <WideCard key={c.id} item={c} variant="video" />)}
        </div>
      </section>
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
