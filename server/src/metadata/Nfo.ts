import fsp from "node:fs/promises";
import Path from "node:path";
import type MetadataProvider from "./MetadataProvider.ts";

/**
 * Reads the NFO files that media managers write next to videos (`movie.nfo`, `tvshow.nfo`, `<episode>.nfo`).
 * They're simple XML, so a few patterns cover what Cinemion needs.
 */
export namespace Nfo {
  const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

  function decode(text: string) {
    return text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
        if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
        if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1)));
        return ENTITIES[entity.toLowerCase()] ?? match;
      })
      .trim();
  }

  /**
   * All text values of `<tag>` directly or deeper inside `xml`.
   */
  function all(xml: string, tag: string) {
    const results: string[] = [];
    const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
    for (const match of xml.matchAll(pattern)) results.push(decode(match[1]));
    return results.filter(Boolean);
  }

  function first(xml: string, tag: string) {
    return all(xml, tag)[0] ?? null;
  }

  function blocks(xml: string, tag: string) {
    return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) => m[1]);
  }

  /**
   * Turn a thumb value into an image source: URLs are downloaded, relative paths are next to the NFO.
   */
  function imageSource(value: string | null, nfoFolder: string) {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return { url: value };
    return { file: Path.isAbsolute(value) ? value : Path.join(nfoFolder, value) };
  }

  /**
   * Parse NFO XML into metadata. `null` when it isn't XML (some NFOs only hold a URL).
   */
  export function parse(xml: string, nfoPath: string): MetadataProvider.ItemMetadata | null {
    if (!/<(movie|tvshow|episodedetails|season)[\s>]/i.test(xml)) return null;
    const folder = Path.dirname(nfoPath);
    // Only the main document; nested <episodedetails> after the first are other episodes in the same file
    const body = xml.match(/<(movie|tvshow|episodedetails|season)[\s>][\s\S]*?<\/\1>/i)?.[0] ?? xml;

    const ids: Record<string, string> = {};
    for (const match of body.matchAll(/<uniqueid\s+([^>]*)>([\s\S]*?)<\/uniqueid>/gi)) {
      const type = /type\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1]?.toLowerCase();
      if (type && ["tmdb", "imdb", "tvdb"].includes(type)) ids[type] = decode(match[2]);
    }
    const tmdbId = first(body, "tmdbid");
    const imdbId = first(body, "imdbid") ?? first(body, "imdb_id");
    if (tmdbId && !ids.tmdb) ids.tmdb = tmdbId;
    if (imdbId && !ids.imdb) ids.imdb = imdbId;
    const plainId = first(body, "id");
    if (plainId && /^tt\d+$/.test(plainId) && !ids.imdb) ids.imdb = plainId;

    const ratingValue = first(body, "rating") ?? blocks(body, "rating").map((r) => first(r, "value")).find(Boolean) ?? null;
    const rating = ratingValue ? parseFloat(ratingValue) : null;
    const released = first(body, "premiered") ?? first(body, "aired") ?? first(body, "releasedate");
    const year = first(body, "year");
    const runtime = first(body, "runtime");
    const mpaa = first(body, "mpaa")?.replace(/^(rated\s+|[a-z]{2}:)/i, "").trim() || null;

    const credits: MetadataProvider.CreditMetadata[] = [];
    blocks(body, "actor").forEach((actor, i) => {
      const name = first(actor, "name");
      if (!name) return;
      const order = first(actor, "order");
      credits.push({ name, kind: "cast", character: first(actor, "role"), order: order ? parseInt(order) : i, photo: imageSource(first(actor, "thumb"), folder) });
    });
    all(body, "director").forEach((name, i) => credits.push({ name, kind: "director", order: i }));
    all(body, "credits").forEach((name, i) => credits.push({ name, kind: "writer", order: i }));

    // <set><name>Trilogy</name></set>, or the older <set>Trilogy</set>
    const setBlock = blocks(body, "set")[0];
    const setName = setBlock ? (first(setBlock, "name") ?? decode(setBlock)) : null;

    return {
      collection: setName && !setName.includes("<") ? { name: setName, overview: setBlock ? first(setBlock, "overview") : null } : null,
      title: first(body, "title"),
      originalTitle: first(body, "originaltitle"),
      year: year ? parseInt(year) : released ? parseInt(released.slice(0, 4)) : null,
      overview: first(body, "plot") ?? first(body, "outline"),
      tagline: first(body, "tagline"),
      runtime: runtime ? parseInt(runtime) : null,
      releaseDate: released && /^\d{4}-\d{2}-\d{2}/.test(released) ? released.slice(0, 10) : null,
      rating: rating !== null && Number.isFinite(rating) ? rating : null,
      contentRating: mpaa,
      genres: all(body, "genre").flatMap((g) => g.split(/\s*\/\s*/)),
      studios: all(body, "studio"),
      ids,
      credits,
    };
  }

  /**
   * Read and parse the first NFO in `paths` that exists.
   */
  export async function readFirst(paths: string[]) {
    for (const path of paths) {
      const xml = await fsp.readFile(path, "utf8").catch(() => null);
      if (xml === null) continue;
      const parsed = parse(xml, path);
      if (parsed) return parsed;
    }
    return null;
  }
}

export default Nfo;
