import Path from "node:path";
import { Hono } from "hono";
import { Op } from "sequelize";
import type { BookDetail, BookFilter, BookPage, BookProgressRequest, BookReading, BookSort } from "@shared/books.ts";
import type { AudioFormat, TrackStream, TrackStreamRequest } from "@shared/music.ts";
import { Credit, Library, MediaFile, MediaItem, User, WatchState } from "../models/index.ts";
import PlayLog from "../stats/PlayLog.ts";
import Visibility from "../library/Visibility.ts";
import BookLibrary from "../books/BookLibrary.ts";
import BookSummaries from "../books/BookSummaries.ts";
import Epub from "../books/Epub.ts";
import AudioStream from "../music/AudioStream.ts";
import StreamGrants from "../media/StreamGrants.ts";
import { errorMessage, readJson, sendFile } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Browsing Audiobooks and Books libraries, listening, reading, and keeping each profile's place.
 */
export namespace BooksController {
  export const router = new Hono<AppEnv>();

  const AUDIO_FORMATS: AudioFormat[] = ["mp3", "aac", "flac", "opus", "vorbis", "alac", "wav"];
  const ROW_SIZE = 18;

  async function bookLibrary(user: User, id: number) {
    const library = await Library.findByPk(id);
    return library && (library.type === "audiobooks" || library.type === "books") && Visibility.canSeeLibrary(user, library.id) ? library : null;
  }

  async function visibleBook(user: User, id: number) {
    const item = await MediaItem.findByPk(id);
    return item && (item.type === "audiobook" || item.type === "book") && Visibility.canSee(user, item) ? item : null;
  }

  /**
   * The books in progress for `user`, most recently opened first, for the home screen.
   */
  export async function continueBooks(user: User) {
    const states = await WatchState.findAll({ where: { userId: user.id, watched: false, position: { [Op.gt]: 0 } }, order: [["lastWatchedAt", "DESC"]], limit: 60 });
    const books = states.length ? await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { id: states.map((s) => s.itemId), type: ["audiobook", "book"] }] } }) : [];
    const byId = new Map(books.map((b) => [b.id, b]));
    return await BookSummaries.build(states.map((s) => byId.get(s.itemId)).filter((b): b is MediaItem => !!b).slice(0, ROW_SIZE), user);
  }

  /**
   * @swagger
   * /api/books/libraries/{id}/books:
   *   get:
   *     summary: Books in an Audiobooks or Books library. Query `sort` (title, author, added, year), `filter` (all,
   *       reading, unread, finished), `genre`, `offset`, `limit`.
   */
  router.get("/libraries/:id/books", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await bookLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const sort = (c.req.query("sort") ?? "title") as BookSort;
    const filter = (c.req.query("filter") ?? "all") as BookFilter;
    const genre = c.req.query("genre");
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "60") || 60, 1), 500);
    const offset = Math.max(parseInt(c.req.query("offset") ?? "0") || 0, 0);

    const conditions = [Visibility.where(user), { libraryId: library.id, type: ["audiobook", "book"] }, ...(genre ? [MediaItem.genreCondition(genre)] : [])];
    // Books libraries are small enough to filter and sort by author and progress here
    const all = await MediaItem.findAll({ where: { [Op.and]: conditions } });
    const extra = await BookSummaries.extras(all, user);
    let books = all.filter((book) => {
      const state = extra.states.get(book.id);
      if (filter === "finished") return !!state?.watched;
      if (filter === "reading") return !!state && !state.watched && state.position > 0;
      if (filter === "unread") return !state || (!state.watched && !state.position);
      return true;
    });
    const author = (b: MediaItem) => extra.authors.get(b.id)?.[0]?.name.toLowerCase() ?? "￿";
    books = books.sort((a, b) => {
      if (sort === "added") return b.addedAt.getTime() - a.addedAt.getTime() || a.sortTitle.localeCompare(b.sortTitle);
      if (sort === "year") return (b.year ?? 0) - (a.year ?? 0) || a.sortTitle.localeCompare(b.sortTitle);
      if (sort === "author") return author(a).localeCompare(author(b)) || (a.year ?? 0) - (b.year ?? 0) || a.sortTitle.localeCompare(b.sortTitle);
      return a.sortTitle.localeCompare(b.sortTitle);
    });
    const page: BookPage = { items: books.slice(offset, offset + limit).map((b) => BookSummaries.summary(b, extra)), total: books.length };
    return c.json(page);
  });

  /**
   * @swagger
   * /api/books/libraries/{id}/genres:
   *   get:
   *     summary: Genres of the books in a library.
   */
  router.get("/libraries/:id/genres", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await bookLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const books = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { libraryId: library.id }] }, attributes: ["genres"] });
    return c.json([...new Set(books.flatMap((b) => b.genres))].sort((a, b) => a.localeCompare(b)));
  });

  /**
   * @swagger
   * /api/books/{id}:
   *   get:
   *     summary: A book or audiobook with its parts, chapters, the profile's place, and more by the same author.
   */
  router.get("/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const book = await visibleBook(user, Number(c.req.param("id")));
    if (!book) return c.json({ message: "That book doesn't exist." }, 404);
    const extra = await BookSummaries.extras([book], user);
    const files = await MediaFile.findAll({ where: { itemId: book.id } });
    const { parts, chapters } = book.type === "audiobook" ? BookLibrary.layout(files) : { parts: [], chapters: [] };
    const state = extra.states.get(book.id);

    // More by the first author, from what this profile can see
    const authorId = extra.authors.get(book.id)?.[0]?.personId;
    const otherIds = authorId ? (await Credit.findAll({ where: { personId: authorId, kind: "author", itemId: { [Op.ne]: book.id } }, attributes: ["itemId"] })).map((cr) => cr.itemId) : [];
    const others = otherIds.length ? await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { id: otherIds }] }, order: [["year", "ASC"], ["sortTitle", "ASC"]], limit: ROW_SIZE }) : [];

    const detail: BookDetail = {
      ...BookSummaries.summary(book, extra),
      description: book.overview,
      genres: book.genres,
      publisher: book.studios[0] ?? null,
      authorCredits: extra.authors.get(book.id) ?? [],
      narratorCredits: extra.narrators.get(book.id) ?? [],
      parts,
      chapters,
      position: book.type === "audiobook" && state && !state.watched ? state.position : 0,
      bookmark: book.type === "book" && state && !state.watched ? state.bookmark : null,
      moreByAuthor: await BookSummaries.build(others, user),
    };
    return c.json(detail);
  });

  /**
   * @swagger
   * /api/books/{id}/progress:
   *   put:
   *     summary: Save where the profile is (`BookProgressRequest`), or mark the book finished or not.
   */
  router.put("/:id/progress", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const book = await visibleBook(user, Number(c.req.param("id")));
    if (!book) return c.json({ message: "That book doesn't exist." }, 404);
    const body = await readJson<BookProgressRequest>(c) ?? {};
    const finished = typeof body.finished === "boolean" ? body.finished : undefined;
    if (book.type === "audiobook") {
      const files = await MediaFile.findAll({ where: { itemId: book.id }, attributes: ["duration"] });
      const duration = files.reduce((sum, f) => sum + (f.duration ?? 0), 0);
      const position = typeof body.position === "number" && Number.isFinite(body.position) ? body.position : undefined;
      // Within half a minute of the end counts as finished
      const done = finished ?? (position !== undefined && duration > 0 && position >= duration - 30 ? true : undefined);
      await WatchState.saveBookProgress(user.id, book.id, { position, duration, finished: done });
      if (position !== undefined) PlayLog.tick(user.id, book.id, true);
    }
    else {
      const progress = typeof body.progress === "number" && Number.isFinite(body.progress) ? Math.max(0, Math.min(1, body.progress)) : undefined;
      const bookmark = typeof body.bookmark === "string" ? body.bookmark.slice(0, 500) : body.bookmark === null ? null : undefined;
      await WatchState.saveBookProgress(user.id, book.id, { position: progress, duration: 1, bookmark, finished: finished ?? (progress !== undefined && progress >= 0.995 ? true : undefined) });
      if (progress !== undefined) PlayLog.tick(user.id, book.id, true, { book: true });
    }
    return c.body(null, 204);
  });

  /**
   * @swagger
   * /api/books/{id}/parts/{fileId}/stream:
   *   post:
   *     summary: A URL to play one file of an audiobook, like `/api/music/tracks/{id}/stream`.
   */
  router.post("/:id/parts/:fileId/stream", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const book = await visibleBook(user, Number(c.req.param("id")));
    const file = book ? await MediaFile.findOne({ where: { id: Number(c.req.param("fileId")), itemId: book.id } }) : null;
    if (!book || !file) return c.json({ message: "That part of the audiobook doesn't exist." }, 404);
    const body = await readJson<TrackStreamRequest>(c);
    const formats = (Array.isArray(body?.formats) ? body.formats : ["mp3", "aac"]).filter((f): f is AudioFormat => AUDIO_FORMATS.includes(f as AudioFormat));
    const direct = AudioStream.canPlayDirect(file, formats);
    if (!direct) {
      try {
        await AudioStream.converted(file);
      } catch (error) {
        return c.json({ message: errorMessage(error) }, 500);
      }
    }
    const token = StreamGrants.grant(file.id, user.id);
    const stream: TrackStream = { url: `/api/music/stream/${token}${direct ? "" : "?converted=1"}`, direct, duration: file.duration ?? 0 };
    return c.json(stream);
  });

  /**
   * @swagger
   * /api/books/{id}/read:
   *   get:
   *     summary: How to open a book for reading (`BookReading`): an EPUB's chapters, or the PDF's address.
   */
  router.get("/:id/read", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const book = await visibleBook(user, Number(c.req.param("id")));
    const file = book?.type === "book" ? await MediaFile.findOne({ where: { itemId: book.id } }) : null;
    if (!book || !file) return c.json({ message: "That book doesn't exist." }, 404);
    const token = StreamGrants.grant(file.id, user.id);
    if (file.container === "pdf") {
      const reading: BookReading = { format: "pdf", url: `/api/books/content/${token}/${encodeURIComponent(Path.basename(file.path))}` };
      return c.json(reading);
    }
    try {
      const details = Epub.details(await Epub.open(file.path, `${file.id}-${file.mtime}`));
      if (details.chapters.length === 0) return c.json({ message: "This EPUB has no chapters to show." }, 422);
      const reading: BookReading = { format: "epub", base: `/api/books/content/${token}/`, chapters: details.chapters };
      return c.json(reading);
    } catch (error) {
      return c.json({ message: `This book can't be opened: ${errorMessage(error)}` }, 422);
    }
  });

  /**
   * @swagger
   * /api/books/content/{token}/{path}:
   *   get:
   *     summary: A file inside an EPUB (chapters, pictures, styles), or the PDF itself. Scripts in books never run.
   */
  router.get("/content/:token/*", async (c) => {
    const g = StreamGrants.use(c.req.param("token"));
    const file = g ? await MediaFile.findByPk(g.fileId) : null;
    if (!file) return c.json({ message: "This book link has expired. Open the book again." }, 404);
    // Books are someone else's files: no scripts, no plugins, no being framed by other sites
    c.header("Content-Security-Policy", "script-src 'none'; object-src 'none'; frame-ancestors 'self'");
    c.header("X-Content-Type-Options", "nosniff");
    if (file.container === "pdf") {
      const response = await sendFile(c, file.path, "application/pdf");
      return response ?? c.json({ message: "The book file can't be found on disk." }, 404);
    }
    const prefix = `/api/books/content/${c.req.param("token")}/`;
    const inner = decodeURIComponent(c.req.path.slice(c.req.path.indexOf(prefix) + prefix.length));
    const path = Path.posix.normalize(inner).replace(/^\/+/, "");
    if (path.startsWith("..")) return c.json({ message: "That file isn't in this book." }, 404);
    try {
      const files = await Epub.open(file.path, `${file.id}-${file.mtime}`);
      const bytes = files[path];
      if (!bytes) return c.json({ message: "That file isn't in this book." }, 404);
      return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { "Content-Type": Epub.contentType(path), "Cache-Control": "private, max-age=3600" });
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 500);
    }
  });
}

export default BooksController;
