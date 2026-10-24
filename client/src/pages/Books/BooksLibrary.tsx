import { useCallback, useEffect, useState } from "react";
import type { LibraryInfo } from "@shared/api.ts";
import type { BookFilter, BookSort, BookSummary } from "@shared/books.ts";
import BooksApi from "../../Api/BooksApi.ts";
import usePaged from "../../lib/usePaged.ts";
import { t, type TranslationKey } from "../../i18n/I18n.ts";
import Select from "../../components/Select/Select.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import BookCard from "../../components/BookCard/BookCard.tsx";
import "../Music/Music.scss";
import "./Books.scss";

const SORTS: { value: BookSort; label: TranslationKey }[] = [
  { value: "title", label: "books.library.sorts.title" },
  { value: "author", label: "books.library.sorts.author" },
  { value: "added", label: "books.library.sorts.added" },
  { value: "year", label: "books.library.sorts.year" },
];

export interface BooksLibraryProps {
  library: LibraryInfo;
}

/**
 * An Audiobooks or Books library as a grid of covers, with what the profile is reading or listening to.
 */
export default function BooksLibrary(props: BooksLibraryProps) {
  const { library } = props;
  const audio = library.type === "audiobooks";
  const [sort, setSort] = useState<BookSort>("title");
  const [filter, setFilter] = useState<BookFilter>("all");
  const [genre, setGenre] = useState<string | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const load = useCallback((offset: number) => BooksApi.books(library.id, { sort, filter, genre, offset }), [library.id, sort, filter, genre]);
  const { items, total, loading, sentinel } = usePaged<BookSummary>(load);
  const countKey: TranslationKey = audio ? "books.audiobookCount" : "books.bookCount";

  useEffect(() => {
    BooksApi.genres(library.id).then(setGenres).catch(() => setGenres([]));
  }, [library.id]);

  return (
    <div className="cn-music">
      <header className="cn-library__header">
        <div>
          <h1>{library.name}</h1>
          <p>{t(countKey, { count: library.itemCount })}{library.scan && `${t("common.dotSeparator")}${t("books.library.scanning")}`}</p>
        </div>
        <div className="cn-music__filters">
          <SegmentedControl<BookFilter>
            label={t("books.library.show")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("books.library.filters.all") },
              { value: "reading", label: audio ? t("books.library.filters.listening") : t("books.library.filters.reading") },
              { value: "unread", label: audio ? t("books.library.filters.notStarted") : t("books.library.filters.unread") },
              { value: "finished", label: t("books.library.filters.finished") },
            ]}
          />
          {genres.length > 0 && (
            <Select
              label={t("books.library.genre")}
              value={genre ?? ""}
              options={[{ value: "", label: t("books.library.allGenres") }, ...genres.map((g) => ({ value: g, label: g }))]}
              onChange={(e) => setGenre(e.target.value || null)}
              className="cn-music__select"
            />
          )}
          <Select label={t("books.library.sortBy")} value={sort} options={SORTS.map((s) => ({ value: s.value, label: t(s.label) }))} onChange={(e) => setSort(e.target.value as BookSort)} className="cn-music__select" />
        </div>
      </header>

      {library.itemCount === 0 && (
        <section className="cn-music__empty">
          <h2>{t("books.library.emptyTitle")}</h2>
          <p>
            {library.scan
              ? t("books.library.scanningText")
              : audio
              ? t("books.library.emptyAudiobooks", { paths: library.paths.join(t("common.listSeparator")) })
              : t("books.library.emptyBooks", { paths: library.paths.join(t("common.listSeparator")) })}
          </p>
        </section>
      )}
      {library.itemCount > 0 && items?.length === 0 && !loading && (
        <section className="cn-music__empty">
          <p>{filter === "reading" ? (audio ? t("books.library.noneListening") : t("books.library.noneReading")) : filter === "finished" ? t("books.library.noneFinished") : t("books.library.noneHere")}</p>
        </section>
      )}
      <div className="cn-music__grid cn-books__grid" aria-label={total !== null ? t(countKey, { count: total }) : undefined}>
        {items?.map((book) => <BookCard key={book.id} book={book} />)}
      </div>
      <div ref={sentinel} />
      {loading && <div className="cn-music__loading"><Spinner size="2rem" /></div>}
    </div>
  );
}
