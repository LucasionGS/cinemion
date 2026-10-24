import Path from "node:path";
import { Op } from "sequelize";
import type { GameChoice } from "@shared/clips.ts";
import type { Artwork } from "@shared/media.ts";
import { Library, MediaFile, MediaItem } from "../models/index.ts";
import { EMPTY_ARTWORK } from "../models/MediaItem.ts";
import VideoDetails from "../library/VideoDetails.ts";
import ImageCache from "../images/ImageCache.ts";
import Palette from "../images/Palette.ts";
import ClipNames from "./ClipNames.ts";
import GameInfo from "./GameInfo.ts";
import ClipSettings from "./ClipSettings.ts";
import type Tasks from "../lib/Tasks.ts";
import { forEachLimit } from "../lib/async.ts";
import log from "../lib/Logger.ts";

/**
 * Clips libraries: every video is a clip, and clips are grouped by the game they're from. Games come from the names
 * recorders give files and folders (see `ClipNames`), are looked up online for their artwork (see `GameInfo`), and
 * can be set by hand.
 */
export namespace ClipLibrary {
  const LOOKUP_CONCURRENCY = 2;
  const CLIP_CONCURRENCY = 3;

  function isInside(path: string, folder: string) {
    const p = Path.resolve(path);
    const f = Path.resolve(folder);
    return p === f || p.startsWith(f.endsWith(Path.sep) ? f : f + Path.sep);
  }

  /**
   * The games of a library by everything they're known as: their own name, the names clips gave them, and their
   * ids online. Used to find a game for a new clip without asking anyone.
   */
  class GameIndex {
    private _byName = new Map<string, MediaItem>();
    private _byId = new Map<string, MediaItem>();

    public static async load(library: Library) {
      const index = new GameIndex();
      const games = await MediaItem.findAll({ where: { libraryId: library.id, type: "game" } });
      for (const game of games) index.add(game);
      // The names clips gave their game ("CS2") lead to it as well
      const byId = new Map(games.map((g) => [g.id, g]));
      const clips = await MediaItem.findAll({ where: { libraryId: library.id, type: "video", parentId: { [Op.ne]: null } }, attributes: ["parentId", "clip"] });
      for (const clip of clips) {
        const game = byId.get(clip.parentId!);
        if (game && clip.clip?.hint && clip.clip.found !== "manual") index.addName(clip.clip.hint, game);
      }
      return index;
    }

    public add(game: MediaItem) {
      this.addName(game.title, game);
      for (const [provider, id] of Object.entries(game.externalIds)) if (id) this._byId.set(`${provider}:${id}`, game);
    }

    public addName(name: string, game: MediaItem) {
      const key = ClipNames.key(ClipNames.alias(name) ?? name);
      if (key && !this._byName.has(key)) this._byName.set(key, game);
    }

    public byName(name: string) {
      return this._byName.get(ClipNames.key(ClipNames.alias(name) ?? name)) ?? null;
    }

    public byId(provider: string, id: string) {
      return this._byId.get(`${provider}:${id}`) ?? null;
    }
  }

  /**
   * A new, unmatched game with `title`. Its details are looked up later in the scan.
   */
  async function createGame(library: Library, title: string, externalIds: Record<string, string> = {}) {
    const game = MediaItem.build({ libraryId: library.id, type: "game", title: "", sortTitle: "", externalIds, matchStatus: "unmatched", ageRating: library.defaultAge() });
    game.setTitle(title);
    await game.save();
    return game;
  }

  /**
   * Every new file in a Clips library becomes a clip, in the game its names point to (or in none). Returns the new
   * clips.
   */
  export async function assign(library: Library, roots: Map<string, string>) {
    const added: number[] = [];
    const index = await GameIndex.load(library);

    for (const file of await MediaFile.findAll({ where: { libraryId: library.id, itemId: null } })) {
      const root = roots.get(file.path) ?? library.paths.find((p) => isInside(file.path, p)) ?? library.paths[0];
      const parsed = ClipNames.parse(file.path, root);
      const tagHint = ClipNames.fromTags(file.tags);
      // A game named in the file name or tags is more specific than the folder it's in
      const [hint, found] = parsed.source === "file" || parsed.source === "steam" || !tagHint
        ? [parsed.hint, parsed.source]
        : [tagHint, "tags" as const];

      let game: MediaItem | null = null;
      if (parsed.steamAppId) {
        game = index.byId("steam", parsed.steamAppId) ?? (hint ? index.byName(hint) : null);
        if (!game) {
          game = await createGame(library, hint ? ClipNames.alias(hint) ?? hint : `Steam game ${parsed.steamAppId}`, { steam: parsed.steamAppId });
          index.add(game);
        }
      }
      else if (hint) {
        game = index.byName(hint);
        if (!game) {
          game = await createGame(library, ClipNames.alias(hint) ?? hint);
          index.add(game);
        }
      }
      if (game && hint) index.addName(hint, game);

      const clip = MediaItem.build({
        libraryId: library.id,
        parentId: game?.id ?? null,
        type: "video",
        folderPath: Path.dirname(file.path),
        title: "",
        sortTitle: "",
        matchStatus: "matched",
        clip: { hint, steamAppId: parsed.steamAppId, found: game ? found : null, titled: !!parsed.title, desktop: parsed.desktop || undefined, suggestion: null },
      });
      clip.setTitle(parsed.title ?? (parsed.recordedAt ? ClipNames.formatRecorded(parsed.recordedAt) : VideoDetails.titleFromFile(file.path)));
      await clip.save();
      await file.update({ itemId: clip.id });
      added.push(clip.id);
    }
    return added;
  }

  /**
   * When a clip was recorded: from its name, which recorders write on the recording computer's clock, or else from
   * the file (see `VideoDetails.recordedAt()`). Names with only a day borrow the time of day from the file when it
   * agrees on the day.
   */
  async function recordedAt(file: MediaFile, library: Library) {
    const root = library.paths.find((p) => isInside(file.path, p)) ?? library.paths[0];
    const parsed = ClipNames.parse(file.path, root);
    if (parsed.recordedAt && !parsed.dateOnly) return parsed.recordedAt;
    const fromFile = await VideoDetails.recordedAt(file.path, Number(file.mtime));
    if (parsed.recordedAt && fromFile?.slice(0, 10) !== parsed.recordedAt.slice(0, 10)) return parsed.recordedAt;
    return fromFile;
  }

  /**
   * Fill in a clip's details from its file: when it was recorded, its length, rating and thumbnail. Details set by
   * hand stay.
   */
  export async function refreshClip(clip: MediaItem, opts?: { regenerate?: boolean; library?: Library | null }) {
    opts ??= {};
    const library = opts.library ?? await Library.findByPk(clip.libraryId);
    const file = await MediaFile.findOne({ where: { itemId: clip.id }, order: [["path", "ASC"]] });
    if (!file || !library) return;
    if (!clip.editedAt) {
      clip.takenAt = await recordedAt(file, library);
      clip.releaseDate = clip.takenAt?.slice(0, 10) ?? null;
      if (!clip.clip?.titled && clip.takenAt) clip.setTitle(ClipNames.formatRecorded(clip.takenAt));
    }
    await VideoDetails.refreshVideo(clip, { regenerate: opts.regenerate, library });
  }

  /**
   * Details for new clips (or all of them, when asked), then every game.
   */
  export async function refresh(library: Library, task: Tasks.Handle, opts: { regenerate?: boolean }) {
    const clips = await MediaItem.findAll({ where: { libraryId: library.id, type: "video", ...(opts.regenerate ? {} : { metadataUpdatedAt: null }) } });
    let done = 0;
    await forEachLimit(clips, CLIP_CONCURRENCY, async (clip) => {
      task.update("Making thumbnails", done / clips.length);
      try {
        await refreshClip(clip, { regenerate: opts.regenerate, library });
      } catch (error) {
        log.warn(`Could not read details of "${clip.title}"`, { error });
      }
      done++;
    });
    await refreshGames(library, task, opts);
    return clips.length;
  }

  //#region Games

  /**
   * Store the first artwork that downloads of each kind.
   */
  async function storeArtwork(details: GameInfo.Details): Promise<Artwork> {
    const first = async (urls: string[]) => {
      for (const url of urls) {
        const key = await ImageCache.store({ url });
        if (key) return key;
      }
      return null;
    };
    return { ...EMPTY_ARTWORK, poster: await first(details.covers), backdrop: await first(details.heroes), logo: await first(details.logos) };
  }

  /**
   * Write what a lookup found onto a game. When the library already has that game (under another name), the clips
   * move there and this game goes; that game is returned instead.
   * @param status `manual` keeps a game picked by hand from being looked up again.
   */
  export async function applyDetails(game: MediaItem, details: GameInfo.Details, status: "matched" | "manual") {
    const same = await MediaItem.findAll({ where: { libraryId: game.libraryId, type: "game", id: { [Op.ne]: game.id } } });
    const existing = same.find((g) => g.externalIds[details.provider as "steam" | "steamgriddb"] === details.id);
    if (existing) {
      await MediaItem.update({ parentId: existing.id }, { where: { parentId: game.id, type: "video" } });
      await game.destroy();
      return existing;
    }

    game.setTitle(details.title);
    game.externalIds = { ...game.externalIds, [details.provider]: details.id };
    game.overview = details.overview ?? game.overview;
    if (details.genres.length) game.genres = details.genres;
    game.releaseDate = details.releaseDate ?? game.releaseDate;
    game.year = game.releaseDate ? parseInt(game.releaseDate.slice(0, 4)) || null : null;
    if (!game.customArtwork) {
      const artwork = await storeArtwork(details);
      game.artwork = artwork;
      const source = artwork.backdrop ?? artwork.poster;
      game.palette = source ? await Palette.fromImage(source) : null;
    }
    game.matchStatus = status;
    game.metadataUpdatedAt = new Date();
    await game.save();
    return game;
  }

  /**
   * Look a game up by what it's known by: its Steam app id, the id it was matched with, or its name.
   * @returns `null` when nothing online matches.
   * @throws When the lookup can't be made (no connection).
   */
  async function lookUp(game: MediaItem): Promise<GameInfo.Details | null> {
    if (!(await ClipSettings.get()).lookups) return null;
    const { steam, steamgriddb } = game.externalIds;
    if (game.matchStatus !== "unmatched" || steam || steamgriddb) {
      const provider = steam ? "steam" : steamgriddb ? "steamgriddb" : null;
      if (provider) return await GameInfo.details(provider, (steam ?? steamgriddb)!);
    }
    const match = await GameInfo.find(game.title);
    return match ? await GameInfo.details(match.provider, match.id) : null;
  }

  /**
   * Look one game up again, for "Refresh details".
   * @throws When the lookup can't be made.
   */
  export async function refreshGame(game: MediaItem) {
    const details = await lookUp(game);
    if (details) await applyDetails(game, details, game.matchStatus === "manual" ? "manual" : "matched");
    else {
      game.metadataUpdatedAt = new Date();
      await game.save();
    }
  }

  /**
   * Look up new games (or all of them, when asked), then update every game from its clips.
   */
  export async function refreshGames(library: Library, task: Tasks.Handle | null, opts: { regenerate?: boolean }) {
    const games = await MediaItem.findAll({ where: { libraryId: library.id, type: "game", ...(opts.regenerate ? {} : { metadataUpdatedAt: null }) } });
    let done = 0;
    let offline = false;
    await forEachLimit(games, LOOKUP_CONCURRENCY, async (game) => {
      task?.update("Looking up games", done++ / games.length);
      // One failed connection is enough to know; the rest wait for the next scan
      if (offline) return;
      try {
        await refreshGame(game);
      } catch (error) {
        offline = true;
        log.warn(`Could not look up games for "${library.name}". They're tried again on the next scan.`, { error });
      }
    });
    await summarizeGames(library);
  }

  /**
   * Update each game from its clips: the lowest age rating, so a game shows for anyone who may see one of its clips.
   */
  export async function summarizeGames(library: Library) {
    const games = await MediaItem.findAll({ where: { libraryId: library.id, type: "game" } });
    if (games.length === 0) return;
    const clips = await MediaItem.findAll({ where: { libraryId: library.id, type: "video", parentId: games.map((g) => g.id) }, attributes: ["parentId", "ageRating"] });
    for (const game of games) {
      const ages = clips.filter((c) => c.parentId === game.id).map((c) => c.ageRating).filter((a): a is number => a !== null);
      game.ageRating = ages.length ? Math.min(...ages) : library.defaultAge();
      if (game.changed()) await game.save();
    }
  }

  /**
   * Remove games no clip is in anymore.
   */
  export async function removeEmptyGames(library: Library) {
    const games = await MediaItem.findAll({ where: { libraryId: library.id, type: "game" }, attributes: ["id"] });
    const used = new Set((await MediaItem.findAll({ where: { libraryId: library.id, type: "video", parentId: { [Op.ne]: null } }, attributes: ["parentId"] })).map((c) => c.parentId));
    const empty = games.filter((g) => !used.has(g.id)).map((g) => g.id);
    if (empty.length) await MediaItem.destroy({ where: { id: empty } });
  }

  /**
   * The game for a choice from "Set game": a game the library has, one found online (added and looked up right
   * away), or one with just a name.
   * @throws When the game isn't in this library, or can't be found online.
   */
  export async function gameFor(library: Library, choice: Exclude<GameChoice, null>): Promise<MediaItem> {
    if ("gameId" in choice) {
      const game = await MediaItem.findByPk(choice.gameId);
      if (!game || game.type !== "game" || game.libraryId !== library.id) throw new Error("That game isn't in this library.");
      return game;
    }
    const index = await GameIndex.load(library);
    if ("provider" in choice) {
      const known = index.byId(choice.provider, choice.id);
      if (known) return known;
      const details = await GameInfo.details(choice.provider, choice.id);
      if (!details) throw new Error(`"${choice.title}" couldn't be found online anymore. Try searching again.`);
      // A game the clips named the same way (but that wasn't found online) gets the details
      return await applyDetails(index.byName(details.title) ?? await createGame(library, details.title), details, "manual");
    }
    const title = ClipNames.cleanGameName(String(choice.title ?? "")).slice(0, 200);
    if (!title) throw new Error("Give the game a name.");
    const known = index.byName(title);
    if (known) return known;
    const game = await createGame(library, title);
    game.matchStatus = "manual";
    game.metadataUpdatedAt = new Date();
    await game.save();
    return game;
  }

  /**
   * Put clips in a game by hand (or take them out of every game, with `null`). Games left without clips go.
   * @returns The game they're in now.
   */
  export async function setGame(library: Library, clips: MediaItem[], choice: GameChoice) {
    const game = choice ? await gameFor(library, choice) : null;
    for (const clip of clips) {
      clip.parentId = game?.id ?? null;
      clip.clip = { hint: null, steamAppId: null, titled: false, ...clip.clip, found: game ? "manual" : null, suggestion: null };
      await clip.save();
    }
    await removeEmptyGames(library);
    await summarizeGames(library);
    return game;
  }

  /**
   * Put a clip in the game the app that uploaded it named (Podium knows the game it recorded). An unknown game is
   * added and looked up right away, so it comes with its artwork.
   * @param steamAppId The game's Steam app id, when the app knows it.
   */
  export async function setGameFromUpload(library: Library, clip: MediaItem, name: string, steamAppId: string | null) {
    const index = await GameIndex.load(library);
    const title = ClipNames.cleanGameName(name).slice(0, 200);
    let game = (steamAppId ? index.byId("steam", steamAppId) : null) ?? (title ? index.byName(title) : null);
    if (!game) {
      if (!title && !steamAppId) return;
      game = await createGame(library, title ? ClipNames.alias(title) ?? title : `Steam game ${steamAppId}`, steamAppId ? { steam: steamAppId } : {});
      try {
        await refreshGame(game);
      } catch (error) {
        log.debug(`Could not look up "${game.title}" yet; the next scan tries again`, { error });
      }
      // Looking it up may have found that the library has it already, under another name
      game = await MediaItem.findByPk(game.id) ?? (steamAppId ? (await GameIndex.load(library)).byId("steam", steamAppId) : null);
    }
    if (!game) return;
    clip.parentId = game.id;
    clip.clip = { titled: false, suggestion: null, ...clip.clip, hint: title || null, steamAppId, found: "upload" };
    await clip.save();
    await removeEmptyGames(library);
    await summarizeGames(library);
  }

  /**
   * Rename a game, match it with a game found online, or put its clips in another game of the library. The game is
   * then kept as it is on refreshes.
   * @returns The game its clips are in now (another one, when the library already had the matched game).
   */
  export async function editGame(game: MediaItem, change: { title?: string; provider?: string; id?: string; gameId?: number }) {
    if (change.gameId) {
      const other = await MediaItem.findByPk(change.gameId);
      if (!other || other.type !== "game" || other.libraryId !== game.libraryId) throw new Error("That game isn't in this library.");
      if (other.id === game.id) return game;
      await MediaItem.update({ parentId: other.id }, { where: { parentId: game.id, type: "video" } });
      await game.destroy();
      return other;
    }
    if (change.provider && change.id) {
      const details = await GameInfo.details(change.provider, change.id);
      if (!details) throw new Error("That game couldn't be found online anymore. Try searching again.");
      return await applyDetails(game, details, "manual");
    }
    const title = ClipNames.cleanGameName(String(change.title ?? "")).slice(0, 200);
    if (!title) throw new Error("Give the game a name.");
    game.setTitle(title);
    game.matchStatus = "manual";
    await game.save();
    return game;
  }

  /**
   * Remove a game: its clips stay, without a game.
   */
  export async function removeGame(game: MediaItem) {
    const clips = await MediaItem.findAll({ where: { parentId: game.id, type: "video" } });
    for (const clip of clips) {
      clip.parentId = null;
      clip.clip = { hint: null, steamAppId: null, titled: false, ...clip.clip, found: null, suggestion: null };
      await clip.save();
    }
    await game.destroy();
  }
  //#endregion
}

export default ClipLibrary;
