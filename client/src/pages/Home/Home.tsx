import { useEffect, useState } from "react";
import { FolderPlus } from "lucide-react";
import type { HomeData, ItemSummary } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import { session } from "../../Session.ts";
import { router } from "../../lib/Router.tsx";
import { applyAmbient } from "../../lib/ambient.ts";
import { episodeLabel, formatDuration, play, timeLeft } from "../../lib/playback.ts";
import { toasts } from "../../lib/Toasts.ts";
import useController from "../../lib/useController.ts";
import { formatDate } from "../../lib/format.ts";
import cx from "../../lib/cx.ts";
import { t } from "../../i18n/I18n.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import Button from "../../components/Button/Button.tsx";
import Row from "../../components/Row/Row.tsx";
import PhotoAlbumCard from "../../components/PhotoAlbumCard/PhotoAlbumCard.tsx";
import { AlbumCard } from "../../components/MusicCard/MusicCard.tsx";
import BookCard from "../../components/BookCard/BookCard.tsx";
import PosterCard from "../../components/PosterCard/PosterCard.tsx";
import WideCard from "../../components/WideCard/WideCard.tsx";
import ClipCard from "../../components/ClipCard/ClipCard.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import { PlayRing } from "../../components/ItemActions/ItemActions.tsx";
import "./Home.scss";

function greeting(name: string) {
  const hour = new Date().getHours();
  if (hour < 5) return t("home.greeting.night", { name });
  if (hour < 12) return t("home.greeting.morning", { name });
  if (hour < 18) return t("home.greeting.afternoon", { name });
  return t("home.greeting.evening", { name });
}

/**
 * The home screen: a spotlight on the selected title, then continue watching, next up and what's new.
 * Hovering or focusing a card makes it the spotlight and retints the page (the ambient theme).
 */
export default function Home() {
  const { user } = useController(session);
  const home = useHome();
  const libraries = LibrariesApi.useLibraries();
  const [selected, setSelected] = useState<ItemSummary | null>(null);

  const spotlight = selected ?? home?.continueWatching[0] ?? home?.nextUp[0] ?? home?.recentlyAdded[0]?.items[0] ?? null;

  useEffect(() => {
    applyAmbient(spotlight?.palette ?? null);
  }, [spotlight?.palette?.accent]);
  useEffect(() => () => applyAmbient(null), []);

  const isEmpty = home && !home.continueWatching.length && !home.nextUp.length && !home.recentlyAdded.length && !home.recentlyAddedMusic.length && !home.recentlyAddedPhotos.length && !home.continueBooks.length;

  return (
    <AppShell>
      <div className="cn-home">
        {!home && <div className="cn-home__loading"><Spinner size="2rem" /></div>}

        {spotlight && <Spotlight item={spotlight} greeting={greeting(user?.name ?? "")} />}

        {home && home.continueWatching.length > 0 && (
          <Row title={t("home.rows.continueWatching")} kind="wide">
            {home.continueWatching.map((item) => <WideCard key={item.id} item={item} selected={item.id === spotlight?.id} onSelect={() => setSelected(item)} />)}
          </Row>
        )}

        {home && home.nextUp.length > 0 && (
          <Row title={t("home.rows.nextUp")} kind="wide">
            {home.nextUp.map((item) => <WideCard key={item.id} item={item} selected={item.id === spotlight?.id} onSelect={() => setSelected(item)} />)}
          </Row>
        )}

        {home?.recentlyAdded.map((row) => row.libraryType === "clips"
          ? (
            <Row key={row.libraryId} title={t("home.rows.newIn", { library: row.libraryName })} href={`/library/${row.libraryId}?view=clips`} kind="wide">
              {row.items.map((item) => <ClipCard key={item.id} item={item} onSelect={() => setSelected(item)} />)}
            </Row>
          )
          : row.libraryType === "videos"
          ? (
            <Row key={row.libraryId} title={t("home.rows.recentlyAddedIn", { library: row.libraryName })} href={`/library/${row.libraryId}?sort=added`} kind="wide">
              {row.items.map((item) => <WideCard key={item.id} item={item} variant="video" onSelect={() => setSelected(item)} />)}
            </Row>
          )
          : (
            <Row key={row.libraryId} title={t("home.rows.recentlyAddedIn", { library: row.libraryName })} href={`/library/${row.libraryId}?sort=added`} kind="poster">
              {row.items.map((item) => <PosterCard key={item.id} item={item} onSelect={() => setSelected(item)} />)}
            </Row>
          ))}

        {home && home.continueBooks.length > 0 && (
          <Row title={t("home.rows.continueBooks")} kind="square">
            {home.continueBooks.map((book) => <BookCard key={book.id} book={book} />)}
          </Row>
        )}

        {home?.recentlyAddedMusic.map((row) => (
          <Row key={row.libraryId} title={t("home.rows.newIn", { library: row.libraryName })} href={`/library/${row.libraryId}`} kind="square">
            {row.albums.map((album) => <AlbumCard key={album.id} album={album} />)}
          </Row>
        ))}

        {home?.recentlyAddedPhotos.map((row) => (
          <Row key={row.libraryId} title={t("home.rows.newIn", { library: row.libraryName })} href={`/library/${row.libraryId}`} kind="wide">
            {row.albums.map((album) => <PhotoAlbumCard key={album.id} album={album} />)}
          </Row>
        ))}

        {home?.becauseYouWatched && (
          <Row title={t("home.rows.becauseYouWatched", { title: home.becauseYouWatched.title })} kind="poster">
            {home.becauseYouWatched.items.map((item) => <PosterCard key={item.id} item={item} onSelect={() => setSelected(item)} />)}
          </Row>
        )}

        {isEmpty && (
          <section className="cn-home__empty">
            <h1>{greeting(user?.name ?? "")}</h1>
            {libraries && libraries.length === 0
              ? (
                <>
                  <p>{session.can("LIBRARY_MANAGE") ? t("home.empty.addFolder") : t("home.empty.askAdmin")}</p>
                  {session.can("LIBRARY_MANAGE") && <Button variant="primary" icon={<FolderPlus />} onClick={() => router.navigate("/settings/libraries")} data-autofocus>{t("home.empty.addLibrary")}</Button>}
                </>
              )
              : <p>{libraries?.some((l) => l.scan) ? t("home.empty.scanning") : t("home.empty.nothingToWatch")}</p>}
          </section>
        )}
      </div>
    </AppShell>
  );
}

/**
 * Titles longer than this many characters are set smaller, so most of them fit in the spotlight's two lines.
 */
const LONG_TITLE = 24;

/**
 * The selected title, big, with its artwork fading in behind the top of the page.
 */
function Spotlight(props: { item: ItemSummary; greeting: string }) {
  const { item, greeting } = props;
  const isEpisode = item.type === "episode";
  const art = item.artwork.backdrop ?? item.artwork.thumb;
  const left = timeLeft(item);
  const title = isEpisode ? item.showTitle ?? item.title : item.title;

  const facts = isEpisode
    ? [episodeLabel(item), item.title, left ?? t("home.spotlight.upNext")]
    : item.type === "video"
    ? [item.releaseDate ? formatDate(item.releaseDate) : null, item.runtime ? formatDuration(item.runtime * 60) : null, item.genres.slice(0, 2).join(t("common.listSeparator")) || null, left]
    : [item.year ? String(item.year) : null, item.type === "show" ? t("home.spotlight.seasons", { count: item.childCount }) : item.runtime ? formatDuration(item.runtime * 60) : null, item.genres.slice(0, 2).join(t("common.listSeparator")) || null, left];

  return (
    <section className="cn-spotlight" aria-live="polite">
      <div className="cn-spotlight__art" aria-hidden="true">
        {art && <img key={art} src={ItemsApi.imageUrl(art, 1920)} alt="" />}
      </div>
      <div className="cn-spotlight__content">
        <p className="cn-spotlight__greeting">{greeting}</p>
        {/* Always two lines tall, so moving between short and long titles doesn't shift the rows below */}
        <div className="cn-spotlight__title-box">
          <h1 className={cx("cn-spotlight__title", title.length > LONG_TITLE && "cn-spotlight__title--long")} title={title}>{title}</h1>
        </div>
        <p className="cn-spotlight__facts">{facts.filter(Boolean).join(t("common.dotSeparator"))}</p>
        <div className="cn-spotlight__buttons">
          <Button variant="primary" size="lg" icon={<PlayRing />} className="cn-actions__play" onClick={() => playSpotlight(item)}>
            {item.userData?.position ? t("common.resume") : t("common.play")}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => router.navigate(`/item/${item.id}`)}>{t("home.spotlight.details")}</Button>
        </div>
      </div>
    </section>
  );
}

/**
 * Shows play their next episode; everything else plays itself.
 */
async function playSpotlight(item: ItemSummary) {
  if (item.type !== "show") return play(item);
  const next = await ItemsApi.next(item.id).catch(() => null);
  if (next) play(next);
}

function useHome() {
  const [home, setHome] = useState<HomeData | null>(null);
  useEffect(() => {
    ItemsApi.home().then(setHome).catch((e: Error) => {
      toasts.error(t("home.loadFailed"), e.message);
      setHome({ continueWatching: [], nextUp: [], recentlyAdded: [], recentlyAddedMusic: [], recentlyAddedPhotos: [], continueBooks: [], becauseYouWatched: null });
    });
  }, []);
  return home;
}
