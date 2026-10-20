import { useCallback, useEffect, useState } from "react";
import type { LibraryInfo } from "@shared/api.ts";
import type { BookFilter, BookSort, BookSummary } from "@shared/books.ts";
import BooksApi from "../../Api/BooksApi.ts";
import usePaged from "../../lib/usePaged.ts";
import Select from "../../components/Select/Select.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import BookCard from "../../components/BookCard/BookCard.tsx";
import "../Music/Music.scss";
import "./Books.scss";

const SORTS: { value: BookSort; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "added", label: "Recently added" },
  { value: "year", label: "Year" },
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
  const noun = audio ? ["audiobook", "audiobooks"] : ["book", "books"];

  useEffect(() => {
    BooksApi.genres(library.id).then(setGenres).catch(() => setGenres([]));
  }, [library.id]);

  return (
    <div className="cn-music">
      <header className="cn-library__header">
        <div>
          <h1>{library.name}</h1>
          <p>{library.itemCount} {noun[library.itemCount === 1 ? 0 : 1]}{library.scan && " · Scanning…"}</p>
        </div>
        <div className="cn-music__filters">
          <SegmentedControl<BookFilter>
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "reading", label: audio ? "Listening" : "Reading" },
              { value: "unread", label: audio ? "Not started" : "Unread" },
              { value: "finished", label: "Finished" },
            ]}
          />
          {genres.length > 0 && (
            <Select
              label="Genre"
              value={genre ?? ""}
              options={[{ value: "", label: "All genres" }, ...genres.map((g) => ({ value: g, label: g }))]}
              onChange={(e) => setGenre(e.target.value || null)}
              className="cn-music__select"
            />
          )}
          <Select label="Sort by" value={sort} options={SORTS} onChange={(e) => setSort(e.target.value as BookSort)} className="cn-music__select" />
        </div>
      </header>

      {library.itemCount === 0 && (
        <section className="cn-music__empty">
          <h2>Nothing in here yet</h2>
          <p>
            {library.scan
              ? "Cinemion is scanning this library right now. Books appear as they're found."
              : audio
              ? `Audiobooks from ${library.paths.join(", ")} appear here after a scan: a folder of audio files is one book, and so is a single .m4b.`
              : `EPUB and PDF books from ${library.paths.join(", ")} appear here after a scan.`}
          </p>
        </section>
      )}
      {library.itemCount > 0 && items?.length === 0 && !loading && (
        <section className="cn-music__empty">
          <p>{filter === "reading" ? `Nothing ${audio ? "being listened to" : "being read"} right now.` : filter === "finished" ? "Nothing finished yet." : "Nothing here."}</p>
        </section>
      )}
      <div className="cn-music__grid cn-books__grid" aria-label={total !== null ? `${total} ${noun[total === 1 ? 0 : 1]}` : undefined}>
        {items?.map((book) => <BookCard key={book.id} book={book} />)}
      </div>
      <div ref={sentinel} />
      {loading && <div className="cn-music__loading"><Spinner size="2rem" /></div>}
    </div>
  );
}
