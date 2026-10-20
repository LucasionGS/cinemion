import { Check, Headphones } from "lucide-react";
import type { BookSummary } from "@shared/books.ts";
import { router } from "../../lib/Router.tsx";
import cx from "../../lib/cx.ts";
import MusicCard, { Cover } from "../MusicCard/MusicCard.tsx";
import "./BookCard.scss";

export interface BookCardProps {
  book: BookSummary;
  /**
   * Line under the title. Default is the authors.
   */
  subtitle?: string;
}

/**
 * A book's cover (portrait) or an audiobook's (square), with how far the profile got.
 */
export default function BookCard(props: BookCardProps) {
  const { book, subtitle } = props;
  const audio = book.type === "audiobook";
  return (
    <MusicCard
      className={cx("cn-book-card", !audio && "cn-book-card--portrait")}
      title={book.title}
      subtitle={subtitle ?? (book.authors.join(", ") || (book.year ? String(book.year) : ""))}
      cover={
        <span className="cn-book-card__art">
          <Cover image={book.cover} title={book.title} className={cx(!audio && "cn-cover--portrait")} />
          {audio && <span className="cn-book-card__badge" aria-label="Audiobook"><Headphones /></span>}
          {book.format === "pdf" && <span className="cn-book-card__badge">PDF</span>}
          {book.finished && <span className="cn-book-card__done" aria-label="Finished"><Check /></span>}
          {book.progress !== null && <span className="cn-book-card__progress"><span style={{ width: `${Math.round(book.progress * 100)}%` }} /></span>}
        </span>
      }
      onClick={() => router.navigate(`/book/${book.id}`)}
    />
  );
}
