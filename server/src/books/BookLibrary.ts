import fsp from "node:fs/promises";
import Path from "node:path";
import { Op } from "sequelize";
import type { AudiobookPart, BookChapter } from "@shared/books.ts";
import { Credit, type Library, MediaFile, MediaItem, Person, PlaylistItem } from "../models/index.ts";
import { EMPTY_ARTWORK } from "../models/MediaItem.ts";
import AppSystem from "../AppSystem.ts";
import ImageCache from "../images/ImageCache.ts";
import Palette from "../images/Palette.ts";
import Ffmpeg from "../lib/Ffmpeg.ts";
import type Tasks from "../lib/Tasks.ts";
import log from "../lib/Logger.ts";
import MusicTags from "../music/MusicTags.ts";
import MusicLibrary from "../music/MusicLibrary.ts";
import Epub from "./Epub.ts";

/**
 * Keeps Audiobooks and Books libraries in step with their files. An audiobook is a folder of audio files (parts
 * in `CD1`, `CD2`… folders count as one book) or one file in the library folder itself, like an `.m4b`. A book is
 * one EPUB or PDF. Details come from tags and the EPUB package file; nothing is looked up online.
 */
export namespace BookLibrary {
  export const EBOOK_EXTENSIONS = new Set([".epub", ".pdf"]);
  // Folders that hold a part of a book, not a book of their own
  const PART_FOLDER = /^(cd|disc|disk|part|teil|deel)\s*\d+$/i;
  // Genres taggers put on every audiobook, which say nothing
  const NOISE_GENRES = /^(audio ?books?|h[öo]rb[üu]ch(er)?|luisterboek|spoken word|speech)$/i;

  export function isEbook(path: string) {
    return EBOOK_EXTENSIONS.has(Path.extname(path).toLowerCase());
  }

  /**
   * The folder (or file) that makes up the audiobook `path` belongs to.
   */
  function bookKey(path: string, root: string) {
    let dir = Path.dirname(path);
    if (Path.resolve(dir) === Path.resolve(root)) return path;
    if (PART_FOLDER.test(Path.basename(dir)) && Path.resolve(Path.dirname(dir)) !== Path.resolve(root)) dir = Path.dirname(dir);
    return dir;
  }

  /**
   * Names in one tag, like "Terry Pratchett & Neil Gaiman" or "A; B". Commas stay, for "Pratchett, Terry".
   */
  function names(value: string | undefined | null) {
    if (!value) return [];
    return [...new Set(value.split(/\s*(?:;|&|\/| and )\s*/).map((n) => n.trim()).filter(Boolean))].slice(0, 6);
  }

  /**
   * A folder or file name as a title: no year, no "Author - " in front, no extension.
   */
  function titleFromName(name: string, author: string | null) {
    let title = name.replace(/\.(m4b|m4a|mp3|epub|pdf|flac|ogg|opus)$/i, "").replace(/_/g, " ");
    title = title.replace(/\s*[([]\d{4}[)\]]\s*$/, "").trim();
    if (author && title.toLowerCase().startsWith(`${author.toLowerCase()} - `)) title = title.slice(author.length + 3);
    return title.trim() || name;
  }

  /**
   * The author and title in a name like "Terry Pratchett - Mort", when it has both.
   */
  function splitName(name: string) {
    const match = name.replace(/\.[a-z0-9]{2,4}$/i, "").match(/^(.+?) - (.+)$/);
    return match ? { author: match[1].trim(), title: match[2].trim() } : null;
  }

  /**
   * Files in playing order: disc, track number, then the file name with numbers sorted as numbers.
   */
  export function orderFiles(files: MediaFile[]) {
    const disc = (f: MediaFile) => MusicTags.leadingNumber(f.tags?.disc) ?? 1;
    const track = (f: MediaFile) => MusicTags.leadingNumber(f.tags?.track) ?? 0;
    return [...files].sort((a, b) => disc(a) - disc(b) || track(a) - track(b) || a.path.localeCompare(b.path, undefined, { numeric: true }));
  }

  /**
   * An audiobook's files as parts, and its chapters: from the files' own chapter marks, or one per file.
   */
  export function layout(files: MediaFile[]): { parts: AudiobookPart[]; chapters: BookChapter[] } {
    const parts: AudiobookPart[] = [];
    const chapters: BookChapter[] = [];
    let offset = 0;
    for (const file of orderFiles(files)) {
      const duration = file.duration ?? 0;
      const title = file.tags?.title || MusicTags.titleFromFile(file.path);
      parts.push({ fileId: file.id, title, offset, duration });
      if (file.chapters?.length) {
        for (const chapter of file.chapters) {
          chapters.push({ title: chapter.title ?? `Chapter ${chapters.length + 1}`, start: offset + chapter.start, end: offset + Math.min(chapter.end, duration || chapter.end) });
        }
      }
      else {
        chapters.push({ title, start: offset, end: offset + duration });
      }
      offset += duration;
    }
    return { parts, chapters };
  }

  /**
   * Sort new files into audiobooks or books. Returns the new ones.
   * @param roots The library folder each file was found in.
   */
  export async function assign(library: Library, roots: Map<string, string>) {
    const added: number[] = [];
    const audio = library.type === "audiobooks";
    const known = new Map((await MediaItem.findAll({ where: { libraryId: library.id, type: audio ? "audiobook" : "book" } })).map((b) => [b.folderPath!, b]));
    for (const file of await MediaFile.findAll({ where: { libraryId: library.id, itemId: null }, order: [["path", "ASC"]] })) {
      const root = roots.get(file.path) ?? library.paths.find((p) => file.path.startsWith(p)) ?? library.paths[0];
      const key = audio ? bookKey(file.path, root) : file.path;
      let book = known.get(key);
      if (!book) {
        book = MediaItem.build({ libraryId: library.id, type: audio ? "audiobook" : "book", folderPath: key, title: "", sortTitle: "", matchStatus: "matched", ageRating: library.defaultAge() });
        book.setTitle(titleFromName(Path.basename(key), null));
        await book.save();
        known.set(key, book);
        added.push(book.id);
      }
      else if (audio) {
        // A new part: details and chapters are worked out again
        book.metadataUpdatedAt = null;
        await book.save();
      }
      await file.update({ itemId: book.id });
    }
    return added;
  }

  /**
   * Remove books whose files are all gone.
   */
  export async function removeEmpty(library: Library) {
    const withFiles = new Set((await MediaFile.findAll({ where: { libraryId: library.id, itemId: { [Op.ne]: null } }, attributes: ["itemId"] })).map((f) => f.itemId!));
    const books = await MediaItem.findAll({ where: { libraryId: library.id, type: ["audiobook", "book"] }, attributes: ["id"] });
    const orphans = books.filter((b) => !withFiles.has(b.id)).map((b) => b.id);
    if (orphans.length) {
      await Credit.destroy({ where: { itemId: orphans } });
      await PlaylistItem.destroy({ where: { itemId: orphans } });
      await MediaItem.destroy({ where: { id: orphans } });
    }
  }

  async function setCover(book: MediaItem, key: string | null) {
    book.artwork = { ...EMPTY_ARTWORK, poster: key, thumb: key };
    book.palette = key ? await Palette.fromImage(key) : null;
  }

  /**
   * Replace the book's authors and narrators.
   */
  async function setPeople(book: MediaItem, authors: string[], narrators: string[]) {
    await Credit.destroy({ where: { itemId: book.id, kind: ["author", "narrator"] } });
    let order = 0;
    for (const [kind, list] of [["author", authors], ["narrator", narrators]] as const) {
      for (const name of list) {
        const person = await Person.findOrCreatePerson({ name, tmdbId: null, photo: null });
        await Credit.create({ itemId: book.id, personId: person.id, kind, order: order++ });
      }
    }
  }

  /**
   * Details of an audiobook from its files' tags, its folder and a cover picture.
   */
  async function refreshAudiobook(book: MediaItem, library: Library) {
    const files = orderFiles(await MediaFile.findAll({ where: { itemId: book.id } }));
    if (files.length === 0) return;
    const tags = files[0].tags ?? {};
    const single = files.length === 1 && Path.resolve(files[0].path) === Path.resolve(book.folderPath!);
    const folder = files.length > 1 || Path.resolve(Path.dirname(files[0].path)) !== Path.resolve(book.folderPath!) ? book.folderPath! : Path.dirname(files[0].path);
    const root = library.paths.find((p) => book.folderPath!.startsWith(p)) ?? null;
    const parent = Path.dirname(book.folderPath!);
    // Author/Book/files: the folder above names the author
    const folderAuthor = root && Path.resolve(parent) !== Path.resolve(root) && Path.resolve(book.folderPath!) !== Path.resolve(files[0].path) ? Path.basename(parent) : null;

    const split = single && !folderAuthor ? splitName(Path.basename(files[0].path)) : null;
    const authors = names(tags.album_artist || tags.artist || tags.author || folderAuthor || split?.author);
    const narrators = names(tags.narrator || tags.composer || tags.performer).filter((n) => !authors.includes(n));
    const title = tags.album || (single ? tags.title : null) || split?.title || titleFromName(Path.basename(book.folderPath!), authors[0] ?? null);

    // Descriptions are long, so they're read from the file here rather than kept with the tags
    const probe = await Ffmpeg.probe(files[0].path).catch(() => null);
    const raw: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...probe?.format.tags, ...probe?.streams.find((s) => s.codec_type === "audio")?.tags })) raw[key.toLowerCase()] = value;
    const description = raw.description || raw.synopsis || raw.comment || raw.desc
      || await fsp.readFile(Path.join(folder, "desc.txt"), "utf8").catch(() => null)
      || await fsp.readFile(Path.join(folder, "description.txt"), "utf8").catch(() => null);

    book.setTitle(title);
    book.year = MusicTags.leadingNumber(tags.date?.match(/\d{4}/)?.[0]) ?? MusicTags.leadingNumber(tags.year);
    book.overview = description ? Epub.plain(description).slice(0, 5000) : null;
    book.genres = (tags.genre ?? "").split(/[;/]/).map((g) => g.trim()).filter((g) => g && !NOISE_GENRES.test(g)).slice(0, 6);
    book.studios = tags.publisher || tags.label ? [tags.publisher || tags.label] : [];
    const total = files.reduce((sum, f) => sum + (f.duration ?? 0), 0);
    book.runtime = total ? Math.max(1, Math.round(total / 60)) : null;
    if (!book.customArtwork) {
      const picture = await MusicLibrary.folderImage(folder, MusicLibrary.COVER_NAMES);
      await setCover(book, picture ? await ImageCache.store({ file: picture }) : await MusicLibrary.embeddedCover(files[0].path));
    }
    await setPeople(book, authors, narrators);
  }

  /**
   * The first page of a PDF as its cover, when poppler's `pdftoppm` is installed. `null` otherwise.
   */
  async function pdfCover(path: string) {
    const base = Path.join(AppSystem.tempDir, `pdf-cover-${crypto.randomUUID()}`);
    try {
      const result = await new Deno.Command("pdftoppm", { args: ["-jpeg", "-f", "1", "-l", "1", "-scale-to", "900", "-singlefile", path, base], stdout: "null", stderr: "null" }).output();
      return result.success ? await ImageCache.store({ file: `${base}.jpg` }) : null;
    } catch {
      // pdftoppm isn't installed
      return null;
    } finally {
      await fsp.rm(`${base}.jpg`, { force: true });
    }
  }

  /**
   * Details of a book from its EPUB package file, or its name and folder for PDFs.
   */
  async function refreshBook(book: MediaItem, library: Library) {
    const file = await MediaFile.findOne({ where: { itemId: book.id } });
    if (!file) return;
    const root = library.paths.find((p) => file.path.startsWith(p)) ?? null;
    const parent = Path.dirname(file.path);
    const folderAuthor = root && Path.resolve(parent) !== Path.resolve(root) ? Path.basename(parent) : null;

    const split = folderAuthor ? null : splitName(Path.basename(file.path));
    if (Path.extname(file.path).toLowerCase() === ".pdf") {
      book.setTitle(split?.title ?? titleFromName(Path.basename(file.path), folderAuthor));
      await setPeople(book, names(folderAuthor ?? split?.author), []);
      if (!book.customArtwork) {
        const picture = await MusicLibrary.folderImage(parent, [Path.basename(file.path, Path.extname(file.path)).toLowerCase(), "cover"]);
        await setCover(book, picture ? await ImageCache.store({ file: picture }) : await pdfCover(file.path));
      }
      return;
    }

    const files = await Epub.open(file.path, `${file.id}-${file.mtime}`);
    const details = Epub.details(files);
    book.setTitle(details.title || split?.title || titleFromName(Path.basename(file.path), folderAuthor));
    book.year = details.year;
    book.overview = details.description?.slice(0, 5000) ?? null;
    book.genres = details.subjects;
    book.studios = details.publisher ? [details.publisher] : [];
    if (!book.customArtwork) {
      let key: string | null = null;
      const bytes = details.cover ? files[details.cover] : null;
      if (bytes) {
        const temp = Path.join(AppSystem.tempDir, `book-cover-${crypto.randomUUID()}${Path.extname(details.cover!)}`);
        try {
          await fsp.writeFile(temp, bytes);
          key = await ImageCache.store({ file: temp });
        } finally {
          await fsp.rm(temp, { force: true });
        }
      }
      await setCover(book, key);
    }
    await setPeople(book, details.authors.length ? details.authors : names(folderAuthor ?? split?.author), []);
  }

  /**
   * Details for new books (or all of them, when asked).
   * @returns How many were looked at.
   */
  export async function refresh(library: Library, task: Tasks.Handle, opts?: { regenerate?: boolean }) {
    opts ??= {};
    const type = library.type === "audiobooks" ? "audiobook" : "book";
    const books = await MediaItem.findAll({ where: { libraryId: library.id, type, ...(opts.regenerate ? {} : { metadataUpdatedAt: null }) } });
    for (const [i, book] of books.entries()) {
      task.update("Reading book details", i / books.length);
      try {
        if (type === "audiobook") await refreshAudiobook(book, library);
        else await refreshBook(book, library);
        book.metadataUpdatedAt = new Date();
        book.ageRating = library.defaultAge();
        await book.save();
      } catch (error) {
        log.warn(`Could not read the details of "${book.title}"`, { error });
      }
    }
    return books.length;
  }
}

export default BookLibrary;
