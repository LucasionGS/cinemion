import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, ListPlus, Moon, Repeat, Repeat1, RotateCcw, RotateCw, Shuffle, SkipBack, SkipForward, Trash2, X } from "lucide-react";
import type { Lyrics as LyricsInfo } from "@shared/music.ts";
import { PLAYBACK_SPEEDS, type SleepTimer } from "@shared/books.ts";
import MusicApi from "../../Api/MusicApi.ts";
import { musicPlayer } from "../../lib/MusicPlayer.ts";
import useController from "../../lib/useController.ts";
import { Link, router } from "../../lib/Router.tsx";
import { deviceMode } from "../../lib/DeviceMode.ts";
import { formatClock } from "../../lib/playback.ts";
import cx from "../../lib/cx.ts";
import { rich, t, type TranslationKey } from "../../i18n/I18n.ts";
import IconButton from "../IconButton/IconButton.tsx";
import Button from "../Button/Button.tsx";
import { Cover } from "../MusicCard/MusicCard.tsx";
import { PlayButton, SeekBar, VolumeControl } from "../MiniPlayer/MiniPlayer.tsx";
import { addToPlaylist } from "../AddToPlaylist/AddToPlaylist.tsx";
import { Bars } from "../TrackList/TrackList.tsx";
import "./NowPlaying.scss";

/**
 * The full music player: big cover, controls, and the queue or lyrics beside it. Covers the page until closed.
 */
export default function NowPlaying() {
  const player = useController(musicPlayer);
  const { mode } = useController(deviceMode);
  const track = player.current;
  const panel = useRef<HTMLDivElement>(null);
  const open = player.nowPlayingOpen && !!track;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" && e.key !== "GoBack" && e.key !== "BrowserBack") return;
      // Menus and dialogs on top close first
      if (document.querySelector(".cn-menu, .cn-dialog")) return;
      e.preventDefault();
      musicPlayer.closeNowPlaying();
    }
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
      previous?.focus({ preventScroll: true });
    };
  }, [open]);

  // Leaving the page (a link inside) closes the view
  const { path } = useController(router);
  useEffect(() => {
    musicPlayer.closeNowPlaying();
  }, [path]);

  if (!open || !track) return null;
  const artist = track.trackArtist ?? track.artistName;
  const book = player.book;
  const { position, duration } = player.timeline();

  return (
    <div
      ref={panel}
      className="cn-now-playing cn-dark-theme"
      role="dialog"
      aria-modal="true"
      aria-label={t("music.nowPlaying.title")}
      data-focus-scope
      style={{ "--np-tint": track.palette?.accent ?? "var(--cn-accent)", "--np-base": track.palette?.base ?? "#08090B" } as CSSProperties}
    >
      <div className="cn-now-playing__glow" aria-hidden="true" />
      <header className="cn-now-playing__top">
        <IconButton label={t("common.close")} icon={<ChevronDown />} variant="ghost" onClick={() => musicPlayer.closeNowPlaying()} data-autofocus />
        <span>{t("music.nowPlaying.title")}</span>
        <IconButton label={t("music.player.stopAndClose")} icon={<X />} variant="ghost" onClick={() => musicPlayer.stop()} />
      </header>

      <div className="cn-now-playing__body">
        <section className="cn-now-playing__main">
          <Cover image={track.cover} title={track.albumTitle} width={780} className="cn-now-playing__cover" />
          <div className="cn-now-playing__info">
            <h2>{book ? player.currentChapter()?.title ?? book.title : track.title}</h2>
            {book
              ? <p><Link href={`/book/${book.id}`}>{book.title}</Link>{book.authors.length > 0 && `${t("common.dotSeparator")}${book.authors.join(t("common.listSeparator"))}`}</p>
              : (
                <p>
                  {track.artistId ? <Link href={`/artist/${track.artistId}`}>{artist}</Link> : artist}
                  {t("common.dotSeparator")}
                  {track.albumId ? <Link href={`/album/${track.albumId}`}>{track.albumTitle}</Link> : track.albumTitle}
                </p>
              )}
            {player.error && <p className="cn-now-playing__error" role="alert">{player.error}</p>}
          </div>
          <div className="cn-now-playing__seek">
            <SeekBar />
            <div className="cn-now-playing__times">
              <span>{formatClock(position)}</span>
              <span>-{formatClock(Math.max(0, duration - position) / (book ? player.speed : 1))}</span>
            </div>
          </div>
          {book && (
            <div className="cn-now-playing__controls">
              <button type="button" className="cn-now-playing__speed" onClick={() => musicPlayer.setSpeed(nextSpeed(player.speed))} aria-label={t("music.nowPlaying.speed", { speed: player.speed })}>
                {t("music.nowPlaying.speedValue", { speed: player.speed })}
              </button>
              <IconButton label={t("music.nowPlaying.previousChapter")} icon={<SkipBack />} variant="ghost" onClick={() => musicPlayer.previousChapter()} />
              <IconButton label={t("music.player.back30")} icon={<RotateCcw />} variant="ghost" size="lg" onClick={() => musicPlayer.skip(-30)} />
              <PlayButton size="lg" />
              <IconButton label={t("music.player.forward30")} icon={<RotateCw />} variant="ghost" size="lg" onClick={() => musicPlayer.skip(30)} />
              <IconButton label={t("music.nowPlaying.nextChapter")} icon={<SkipForward />} variant="ghost" onClick={() => musicPlayer.nextChapter()} />
              <SleepMenu />
            </div>
          )}
          {!book && <div className="cn-now-playing__controls">
            <IconButton label={player.shuffle ? t("music.nowPlaying.shuffleOn") : t("music.nowPlaying.shuffle")} icon={<Shuffle />} variant="ghost" className={cx(player.shuffle && "cn-now-playing__toggle--on")} aria-pressed={player.shuffle} onClick={() => musicPlayer.setShuffle(!player.shuffle)} />
            <IconButton label={t("music.player.previous")} icon={<SkipBack />} variant="ghost" size="lg" onClick={() => musicPlayer.previous()} />
            <PlayButton size="lg" />
            <IconButton label={t("music.player.next")} icon={<SkipForward />} variant="ghost" size="lg" onClick={() => musicPlayer.next()} />
            <IconButton
              label={player.repeat === "off" ? t("music.nowPlaying.repeat") : player.repeat === "all" ? t("music.nowPlaying.repeatAll") : t("music.nowPlaying.repeatOne")}
              icon={player.repeat === "one" ? <Repeat1 /> : <Repeat />}
              variant="ghost"
              className={cx(player.repeat !== "off" && "cn-now-playing__toggle--on")}
              aria-pressed={player.repeat !== "off"}
              onClick={() => musicPlayer.cycleRepeat()}
            />
          </div>}
          {mode === "desktop" && <div className="cn-now-playing__volume"><VolumeControl /></div>}
        </section>

        <section className="cn-now-playing__side">
          {book && <Chapters />}
          {!book && <div role="tablist" aria-label={t("music.nowPlaying.tabs")} className="cn-now-playing__tabs">
            {(["queue", "lyrics"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={player.nowPlayingTab === tab}
                className={cx("cn-now-playing__tab", player.nowPlayingTab === tab && "cn-now-playing__tab--active")}
                onClick={() => musicPlayer.setNowPlayingTab(tab)}
              >
                {tab === "queue" ? t("music.nowPlaying.upNext") : t("music.nowPlaying.lyrics")}
              </button>
            ))}
          </div>}
          {!book && (player.nowPlayingTab === "lyrics" ? <Lyrics trackId={track.id} /> : <Queue />)}
        </section>
      </div>
    </div>
  );
}

function nextSpeed(speed: number) {
  const i = PLAYBACK_SPEEDS.indexOf(speed as typeof PLAYBACK_SPEEDS[number]);
  return PLAYBACK_SPEEDS[(i + 1) % PLAYBACK_SPEEDS.length];
}

const SLEEP_CHOICES: { value: SleepTimer; key: TranslationKey; count?: number }[] = [
  { value: 15, key: "music.nowPlaying.sleep.minutes", count: 15 },
  { value: 30, key: "music.nowPlaying.sleep.minutes", count: 30 },
  { value: 45, key: "music.nowPlaying.sleep.minutes", count: 45 },
  { value: 60, key: "music.nowPlaying.sleep.hours", count: 1 },
  { value: "chapter", key: "music.nowPlaying.sleep.endOfChapter" },
];

/**
 * The sleep timer: a moon that shows how long is left once it's set.
 */
function SleepMenu() {
  const { sleep } = useController(musicPlayer);
  const [, setTick] = useState(0);

  // The minutes left count down while the menu shows them
  useEffect(() => {
    if (sleep?.mode === "chapter" || !sleep) return;
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [sleep]);

  const left = !sleep ? null : sleep.mode === "chapter" ? t("music.nowPlaying.sleep.chapterEnd") : formatClock(Math.max(0, (sleep.at - Date.now()) / 1000));
  return (
    <Menu.Root>
      <Menu.Trigger className={cx("cn-now-playing__sleep", sleep && "cn-now-playing__toggle--on")} aria-label={sleep ? t("music.nowPlaying.sleep.labelSet", { left: left ?? "" }) : t("music.nowPlaying.sleep.label")}>
        <Moon />
        {left && <span>{left}</span>}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} className="cn-menu__positioner">
          <Menu.Popup className="cn-menu">
            {SLEEP_CHOICES.map((choice) => (
              <Menu.Item key={choice.value} className="cn-menu__item" onClick={() => musicPlayer.setSleep(choice.value)}>
                {sleep?.mode === choice.value ? <Check /> : <span className="cn-menu__spacer" />} {t(choice.key, choice.count === undefined ? undefined : { count: choice.count })}
              </Menu.Item>
            ))}
            {sleep && <Menu.Separator className="cn-menu__separator" />}
            {sleep && <Menu.Item className="cn-menu__item" onClick={() => musicPlayer.setSleep(null)}><X /> {t("music.nowPlaying.sleep.turnOff")}</Menu.Item>}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * An audiobook's chapters, with the one playing highlighted. Clicking one plays from its start.
 */
function Chapters() {
  const player = useController(musicPlayer);
  const list = useRef<HTMLOListElement>(null);
  const current = player.currentChapterIndex();

  useEffect(() => {
    const el = list.current;
    const item = el?.querySelector<HTMLElement>(".cn-queue__item--current");
    if (el && item) scrollInside(el, item, "smooth");
  }, [current]);

  return (
    <div className="cn-queue" role="region" aria-label={t("music.nowPlaying.chapters.label")}>
      <div className="cn-queue__actions">
        <span>{t("music.nowPlaying.chapters.count", { count: player.book?.chapters.length ?? 0 })}</span>
      </div>
      <ol ref={list} className="cn-queue__list">
        {player.book?.chapters.map((chapter, i) => (
          <li key={i} className={cx("cn-queue__item", i === current && "cn-queue__item--current", i < current && "cn-queue__item--past")}>
            <button type="button" className="cn-queue__track" onClick={() => musicPlayer.seekTimeline(chapter.start)}>
              <span className="cn-queue__number">{i === current && player.playing ? <Bars /> : i + 1}</span>
              <span className="cn-queue__text">
                <strong>{chapter.title}</strong>
              </span>
              <span className="cn-queue__time">{formatClock(chapter.end - chapter.start)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Queue() {
  const player = useController(musicPlayer);
  const list = useRef<HTMLOListElement>(null);

  // Start with the playing track in view
  useEffect(() => {
    const el = list.current;
    const item = el?.querySelector<HTMLElement>(".cn-queue__item--current");
    if (el && item) scrollInside(el, item, "instant");
  }, []);

  return (
    <div className="cn-queue" role="tabpanel">
      <div className="cn-queue__actions">
        <span>{t("music.trackCount", { count: player.queue.length })}</span>
        <Button variant="ghost" size="sm" icon={<ListPlus />} onClick={() => addToPlaylist.show(player.queue.map((track) => track.id))}>{t("music.nowPlaying.queue.saveAsPlaylist")}</Button>
      </div>
      <ol ref={list} className="cn-queue__list">
        {player.queue.map((track, i) => (
          <li key={`${track.id}-${i}`} className={cx("cn-queue__item", i === player.index && "cn-queue__item--current", i < player.index && "cn-queue__item--past")}>
            <button type="button" className="cn-queue__track" onClick={() => i === player.index ? musicPlayer.toggle() : musicPlayer.jumpTo(i)}>
              <span className="cn-queue__lead">
                <Cover image={track.cover} title={track.albumTitle} width={96} />
                {i === player.index && player.playing && <Bars />}
              </span>
              <span className="cn-queue__text">
                <strong>{track.title}</strong>
                <span>{track.trackArtist ?? track.artistName}</span>
              </span>
              <span className="cn-queue__time">{formatClock(track.duration)}</span>
            </button>
            <IconButton label={t("music.nowPlaying.queue.remove", { title: track.title })} icon={<Trash2 />} variant="ghost" size="sm" className="cn-queue__remove" onClick={() => musicPlayer.removeAt(i)} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Lyrics(props: { trackId: number }) {
  const { trackId } = props;
  const { position } = useController(musicPlayer);
  const [lyrics, setLyrics] = useState<LyricsInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLyrics(null);
    setFailed(false);
    MusicApi.lyrics(trackId).then(setLyrics).catch(() => setFailed(true));
  }, [trackId]);

  // The line being sung: the last one that has started
  const lines = lyrics?.synced ?? null;
  let active = -1;
  if (lines) {
    for (let i = 0; i < lines.length && lines[i].time <= position + 0.25; i++) active = i;
  }

  useEffect(() => {
    const el = box.current;
    const line = el?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (el && line) scrollInside(el, line, "smooth");
  }, [active]);

  if (failed) return <p className="cn-lyrics__empty" role="tabpanel">{t("music.nowPlaying.lyricsPanel.failed")}</p>;
  if (!lyrics) return <p className="cn-lyrics__empty" role="tabpanel">{t("common.loading")}</p>;
  if (!lyrics.synced && !lyrics.plain) {
    return (
      <div className="cn-lyrics__empty" role="tabpanel">
        <p>{t("music.nowPlaying.lyricsPanel.none")}</p>
        <p>{rich("music.nowPlaying.lyricsPanel.source", { file: <code>.lrc</code> })}</p>
      </div>
    );
  }
  return (
    <div ref={box} className={cx("cn-lyrics", lines && "cn-lyrics--synced")} role="tabpanel">
      {lines
        ? lines.map((line, i) => (
          <button key={i} type="button" data-line={i} className={cx("cn-lyrics__line", i === active && "cn-lyrics__line--active", i < active && "cn-lyrics__line--past")} onClick={() => musicPlayer.seek(line.time)}>
            {line.text || "♪"}
          </button>
        ))
        : <p className="cn-lyrics__plain">{lyrics.plain}</p>}
    </div>
  );
}

/**
 * Scroll `container` so `child` is in its middle. Unlike `scrollIntoView`, the page around it stays put.
 */
function scrollInside(container: HTMLElement, child: HTMLElement, behavior: ScrollBehavior) {
  const top = child.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  container.scrollTo({ top: top - container.clientHeight / 2 + child.clientHeight / 2, behavior });
}
