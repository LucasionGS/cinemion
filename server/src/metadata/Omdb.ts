import type { MetadataSettings } from "@shared/api.ts";
import type { ExternalRatings } from "@shared/media.ts";
import { Setting } from "../models/index.ts";

const API = Deno.env.get("OMDB_API_URL") || "https://www.omdbapi.com/";

/**
 * Ratings from IMDb, Rotten Tomatoes and Metacritic, through the OMDb API. Looked up by IMDb id, so only titles that
 * one of the metadata providers matched get them. Free keys allow 1000 lookups a day, so ratings are only fetched
 * when a title's details are.
 */
export namespace Omdb {
  async function apiKey() {
    const settings = await Setting.get<Partial<MetadataSettings> | null>(Setting.Keys.METADATA, null);
    return settings?.omdbApiKey || Deno.env.get("OMDB_API_KEY") || null;
  }

  export async function isAvailable() {
    return !!(await apiKey());
  }

  function number(value: string | undefined, pattern: RegExp) {
    const match = value?.replace(/,/g, "").match(pattern);
    return match ? Number(match[1]) : null;
  }

  /**
   * Turn OMDb's answer into ratings. Values it doesn't have are "N/A".
   */
  export function parse(data: { imdbRating?: string; imdbVotes?: string; Metascore?: string; Ratings?: { Source: string; Value: string }[] }): ExternalRatings {
    const source = (name: string) => data.Ratings?.find((r) => r.Source === name)?.Value;
    return {
      imdb: number(data.imdbRating, /^(\d+(?:\.\d+)?)$/),
      imdbVotes: number(data.imdbVotes, /^(\d+)$/),
      // Example: "93%"
      rottenTomatoes: number(source("Rotten Tomatoes"), /^(\d+)%$/),
      // Example: "74/100", or the Metascore field "74"
      metacritic: number(source("Metacritic"), /^(\d+)\/100$/) ?? number(data.Metascore, /^(\d+)$/),
    };
  }

  /**
   * Ratings for an IMDb id like "tt0111161". `null` when OMDb isn't set up or doesn't know the title.
   * @throws When OMDb refuses the key or can't be reached.
   */
  export async function ratings(imdbId: string): Promise<ExternalRatings | null> {
    const key = await apiKey();
    if (!key) return null;
    const url = new URL(API);
    url.searchParams.set("apikey", key);
    url.searchParams.set("i", imdbId);
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401) throw new Error("OMDb rejected the API key. Check it in Settings › Metadata.");
    if (!res.ok) throw new Error(`OMDb request failed: ${res.status} ${res.statusText}`);
    const data = await res.json() as Parameters<typeof parse>[0] & { Response?: string; Error?: string };
    if (data.Response === "False") {
      if (/limit/i.test(data.Error ?? "")) throw new Error("OMDb's daily limit is used up. Ratings are fetched again tomorrow.");
      if (/key/i.test(data.Error ?? "")) throw new Error("OMDb rejected the API key. Check it in Settings › Metadata.");
      return null;
    }
    const ratings = parse(data);
    return Object.values(ratings).some((v) => v !== null) ? ratings : null;
  }
}

export default Omdb;
