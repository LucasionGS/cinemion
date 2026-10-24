import type { GameCandidate } from "@shared/clips.ts";
import AppSystem from "../AppSystem.ts";
import ClipNames from "./ClipNames.ts";
import ClipSettings from "./ClipSettings.ts";
import log from "../lib/Logger.ts";

/**
 * Looks games up online for their proper names, descriptions and artwork. Steam's store needs no key and knows most
 * PC games; SteamGridDB (with a free key) also knows games that aren't on Steam, like VALORANT or League of Legends.
 */
export namespace GameInfo {
  export interface Match {
    /**
     * `steam` or `steamgriddb`.
     */
    provider: string;
    id: string;
    title: string;
  }

  export interface Details extends Match {
    overview: string | null;
    genres: string[];
    /**
     * `YYYY-MM-DD`.
     */
    releaseDate: string | null;
    /**
     * Full image URLs, best first. Missing ones are left out.
     */
    covers: string[];
    heroes: string[];
    logos: string[];
  }

  const STEAM_STORE = "https://store.steampowered.com/api";
  const STEAM_CDN = "https://shared.steamstatic.com/store_item_assets/steam/apps";
  const SGDB_API = "https://www.steamgriddb.com/api/v2";
  const TIMEOUT_MS = 15_000;

  // Searches are made once per run of the server; a scan asks about the same names again and again
  const _searches = new Map<string, Promise<SearchResult[]>>();

  interface SearchResult {
    provider: string;
    id: string;
    title: string;
    year: number | null;
    cover: string | null;
  }

  async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const res = await fetch(url, { headers: { "User-Agent": `${AppSystem.APP_NAME}/${AppSystem.VERSION}`, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 401 || res.status === 403) throw new Error("The SteamGridDB key was refused. Check it in Settings › Metadata.");
    if (res.status === 429) throw new Error("Too many game lookups in a short time. Try again in a few minutes.");
    if (!res.ok) throw new Error(`The game lookup failed: ${res.status} ${res.statusText}`);
    return await res.json() as T;
  }

  //#region Steam
  interface SteamSearch {
    items?: { type: string; name: string; id: number }[];
  }

  interface SteamDetails {
    [id: string]: {
      success: boolean;
      data?: {
        type: string;
        name: string;
        short_description?: string;
        genres?: { description: string }[];
        release_date?: { date?: string };
      };
    };
  }

  async function steamSearch(query: string): Promise<SearchResult[]> {
    const data = await fetchJson<SteamSearch>(`${STEAM_STORE}/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`);
    return (data.items ?? []).filter((i) => i.type === "app").map((i) => ({
      provider: "steam",
      id: String(i.id),
      title: ClipNames.cleanGameName(i.name),
      year: null,
      cover: `${STEAM_CDN}/${i.id}/library_600x900.jpg`,
    }));
  }

  /**
   * Steam writes release dates like "5 Dec, 2024" or "Dec 5, 2024".
   */
  function steamDate(text: string | undefined): string | null {
    if (!text) return null;
    const date = new Date(text.replace(",", ""));
    if (isNaN(date.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  async function steamDetails(id: string): Promise<Details | null> {
    const data = await fetchJson<SteamDetails>(`${STEAM_STORE}/appdetails?appids=${encodeURIComponent(id)}&l=english&filters=basic,genres,release_date`);
    const app = data[id]?.success ? data[id].data : null;
    if (!app) return null;
    return {
      provider: "steam",
      id,
      title: ClipNames.cleanGameName(app.name),
      overview: app.short_description ? decodeEntities(app.short_description) : null,
      genres: (app.genres ?? []).map((g) => g.description).filter((g) => g !== "Free to Play" && g !== "Free To Play"),
      releaseDate: steamDate(app.release_date?.date),
      covers: [`${STEAM_CDN}/${id}/library_600x900_2x.jpg`, `${STEAM_CDN}/${id}/library_600x900.jpg`],
      heroes: [`${STEAM_CDN}/${id}/library_hero.jpg`],
      logos: [`${STEAM_CDN}/${id}/logo.png`],
    };
  }

  function decodeEntities(text: string) {
    return text.replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
  }
  //#endregion

  //#region SteamGridDB
  interface SgdbResponse<T> {
    success: boolean;
    data: T;
  }

  interface SgdbGame {
    id: number;
    name: string;
    release_date?: number;
  }

  async function sgdb<T>(path: string, key: string): Promise<T | null> {
    const data = await fetchJson<SgdbResponse<T>>(`${SGDB_API}${path}`, { Authorization: `Bearer ${key}` });
    return data.success ? data.data : null;
  }

  async function sgdbSearch(query: string, key: string): Promise<SearchResult[]> {
    const games = await sgdb<SgdbGame[]>(`/search/autocomplete/${encodeURIComponent(query)}`, key) ?? [];
    return games.map((g) => ({
      provider: "steamgriddb",
      id: String(g.id),
      title: ClipNames.cleanGameName(g.name),
      year: g.release_date ? new Date(g.release_date * 1000).getFullYear() : null,
      cover: null,
    }));
  }

  /**
   * Artwork URLs from SteamGridDB, by its own game id or by a Steam app id.
   */
  async function sgdbArtwork(game: { steam?: string; sgdb?: string }, key: string) {
    const target = game.sgdb ? `game/${game.sgdb}` : `steam/${game.steam}`;
    const urls = async (kind: string, query: string) => {
      const images = await sgdb<{ url: string }[]>(`/${kind}/${target}${query}`, key).catch(() => null);
      return (images ?? []).slice(0, 3).map((i) => i.url);
    };
    return {
      covers: await urls("grids", "?dimensions=600x900,342x482,660x930&types=static"),
      heroes: await urls("heroes", "?types=static"),
      logos: await urls("logos", "?types=static"),
    };
  }

  async function sgdbDetails(id: string, key: string): Promise<Details | null> {
    const game = await sgdb<SgdbGame>(`/games/id/${encodeURIComponent(id)}`, key);
    if (!game) return null;
    const date = game.release_date ? new Date(game.release_date * 1000) : null;
    return {
      provider: "steamgriddb",
      id,
      title: ClipNames.cleanGameName(game.name),
      overview: null,
      genres: [],
      releaseDate: date ? date.toISOString().slice(0, 10) : null,
      ...await sgdbArtwork({ sgdb: id }, key),
    };
  }
  //#endregion

  async function cachedSearch(provider: string, query: string, run: () => Promise<SearchResult[]>) {
    const id = `${provider}:${ClipNames.key(query)}`;
    let pending = _searches.get(id);
    if (!pending) {
      pending = run().catch((error) => {
        // A failed search may work later, so it isn't kept
        _searches.delete(id);
        throw error;
      });
      _searches.set(id, pending);
    }
    return await pending;
  }

  /**
   * Games matching `query` on Steam and (with a key) SteamGridDB, for "Set game".
   * @throws When no lookup worked at all.
   */
  export async function search(query: string): Promise<GameCandidate[]> {
    const name = ClipNames.alias(query) ?? query;
    const key = await ClipSettings.steamGridDbKey();
    const lookups: Promise<SearchResult[]>[] = [cachedSearch("steam", name, () => steamSearch(name))];
    if (key) lookups.push(cachedSearch("steamgriddb", name, () => sgdbSearch(name, key)));
    const settled = await Promise.allSettled(lookups);
    const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    if (failed && settled.every((s) => s.status === "rejected")) throw failed.reason;

    const results: GameCandidate[] = [];
    const seen = new Set<string>();
    for (const result of settled.flatMap((s) => s.status === "fulfilled" ? s.value : [])) {
      // Steam goes first, so a game on both shows once, with Steam's artwork
      const k = ClipNames.key(result.title);
      if (seen.has(k)) continue;
      seen.add(k);
      results.push({ gameId: null, provider: result.provider, id: result.id, title: result.title, year: result.year, cover: result.cover, clipCount: 0 });
    }
    return results.slice(0, 20);
  }

  /**
   * The game a name from a clip stands for, when a lookup finds one with that exact name (short names like "CS2"
   * count). `null` when nothing matches well enough; then the game keeps the name as it was found.
   */
  export async function find(hint: string): Promise<Match | null> {
    const settings = await ClipSettings.get();
    if (!settings.lookups) return null;
    const name = ClipNames.alias(hint) ?? hint;
    const wanted = ClipNames.key(name);
    const exact = (results: SearchResult[]) => results.find((r) => ClipNames.key(r.title) === wanted) ?? null;
    try {
      const steam = exact(await cachedSearch("steam", name, () => steamSearch(name)));
      if (steam) return { provider: steam.provider, id: steam.id, title: steam.title };
      const key = await ClipSettings.steamGridDbKey();
      const grid = key ? exact(await cachedSearch("steamgriddb", name, () => sgdbSearch(name, key))) : null;
      if (grid) return { provider: grid.provider, id: grid.id, title: grid.title };
    } catch (error) {
      log.debug(`Could not look up the game "${name}"`, { error });
      throw error;
    }
    return null;
  }

  /**
   * Everything about a game, with artwork from SteamGridDB filling in what Steam doesn't have.
   * @returns `null` when the game doesn't exist there (anymore).
   */
  export async function details(provider: string, id: string): Promise<Details | null> {
    const key = await ClipSettings.steamGridDbKey();
    if (provider === "steamgriddb") return key ? await sgdbDetails(id, key) : null;
    if (provider !== "steam") return null;
    const details = await steamDetails(id);
    if (details && key) {
      // Steam's own artwork goes first; SteamGridDB's is there for when it's missing
      const extra = await sgdbArtwork({ steam: id }, key).catch(() => null);
      if (extra) {
        details.covers.push(...extra.covers);
        details.heroes.push(...extra.heroes);
        details.logos.push(...extra.logos);
      }
    }
    return details;
  }

  /**
   * The Steam app's name for an app id from a Steam game recording.
   */
  export async function steamApp(appId: string): Promise<Match | null> {
    if (!(await ClipSettings.get()).lookups) return null;
    const details = await steamDetails(appId);
    return details ? { provider: "steam", id: appId, title: details.title } : null;
  }
}

export default GameInfo;
