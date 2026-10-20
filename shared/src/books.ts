import type { Palette } from "./media.ts";

/**
 * Types for Audiobooks and Books libraries. An audiobook (`audiobook` item) is a folder of audio files or one
 * `.m4b`, played in the music player with chapters, speed and a sleep timer. A book (`book` item) is an EPUB, read
 * in the built-in reader, or a PDF, opened in the browser's own viewer.
 */

export type BookFormat = "audio" | "epub" | "pdf";

export interface BookSummary {
  id: number;
  libraryId: number;
  type: "audiobook" | "book";
  format: BookFormat;
  title: string;
  authors: string[];
  narrators: string[];
  year: number | null;
  /**
   * Cover as an image key. `null` = none.
   */
  cover: string | null;
  palette: Palette | null;
  /**
   * Audiobooks: the length. Unit is in seconds. `null` for books.
   */
  duration: number | null;
  /**
   * How far the signed-in profile got, 0 to 1. `null` = not started.
   */
  progress: number | null;
  finished: boolean;
  addedAt: string;
}

/**
 * A chapter of an audiobook. Times are in seconds from the start of the whole book.
 */
export interface BookChapter {
  title: string;
  start: number;
  end: number;
}

/**
 * One file of an audiobook, in playing order.
 */
export interface AudiobookPart {
  fileId: number;
  title: string;
  /**
   * Where the file starts in the whole book. Unit is in seconds.
   */
  offset: number;
  /**
   * Unit is in seconds.
   */
  duration: number;
}

export interface BookPerson {
  personId: number;
  name: string;
}

export interface BookDetail extends BookSummary {
  description: string | null;
  genres: string[];
  publisher: string | null;
  authorCredits: BookPerson[];
  narratorCredits: BookPerson[];
  parts: AudiobookPart[];
  chapters: BookChapter[];
  /**
   * Audiobooks: where listening stopped, in seconds. 0 = from the start.
   */
  position: number;
  /**
   * Books: where reading stopped, as `chapter:fraction` (like `4:0.35`). `null` = from the start.
   */
  bookmark: string | null;
  moreByAuthor: BookSummary[];
}

export interface BookPage {
  items: BookSummary[];
  total: number;
}

export type BookSort = "title" | "author" | "added" | "year";
export type BookFilter = "all" | "reading" | "unread" | "finished";

/**
 * Save where a profile is. Audiobooks send `position`; books send `bookmark` and `progress`.
 */
export interface BookProgressRequest {
  position?: number;
  bookmark?: string | null;
  progress?: number;
  finished?: boolean;
}

/**
 * How to open a book for reading. EPUB chapters are loaded from `base` + `href`, without a sign-in header, so the
 * reader's frame can load their pictures and styles too.
 */
export type BookReading =
  | { format: "epub"; base: string; chapters: { href: string; title: string | null }[] }
  | { format: "pdf"; url: string };

/**
 * Sleep timer choices for audiobooks: minutes, or `chapter` for the end of the current chapter.
 */
export type SleepTimer = 15 | 30 | 45 | 60 | "chapter";

export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
