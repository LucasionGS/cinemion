import type { SubtitleSearchResult, SubtitleSettings } from "@shared/playback.ts";
import AppSystem from "../../AppSystem.ts";
import SubtitleProvider from "../SubtitleProvider.ts";

/**
 * podnapisi.net: a large free subtitle site that needs no key. Searched by title (with season and episode), so the
 * timing isn't known to match the file. Downloads come as zip files.
 */
export class PodnapisiProvider extends SubtitleProvider {
  public readonly id = "podnapisi";
  public readonly name = "Podnapisi";

  private static readonly SITE = Deno.env.get("PODNAPISI_URL") || "https://www.podnapisi.net";

  public isConfigured(settings: SubtitleSettings) {
    return settings.podnapisiEnabled;
  }

  private get headers() {
    return { "User-Agent": `${AppSystem.APP_NAME} v${AppSystem.VERSION}` };
  }

  /**
   * Text of the first `<name>` inside `xml`.
   */
  private static field(xml: string, name: string) {
    const value = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? "";
    return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  }

  public async search(query: SubtitleProvider.Query, _settings: SubtitleSettings): Promise<SubtitleSearchResult[]> {
    const results: SubtitleSearchResult[] = [];
    const seen = new Set<string>();
    for (const language of query.languages) {
      // The old search answers in XML and is the one meant for programs
      const url = new URL(`${PodnapisiProvider.SITE}/subtitles/search/old`);
      url.searchParams.set("sXML", "1");
      url.searchParams.set("sL", language === "pt-br" ? "pb" : language);
      url.searchParams.set("sK", query.text);
      if (query.year && query.type === "movie") url.searchParams.set("sY", String(query.year));
      if (query.type === "episode" && query.season !== null) url.searchParams.set("sTS", String(query.season));
      if (query.type === "episode" && query.episode !== null) url.searchParams.set("sTE", String(query.episode));
      const res = await fetch(url, { headers: this.headers, signal: AbortSignal.timeout(20_000) });
      if (res.status === 429) throw new Error("Podnapisi is getting too many requests. Wait a minute and try again.");
      if (!res.ok) throw new Error(`Couldn't search on Podnapisi: ${res.status} ${res.statusText}`);
      const xml = await res.text();

      for (const block of xml.match(/<subtitle>[\s\S]*?<\/subtitle>/g) ?? []) {
        const pid = PodnapisiProvider.field(block, "pid");
        if (!pid || seen.has(pid)) continue;
        seen.add(pid);
        // Episode searches also return other episodes of the show
        const season = Number(PodnapisiProvider.field(block, "tvSeason")) || null;
        const episode = Number(PodnapisiProvider.field(block, "tvEpisode")) || null;
        if (query.type === "episode" && ((season !== null && season !== query.season) || (episode !== null && episode !== query.episode))) continue;
        const flags = PodnapisiProvider.field(block, "flags");
        const hearingImpaired = /n/.test(flags);
        if ((query.hearingImpaired === "exclude" && hearingImpaired) || (query.hearingImpaired === "only" && !hearingImpaired)) continue;
        const release = PodnapisiProvider.field(block, "release").split(/\s+/).find(Boolean);
        results.push({
          provider: this.id,
          id: pid,
          name: release || PodnapisiProvider.field(block, "title") || query.text,
          language,
          isHearingImpaired: hearingImpaired,
          matchesFile: false,
          downloads: Number(PodnapisiProvider.field(block, "downloads")) || 0,
          rating: Number(PodnapisiProvider.field(block, "rating")) || null,
          uploadedAt: null,
          notes: ["Timing may differ from your file"],
        });
      }
    }
    return results.sort((a, b) => b.downloads - a.downloads);
  }

  public async download(id: string, _settings: SubtitleSettings, episode?: { season: number | null; number: number | null }): Promise<SubtitleProvider.Download> {
    const res = await fetch(`${PodnapisiProvider.SITE}/subtitles/${encodeURIComponent(id)}/download?container=zip`, { headers: this.headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Couldn't download from Podnapisi: ${res.status} ${res.statusText}`);
    return SubtitleProvider.fromZip(new Uint8Array(await res.arrayBuffer()), episode);
  }
}

export default PodnapisiProvider;
