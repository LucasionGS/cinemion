import Path from "node:path";
import { encodeHex } from "@std/encoding/hex";
import type { ActivityKind, ArrEvent, IntegrationSettings, PathMapping } from "@shared/admin.ts";
import { Library, Setting } from "../models/index.ts";
import Scanner from "../library/Scanner.ts";
import ItemLabels from "../library/ItemLabels.ts";
import Events from "./Events.ts";
import log from "../lib/Logger.ts";

/**
 * Receives Sonarr and Radarr webhooks (Settings → Connect → Webhook in those apps), so imports, renames and
 * deletes show up right away by scanning only the folders they touched.
 */
export namespace ArrWebhook {
  /**
   * What's stored in the `integrations` setting.
   */
  export interface Stored {
    arrToken: string;
    pathMappings: PathMapping[];
    lastEvent: ArrEvent | null;
  }

  /**
   * A file or folder an event touched, as Sonarr or Radarr sees it.
   */
  export interface Target {
    path: string;
    isFile: boolean;
  }

  export interface Parsed {
    /**
     * The instance name, like "Sonarr" or "Radarr 4K".
     */
    app: string;
    eventType: string;
    targets: Target[];
    activity: { kind: ActivityKind; message: string } | null;
  }

  // Only the fields used here; the apps send many more
  interface Episode {
    seasonNumber?: number;
    episodeNumber?: number;
  }
  interface FileRef {
    path?: string;
    relativePath?: string;
    previousPath?: string;
  }
  interface Payload {
    eventType?: string;
    instanceName?: string;
    series?: { title?: string; path?: string };
    episodes?: Episode[];
    episodeFile?: FileRef;
    episodeFiles?: FileRef[];
    renamedEpisodeFiles?: FileRef[];
    movie?: { title?: string; year?: number; folderPath?: string };
    movieFile?: FileRef;
    renamedMovieFiles?: FileRef[];
    isUpgrade?: boolean;
    deletedFiles?: boolean;
    deleteReason?: string;
  }

  export function newToken() {
    return encodeHex(crypto.getRandomValues(new Uint8Array(24)));
  }

  /**
   * The stored settings. A token is made the first time, so the address can be shown right away.
   */
  export async function stored(): Promise<Stored> {
    const value = await Setting.get<Partial<Stored> | null>(Setting.Keys.INTEGRATIONS, null);
    const result: Stored = { arrToken: value?.arrToken || "", pathMappings: value?.pathMappings ?? [], lastEvent: value?.lastEvent ?? null };
    if (!result.arrToken) {
      result.arrToken = newToken();
      await Setting.set(Setting.Keys.INTEGRATIONS, result);
    }
    return result;
  }

  export async function save(patch: Partial<Stored>) {
    const next = { ...await stored(), ...patch };
    await Setting.set(Setting.Keys.INTEGRATIONS, next);
    return next;
  }

  export function toClient(value: Stored): IntegrationSettings {
    return { arrPath: `/api/integrations/arr/${value.arrToken}`, pathMappings: value.pathMappings, lastEvent: value.lastEvent };
  }

  /**
   * Whether `token` is the receiver's token, compared in constant time.
   */
  export async function checkToken(token: string) {
    const expected = (await stored()).arrToken;
    const a = new TextEncoder().encode(token);
    const b = new TextEncoder().encode(expected);
    let diff = a.length ^ b.length;
    for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
    return diff === 0;
  }

  function normalize(path: string) {
    return path.replace(/\\/g, "/").replace(/\/+$/, "");
  }

  function isWindowsPath(path: string) {
    return /^[a-z]:\//i.test(path) || path.startsWith("//");
  }

  /**
   * Turn a path as Sonarr or Radarr sees it into Cinemion's path, using the longest mapping that fits.
   * Windows paths (`D:\TV\Show`) match without caring about case and come out with forward slashes.
   */
  export function mapPath(path: string, mappings: PathMapping[]) {
    const source = normalize(path);
    const sorted = [...mappings].sort((a, b) => normalize(b.from).length - normalize(a.from).length);
    for (const mapping of sorted) {
      const from = normalize(mapping.from);
      if (!from) continue;
      const caseless = isWindowsPath(from);
      const a = caseless ? source.toLowerCase() : source;
      const b = caseless ? from.toLowerCase() : from;
      if (a === b || a.startsWith(b + "/")) return normalize(mapping.to) + source.slice(from.length) || "/";
    }
    return isWindowsPath(source) ? source : path;
  }

  function episodesLabel(episodes: Episode[]) {
    if (episodes.length === 1) return ItemLabels.episodeCode({ seasonNumber: episodes[0].seasonNumber ?? null, episodeNumber: episodes[0].episodeNumber ?? null });
    const seasons = new Set(episodes.map((e) => e.seasonNumber));
    if (seasons.size === 1) return `season ${episodes[0].seasonNumber} (${episodes.length} episodes)`;
    return `${episodes.length} episodes`;
  }

  function fileTargets(files: (FileRef | undefined)[], folder?: string): Target[] {
    const targets: Target[] = [];
    for (const file of files) {
      if (!file) continue;
      if (file.path) targets.push({ path: file.path, isFile: true });
      else if (file.relativePath && folder) targets.push({ path: `${normalize(folder)}/${normalize(file.relativePath)}`, isFile: true });
      if (file.previousPath) targets.push({ path: file.previousPath, isFile: true });
    }
    return targets;
  }

  /**
   * Work out what an event touched. Returns `null` when the body isn't a Sonarr or Radarr event.
   */
  export function parse(body: unknown): Parsed | null {
    const p = body as Payload | null;
    if (!p || typeof p !== "object" || typeof p.eventType !== "string") return null;
    const eventType = p.eventType;

    if (p.series) {
      const app = p.instanceName?.trim() || "Sonarr";
      const title = p.series.title ?? "a show";
      const label = `${title} ${episodesLabel(p.episodes ?? [])}`.trim();
      const folder = p.series.path;
      switch (eventType) {
        case "Download":
          return {
            app, eventType,
            targets: fileTargets([p.episodeFile, ...p.episodeFiles ?? []], folder),
            activity: { kind: "import", message: `${app} ${p.isUpgrade ? "upgraded" : "imported"} ${label}` },
          };
        case "Rename":
          return { app, eventType, targets: folder ? [{ path: folder, isFile: false }] : fileTargets(p.renamedEpisodeFiles ?? []), activity: null };
        case "EpisodeFileDelete":
          // An upgrade deletes the old file first; the import that follows is the interesting part
          return { app, eventType, targets: fileTargets([p.episodeFile], folder), activity: p.deleteReason === "upgrade" ? null : { kind: "delete", message: `${app} deleted ${label}` } };
        case "SeriesDelete":
          if (!p.deletedFiles || !folder) return { app, eventType, targets: [], activity: null };
          return { app, eventType, targets: [{ path: folder, isFile: false }], activity: { kind: "delete", message: `${app} removed ${title}` } };
        default:
          return { app, eventType, targets: [], activity: null };
      }
    }

    if (p.movie) {
      const app = p.instanceName?.trim() || "Radarr";
      const label = p.movie.year ? `${p.movie.title ?? "a movie"} (${p.movie.year})` : p.movie.title ?? "a movie";
      const folder = p.movie.folderPath;
      switch (eventType) {
        case "Download":
          return {
            app, eventType,
            targets: fileTargets([p.movieFile], folder),
            activity: { kind: "import", message: `${app} ${p.isUpgrade ? "upgraded" : "imported"} ${label}` },
          };
        case "Rename":
          return { app, eventType, targets: folder ? [{ path: folder, isFile: false }] : fileTargets(p.renamedMovieFiles ?? []), activity: null };
        case "MovieFileDelete":
          return { app, eventType, targets: fileTargets([p.movieFile], folder), activity: p.deleteReason === "upgrade" ? null : { kind: "delete", message: `${app} deleted ${label}` } };
        case "MovieDelete":
          if (!p.deletedFiles || !folder) return { app, eventType, targets: [], activity: null };
          return { app, eventType, targets: [{ path: folder, isFile: false }], activity: { kind: "delete", message: `${app} removed ${label}` } };
        default:
          return { app, eventType, targets: [], activity: null };
      }
    }

    return { app: p.instanceName?.trim() || "Sonarr or Radarr", eventType, targets: [], activity: null };
  }

  /**
   * Act on an event: scan the touched folders and note it in the activity feed.
   */
  export async function handle(body: unknown): Promise<ArrEvent | null> {
    const parsed = parse(body);
    if (!parsed) return null;
    const settings = await stored();
    const event: ArrEvent = { app: parsed.app, eventType: parsed.eventType, at: new Date().toISOString(), result: "", problem: false };

    if (parsed.eventType === "Test") {
      event.result = "The connection test came through. Everything is set up.";
    }
    else if (parsed.targets.length === 0) {
      event.result = `Nothing to do for ${parsed.eventType} events.`;
    }
    else {
      const libraries = await Library.findAll();
      const folders = new Map<number, Set<string>>();
      const unknown: string[] = [];
      for (const target of parsed.targets) {
        const mapped = mapPath(target.path, settings.pathMappings);
        const folder = target.isFile ? Path.dirname(mapped) : mapped;
        const library = libraries.find((l) => l.paths.some((p) => Scanner.isInside(folder, p)));
        if (!library) {
          unknown.push(folder);
          continue;
        }
        folders.set(library.id, (folders.get(library.id) ?? new Set()).add(folder));
      }

      for (const [libraryId, set] of folders) Scanner.queueFolders(libraryId, [...set]);
      const names = libraries.filter((l) => folders.has(l.id)).map((l) => l.name);
      if (unknown.length > 0) {
        event.problem = true;
        event.result = `${unknown[0]} isn't in any library. If ${parsed.app} sees your media under a different folder than Cinemion, add a path mapping.`;
        log.warn(`${parsed.app} reported a folder that isn't in any library`, { eventType: parsed.eventType, folders: unknown });
      }
      else {
        event.result = `Scanning the changed folders in ${names.join(" and ")}.`;
      }
      if (parsed.activity && folders.size > 0) Events.activity(parsed.activity);
    }

    log.info(`${parsed.app} sent ${parsed.eventType}`, { result: event.result });
    await save({ lastEvent: event });
    return event;
  }
}

export default ArrWebhook;
