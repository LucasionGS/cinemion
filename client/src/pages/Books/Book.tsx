import { Fragment, useEffect, useState } from "react";
import { BookOpen, Check, Play, RotateCcw, Undo2 } from "lucide-react";
import type { BookDetail } from "@shared/books.ts";
import BooksApi from "../../Api/BooksApi.ts";
import { musicPlayer } from "../../lib/MusicPlayer.ts";
import useController from "../../lib/useController.ts";
import { applyAmbient } from "../../lib/ambient.ts";
import { Link, router } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import { formatClock, formatDuration } from "../../lib/playback.ts";
import cx from "../../lib/cx.ts";
import { rich, t } from "../../i18n/I18n.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import Row from "../../components/Row/Row.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import BookCard from "../../components/BookCard/BookCard.tsx";
import { Cover } from "../../components/MusicCard/MusicCard.tsx";
import { Bars } from "../../components/TrackList/TrackList.tsx";
import MusicHeader from "../Music/MusicHeader.tsx";
import "../Music/Music.scss";
import "./Books.scss";

export interface BookProps {
  id: number;
}

/**
 * A book or audiobook: its details, chapters and the profile's place, with Listen or Read.
 */
export default function Book(props: BookProps) {
  const { id } = props;
  const [book, setBook] = useState<BookDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const player = useController(musicPlayer);
  const playingThis = player.book?.id === id;

  function load() {
    BooksApi.get(id).then(setBook).catch((e) => setError((e as Error).message));
  }
  useEffect(load, [id]);

  useEffect(() => {
    if (book) applyAmbient(book.palette);
    return () => applyAmbient(null);
  }, [book]);

  async function setFinished(finished: boolean) {
    try {
      await BooksApi.progress(id, { finished });
      load();
    } catch (e) {
      toasts.error(t("books.book.saveFailed"), (e as Error).message);
    }
  }

  const audio = book?.type === "audiobook";
  const started = book && (audio ? book.position > 0 : !!book.bookmark);
  const left = book && audio && book.duration ? Math.max(0, book.duration - book.position) : 0;
  const details = book ? [book.year, audio && book.duration ? formatDuration(book.duration) : null, book.publisher].filter(Boolean) : [];

  return (
    <AppShell>
      <div className="cn-music">
        {error && <section className="cn-music__empty"><h2>{t("books.book.notFound")}</h2><p>{error}</p></section>}
        {!book && !error && <div className="cn-music__loading"><Spinner size="2rem" /></div>}
        {book && (
          <>
            <MusicHeader
              cover={<Cover image={book.cover} title={book.title} width={500} className={cx(!audio && "cn-cover--portrait")} />}
              eyebrow={audio ? t("books.book.eyebrow.audiobook") : book.format === "pdf" ? t("books.book.eyebrow.bookPdf") : t("books.book.eyebrow.book")}
              title={book.title}
              meta={
                <>
                  {book.authorCredits.map((a, i) => <Fragment key={a.personId}>{i > 0 && t("common.listSeparator")}<Link href={`/person/${a.personId}`}>{a.name}</Link></Fragment>)}
                  {book.narratorCredits.length > 0 && (
                    <span>
                      {t("common.dotSeparator")}{rich("books.book.readBy", { narrators: book.narratorCredits.map((n, i) => <Fragment key={n.personId}>{i > 0 && t("common.listSeparator")}<Link href={`/person/${n.personId}`}>{n.name}</Link></Fragment>) })}
                    </span>
                  )}
                  {details.length > 0 && <span>{book.authorCredits.length || book.narratorCredits.length ? t("common.dotSeparator") : ""}{details.join(t("common.dotSeparator"))}</span>}
                </>
              }
              actions={
                <>
                  {audio
                    ? (
                      <Button variant="primary" icon={<Play />} data-autofocus onClick={() => playingThis ? musicPlayer.toggle() : musicPlayer.playBook(book)}>
                        {playingThis ? (player.playing ? t("books.book.pause") : t("common.resume")) : started ? t("books.book.continueListening", { left: formatDuration(left) }) : t("books.book.listen")}
                      </Button>
                    )
                    : <Button variant="primary" icon={<BookOpen />} data-autofocus onClick={() => router.navigate(`/read/${book.id}`)}>{started ? t("books.book.continueReading") : t("books.book.read")}</Button>}
                  {audio && started && !playingThis && <Button variant="secondary" icon={<RotateCcw />} onClick={() => musicPlayer.playBook(book, 0)}>{t("books.book.fromStart")}</Button>}
                  {book.finished
                    ? <IconButton label={t("books.book.markUnfinished")} icon={<Undo2 />} onClick={() => setFinished(false)} />
                    : <IconButton label={t("books.book.markFinished")} icon={<Check />} onClick={() => setFinished(true)} />}
                </>
              }
            />
            {book.progress !== null && !book.finished && (
              <div className="cn-book__progress" aria-label={t("books.book.done", { percent: Math.round(book.progress * 100) })}>
                <span style={{ width: `${book.progress * 100}%` }} />
              </div>
            )}
            {book.description && <p className="cn-book__description">{book.description}</p>}
            {audio && book.chapters.length > 1 && (
              <section className="cn-music__section">
                <h2>{t("books.book.chapters")}</h2>
                <ol className="cn-book__chapters">
                  {book.chapters.map((chapter, i) => {
                    const current = playingThis && player.currentChapterIndex() === i;
                    return (
                      <li key={i} className={cx(current && "cn-book__chapter--current")}>
                        <button type="button" onClick={() => playingThis ? musicPlayer.seekTimeline(chapter.start) : musicPlayer.playBook(book, chapter.start)}>
                          <span className="cn-book__chapter-number">{current && player.playing ? <Bars /> : i + 1}</span>
                          <strong>{chapter.title}</strong>
                          <span>{formatClock(chapter.start)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}
            {book.genres.length > 0 && <p className="cn-book__genres">{book.genres.join(t("common.dotSeparator"))}</p>}
            {book.moreByAuthor.length > 0 && (
              <Row title={t("books.book.moreBy", { author: book.authors[0] })} kind="square">
                {book.moreByAuthor.map((b) => <BookCard key={b.id} book={b} subtitle={b.year ? String(b.year) : ""} />)}
              </Row>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
