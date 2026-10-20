import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import type { BookDetail, BookReading } from "@shared/books.ts";
import BooksApi from "../../Api/BooksApi.ts";
import { router } from "../../lib/Router.tsx";
import { themes } from "../../lib/Theme.ts";
import { toasts } from "../../lib/Toasts.ts";
import cx from "../../lib/cx.ts";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import Select from "../../components/Select/Select.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import "./Books.scss";

type ReaderTheme = "light" | "sepia" | "dark";

interface ReaderPrefs {
  /**
   * Text size, in percent.
   */
  size: number;
  /**
   * `null` = follow the app's theme.
   */
  theme: ReaderTheme | null;
}

// Reading colours: ground, text, links and lines
const THEMES: Record<ReaderTheme, { bg: string; fg: string; link: string; line: string; label: string }> = {
  light: { bg: "#FBFAF7", fg: "#1D1D1F", link: "#1D5FC4", line: "rgba(0, 0, 0, 0.1)", label: "Light" },
  sepia: { bg: "#F4ECD8", fg: "#4E3B2A", link: "#8A4B14", line: "rgba(78, 59, 42, 0.18)", label: "Sepia" },
  dark: { bg: "#121316", fg: "#D8D8DA", link: "#A9CBFF", line: "rgba(255, 255, 255, 0.1)", label: "Dark" },
};
const PREFS_KEY = "cn-reader";
const SIZES = [80, 90, 100, 110, 125, 140, 160, 180];

function loadPrefs(): ReaderPrefs {
  try {
    return { size: 100, theme: null, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return { size: 100, theme: null };
  }
}

/**
 * Where a bookmark like "4:0.35" points: chapter 4, 35% down.
 */
function parseBookmark(bookmark: string | null) {
  const [chapter, fraction] = (bookmark ?? "0:0").split(":").map(Number);
  return { chapter: Number.isInteger(chapter) && chapter >= 0 ? chapter : 0, fraction: Number.isFinite(fraction) ? fraction : 0 };
}

export interface ReaderProps {
  id: number;
}

/**
 * Reading a book. EPUB chapters are the book's own pages in a frame where scripts never run, with this page's text
 * size and colours laid over them; the place is saved as you scroll. PDFs open in the browser's own viewer.
 */
export default function Reader(props: ReaderProps) {
  const { id } = props;
  const [book, setBook] = useState<BookDetail | null>(null);
  const [reading, setReading] = useState<BookReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chapter, setChapter] = useState(0);
  const [fraction, setFraction] = useState(0);
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadPrefs);
  const frame = useRef<HTMLIFrameElement>(null);
  // Where to scroll once a chapter has loaded: the bookmark at first, the top or bottom when turning chapters
  const restore = useRef(0);
  const lastSave = useRef(0);
  const themeName = prefs.theme ?? (themes.theme === "light" ? "light" : "dark");
  const theme = THEMES[themeName];

  useEffect(() => {
    Promise.all([BooksApi.get(id), BooksApi.read(id)]).then(([detail, open]) => {
      const mark = parseBookmark(detail.bookmark);
      const chapters = open.format === "epub" ? open.chapters.length : 1;
      setChapter(Math.min(mark.chapter, chapters - 1));
      restore.current = mark.fraction;
      setBook(detail);
      setReading(open);
    }).catch((e) => setError((e as Error).message));
  }, [id]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // The choice lasts until the page closes
    }
  }, [prefs]);

  const chapters = reading?.format === "epub" ? reading.chapters : [];
  const progress = chapters.length ? (chapter + fraction) / chapters.length : 0;

  /**
   * Save the place now or soon. Scrolling saves at most every few seconds.
   */
  const save = useCallback((index: number, f: number, now = false) => {
    if (!chapters.length) return;
    if (!now && Date.now() - lastSave.current < 4000) return;
    lastSave.current = Date.now();
    const data = { bookmark: `${index}:${f.toFixed(4)}`, progress: (index + f) / chapters.length };
    if (now) BooksApi.progressOnLeave(id, data);
    else BooksApi.progress(id, data).catch(() => { });
  }, [chapters.length, id]);

  // Saved when leaving, too
  const latest = useRef({ chapter, fraction });
  latest.current = { chapter, fraction };
  useEffect(() => {
    const leave = () => save(latest.current.chapter, latest.current.fraction, true);
    addEventListener("pagehide", leave);
    return () => {
      removeEventListener("pagehide", leave);
      leave();
    };
  }, [save]);

  function goTo(index: number, at: "top" | "bottom" = "top") {
    if (index < 0 || index >= chapters.length) return;
    restore.current = at === "top" ? 0 : 1;
    setChapter(index);
    setFraction(at === "top" ? 0 : 1);
    save(index, at === "top" ? 0 : 1, true);
  }

  /**
   * Dress the loaded chapter in the reader's text size and colours, put it at the right place, and follow scrolling.
   */
  function onFrameLoad() {
    const win = frame.current?.contentWindow;
    const doc = frame.current?.contentDocument;
    if (!win || !doc?.documentElement) return;

    // A link inside the book can open another chapter; follow it
    const path = decodeURIComponent(win.location.pathname);
    const linked = chapters.findIndex((c) => reading?.format === "epub" && path.endsWith(`/${c.href}`));
    if (linked >= 0 && linked !== chapter) setChapter(linked);

    applyStyle(doc);
    const scroller = doc.scrollingElement ?? doc.documentElement;
    const max = () => Math.max(0, scroller.scrollHeight - win.innerHeight);
    win.scrollTo(0, restore.current * max());
    restore.current = 0;

    win.addEventListener("scroll", () => {
      const f = max() ? Math.min(1, Math.max(0, win.scrollY / max())) : 1;
      setFraction(f);
      save(linked >= 0 ? linked : chapter, f);
    });
    // Arrow keys inside the book turn chapters, like outside it
    doc.addEventListener("keydown", onKey);
  }

  function applyStyle(doc: Document) {
    doc.getElementById("cn-reader-style")?.remove();
    const style = doc.createElement("style");
    style.id = "cn-reader-style";
    style.textContent = `
      html { background: ${theme.bg} !important; color: ${theme.fg} !important; }
      body {
        max-width: 38em; margin: 0 auto !important; padding: 2.5rem 1.5rem 40vh !important;
        font-size: ${prefs.size}% !important; line-height: 1.65 !important;
        font-family: Charter, "Bitstream Charter", "Iowan Old Style", Georgia, serif;
        background: transparent !important; color: inherit !important;
      }
      img, svg, video { max-width: 100% !important; height: auto !important; }
      a { color: ${theme.link} !important; }
      p, li, h1, h2, h3, h4, span, div { color: inherit !important; }
    `;
    (doc.head ?? doc.documentElement).appendChild(style);
  }

  // Changing the size or colours restyles the open chapter
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (doc?.documentElement && reading?.format === "epub") applyStyle(doc);
  }, [prefs, theme]);

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowRight") goTo(latest.current.chapter + 1);
    else if (e.key === "ArrowLeft") goTo(latest.current.chapter - 1, "bottom");
    else if (e.key === "Escape" || e.key === "GoBack" || e.key === "BrowserBack") router.back(`/book/${id}`);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Remotes have no scroll wheel: up and down move most of a screen
      const win = frame.current?.contentWindow;
      if (!win) return;
      e.preventDefault();
      win.scrollBy({ top: (e.key === "ArrowDown" ? 0.8 : -0.8) * win.innerHeight, behavior: "smooth" });
    }
  }

  useEffect(() => {
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  async function finish() {
    try {
      await BooksApi.progress(id, { finished: true });
      toasts.success("Marked as finished");
      router.back(`/book/${id}`);
    } catch (e) {
      toasts.error("Couldn't save that", (e as Error).message);
    }
  }

  const style = { "--reader-bg": theme.bg, "--reader-fg": theme.fg, "--reader-line": theme.line } as CSSProperties;

  return (
    <div className={cx("cn-reader", themeName === "dark" ? "cn-dark-theme" : "cn-light-theme")} style={style} data-focus-scope>
      <header className="cn-reader__bar">
        <IconButton label="Back" icon={<ArrowLeft />} variant="ghost" onClick={() => router.back(`/book/${id}`)} data-autofocus />
        <div className="cn-reader__title">
          <strong>{book?.title ?? "Loading…"}</strong>
          {chapters[chapter]?.title && <span>{chapters[chapter].title}</span>}
        </div>
        {reading?.format === "epub" && (
          <div className="cn-reader__tools">
            {chapters.length > 1 && (
              <Select
                label="Chapter"
                className="cn-reader__select"
                value={String(chapter)}
                options={chapters.map((c, i) => ({ value: String(i), label: c.title ?? `Chapter ${i + 1}` }))}
                onChange={(e) => goTo(Number(e.target.value))}
              />
            )}
            <IconButton label="Smaller text" icon={<Minus />} variant="ghost" disabled={prefs.size <= SIZES[0]} onClick={() => setPrefs({ ...prefs, size: SIZES[Math.max(0, SIZES.indexOf(prefs.size) - 1)] ?? 100 })} />
            <IconButton label="Bigger text" icon={<Plus />} variant="ghost" disabled={prefs.size >= SIZES[SIZES.length - 1]} onClick={() => setPrefs({ ...prefs, size: SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(prefs.size) + 1)] ?? 100 })} />
            {(Object.keys(THEMES) as ReaderTheme[]).map((key) => (
              <button
                key={key}
                type="button"
                className={cx("cn-reader__theme", themeName === key && "cn-reader__theme--active")}
                style={{ background: THEMES[key].bg }}
                aria-label={`${THEMES[key].label} page`}
                aria-pressed={prefs.theme === key}
                onClick={() => setPrefs({ ...prefs, theme: key })}
              />
            ))}
          </div>
        )}
        {reading?.format === "pdf" && <Button variant="secondary" icon={<Check />} onClick={finish}>Mark as finished</Button>}
      </header>

      {error && <p className="cn-reader__message">{error}</p>}
      {!error && !reading && <div className="cn-reader__message"><Spinner size="2rem" /></div>}
      {reading?.format === "pdf" && <iframe className="cn-reader__frame" src={reading.url} title={book?.title ?? "Book"} />}
      {reading?.format === "epub" && chapters[chapter] && (
        <iframe
          key={chapter}
          ref={frame}
          className="cn-reader__frame"
          src={reading.base + chapters[chapter].href}
          title={book?.title ?? "Book"}
          // Books may carry scripts; without allow-scripts they never run, while this page can still dress the text
          sandbox="allow-same-origin"
          onLoad={onFrameLoad}
        />
      )}

      {reading?.format === "epub" && (
        <footer className="cn-reader__bar cn-reader__bar--bottom">
          <Button variant="ghost" icon={<ChevronLeft />} disabled={chapter === 0} onClick={() => goTo(chapter - 1, "bottom")}>Previous</Button>
          <span className="cn-reader__percent">{Math.round(progress * 100)}%</span>
          {chapter < chapters.length - 1
            ? <Button variant="ghost" onClick={() => goTo(chapter + 1)}>Next <ChevronRight /></Button>
            : <Button variant="ghost" icon={<Check />} onClick={finish}>Finished</Button>}
        </footer>
      )}
    </div>
  );
}
