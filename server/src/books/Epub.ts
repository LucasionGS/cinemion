import fsp from "node:fs/promises";
import Path from "node:path";
import { unzipSync } from "fflate";

/**
 * Reads EPUB files: their details and cover for the library, and the files inside for the reader.
 * EPUBs are zip files; the package file (OPF) lists the details, the files and the reading order.
 */
export namespace Epub {
  export interface Details {
    title: string | null;
    authors: string[];
    description: string | null;
    publisher: string | null;
    year: number | null;
    subjects: string[];
    language: string | null;
    /**
     * Path of the cover picture inside the zip. `null` = none.
     */
    cover: string | null;
    /**
     * The reading order: paths inside the zip, with a title from the table of contents where it has one.
     */
    chapters: { href: string; title: string | null }[];
  }

  interface Opened {
    key: string;
    files: Record<string, Uint8Array>;
  }

  // The last few opened books stay unzipped, since the reader asks for a chapter's pictures and styles one by one
  const CACHE_SIZE = 3;
  const _cache: Opened[] = [];

  /**
   * Every file inside the EPUB at `path`, unzipped.
   * @param key Identifies this version of the file, so a changed file is opened again.
   * @throws When the file isn't a zip.
   */
  export async function open(path: string, key: string) {
    const cached = _cache.find((c) => c.key === key);
    if (cached) return cached.files;
    const files = unzipSync(new Uint8Array(await fsp.readFile(path)));
    _cache.unshift({ key, files });
    _cache.splice(CACHE_SIZE);
    return files;
  }

  const decoder = new TextDecoder();

  function text(files: Record<string, Uint8Array>, path: string) {
    const bytes = files[path];
    return bytes ? decoder.decode(bytes) : null;
  }

  function decodeEntities(value: string) {
    return value
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&amp;/g, "&");
  }

  /**
   * Text of an XML element with entities decoded and tags (like in an HTML description) removed.
   * Descriptions are often HTML written out as text (`&lt;p&gt;`), so entities are decoded before and after the
   * tags go.
   */
  export function plain(value: string) {
    const html = decodeEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
    return decodeEntities(html.replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, ""))
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*/g, "\n\n")
      .trim();
  }

  function attribute(tag: string, name: string) {
    return tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2).find((v) => v !== undefined) ?? null;
  }

  /**
   * Every `<name>` element's attributes (the opening tag) and inner text.
   */
  function elements(xml: string, name: string) {
    const pattern = new RegExp(`<(?:[\\w-]+:)?${name}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`, "gi");
    return [...xml.matchAll(pattern)].map((m) => ({ tag: m[1] ?? "", inner: m[2] ?? "" }));
  }

  /**
   * Resolve `href` (relative to the file at `from`) to a path inside the zip.
   */
  function resolve(from: string, href: string) {
    const clean = decodeURIComponent(href.split("#")[0]);
    return Path.posix.normalize(Path.posix.join(Path.posix.dirname(from), clean)).replace(/^\.\//, "");
  }

  /**
   * The details, cover and reading order of an opened EPUB.
   * @throws When it has no package file, so it isn't really an EPUB.
   */
  export function details(files: Record<string, Uint8Array>): Details {
    const container = text(files, "META-INF/container.xml");
    const opfPath = container ? attribute(elements(container, "rootfile")[0]?.tag ?? "", "full-path") : Object.keys(files).find((f) => f.endsWith(".opf")) ?? null;
    const opf = opfPath ? text(files, opfPath) : null;
    if (!opfPath || !opf) throw new Error("This EPUB has no package file, so it can't be read.");

    const metadata = opf.match(/<(?:\w+:)?metadata[\s\S]*?<\/(?:\w+:)?metadata>/i)?.[0] ?? opf;
    const first = (name: string) => {
      const found = elements(metadata, name)[0];
      return found ? plain(found.inner) || null : null;
    };

    // Manifest: id → item
    const manifest = new Map<string, { href: string; type: string; properties: string }>();
    for (const item of elements(opf, "item")) {
      const id = attribute(item.tag, "id");
      const href = attribute(item.tag, "href");
      if (id && href) manifest.set(id, { href: resolve(opfPath, href), type: attribute(item.tag, "media-type") ?? "", properties: attribute(item.tag, "properties") ?? "" });
    }

    // Cover: EPUB 3 marks the picture, EPUB 2 points to it from a meta tag
    const metaCover = elements(metadata, "meta").map((m) => m.tag).find((t) => attribute(t, "name") === "cover");
    const coverId = metaCover ? attribute(metaCover, "content") : null;
    const items = [...manifest.values()];
    const cover = items.find((i) => i.properties.split(/\s+/).includes("cover-image"))?.href
      ?? (coverId ? manifest.get(coverId)?.href : null)
      ?? items.find((i) => i.type.startsWith("image/") && /cover/i.test(i.href))?.href
      ?? null;

    // Chapter titles from the EPUB 3 navigation document or the EPUB 2 NCX
    const titles = new Map<string, string>();
    const nav = items.find((i) => i.properties.split(/\s+/).includes("nav"));
    const navText = nav ? text(files, nav.href) : null;
    if (navText) {
      for (const link of elements(navText, "a")) {
        const href = attribute(link.tag, "href");
        const title = plain(link.inner);
        if (href && title) {
          const target = resolve(nav!.href, href);
          if (!titles.has(target)) titles.set(target, title);
        }
      }
    }
    const ncx = items.find((i) => i.type === "application/x-dtbncx+xml");
    const ncxText = ncx ? text(files, ncx.href) : null;
    if (ncxText) {
      for (const point of elements(ncxText, "navPoint")) {
        const src = attribute(elements(point.inner, "content")[0]?.tag ?? "", "src");
        const title = plain(elements(point.inner, "text")[0]?.inner ?? "");
        if (src && title) {
          const target = resolve(ncx!.href, src);
          if (!titles.has(target)) titles.set(target, title);
        }
      }
    }

    const chapters = elements(opf, "itemref")
      .filter((ref) => attribute(ref.tag, "linear") !== "no")
      .map((ref) => manifest.get(attribute(ref.tag, "idref") ?? ""))
      .filter((item): item is { href: string; type: string; properties: string } => !!item && /html/.test(item.type))
      .map((item) => ({ href: item.href, title: titles.get(item.href) ?? null }));

    const authors = elements(metadata, "creator")
      // Only authors when roles are given; editors and illustrators aren't
      .filter((c) => !attribute(c.tag, "opf:role") || attribute(c.tag, "opf:role") === "aut")
      .map((c) => plain(c.inner))
      .filter(Boolean);

    return {
      title: first("title"),
      authors: [...new Set(authors)],
      description: first("description"),
      publisher: first("publisher"),
      year: Number(first("date")?.match(/\d{4}/)?.[0]) || null,
      subjects: [...new Set(elements(metadata, "subject").map((s) => plain(s.inner)).filter(Boolean))].slice(0, 6),
      language: first("language"),
      cover,
      chapters,
    };
  }

  const CONTENT_TYPES: Record<string, string> = {
    ".xhtml": "application/xhtml+xml",
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };

  export function contentType(path: string) {
    return CONTENT_TYPES[Path.extname(path).toLowerCase()] ?? "application/octet-stream";
  }
}

export default Epub;
