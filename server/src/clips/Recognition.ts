import fsp from "node:fs/promises";
import Path from "node:path";
import { encodeHex } from "@std/encoding/hex";
import type { GameSuggestion, RecognitionStatus } from "@shared/clips.ts";
import AppSystem from "../AppSystem.ts";
import { ClipEmbedding, Library, MediaFile, MediaItem } from "../models/index.ts";
import Tasks from "../lib/Tasks.ts";
import Ffmpeg from "../lib/Ffmpeg.ts";
import ClipNames from "./ClipNames.ts";
import ClipSettings from "./ClipSettings.ts";
import type { Reply, Request } from "./RecognitionWorker.ts";
import log from "../lib/Logger.ts";

/**
 * Picture recognition for clips without a game: an image model (CLIP) looks at a few frames of every clip, and a
 * clip without a game gets a suggestion when it looks like clips that have one ("similar"), or like what the model
 * knows of a game's name ("picture", a best guess). It's an optional download, so servers that don't use it don't
 * carry it, and it runs on the CPU, one picture at a time, in a worker.
 */
export namespace Recognition {
  /**
   * Which model made a vector. Stored with every vector, since vectors of different models can't be compared.
   */
  export const MODEL = "clip-vit-b16-q8";
  export const modelDir = Path.join(AppSystem.config.CONFIG_DIR, "models", MODEL);

  const HF = "https://huggingface.co/Xenova/clip-vit-base-patch16/resolve/342fdf2f67aded64d138ff074745fb4a5d2bba5f";
  const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist";
  // Pinned, so a changed file is never run
  const FILES = [
    { name: "vision_model_quantized.onnx", url: `${HF}/onnx/vision_model_quantized.onnx`, size: 87461602, sha256: "44eece4fe5fe4e0359a88268a327adf758633a1aade3917690b952bef1501f96" },
    { name: "text_model_quantized.onnx", url: `${HF}/onnx/text_model_quantized.onnx`, size: 64504507, sha256: "9106b51e6c663a56b99182ec617c2b3d53577b037e7e24a7717eb78048a0c97a" },
    { name: "tokenizer.json", url: `${HF}/tokenizer.json`, size: 2224081, sha256: "72ed5c96db5729294468543e4bc75fce14ca63f58e37300290189ba1c1e52b85" },
    { name: "ort.bundle.min.mjs", url: `${ORT}/ort.bundle.min.mjs`, size: 468451, sha256: "e1602de08c4d287700aaebc77332e19f52dd7554feb510a23dac9345992698e2" },
    { name: "ort-wasm-simd-threaded.wasm", url: `${ORT}/ort-wasm-simd-threaded.wasm`, size: 11246032, sha256: "207d02be4591c156b0a98f024f3d58005b5b04c92274d759fb390338c63559ea" },
  ];
  const DOWNLOAD_SIZE = FILES.reduce((sum, f) => sum + f.size, 0);
  const READY_FILE = "ready.json";

  const SIZE = 224;
  // Where frames are taken, as a share of the clip's length: past the start and before the end
  const FRAME_AT = [0.15, 0.4, 0.65, 0.9];
  // How a game's name is put to the model; the average of these works better than any one
  const PROMPTS = ["a screenshot of the video game {}.", "gameplay footage from {}.", "{}, a video game."];
  // Suggestions below this are left out; a wrong suggestion is worse than none
  const MIN_CONFIDENCE = 0.35;
  const NEIGHBOURS = 7;
  // Similarity of two clips of the same game is typically above 0.85; different games stay below 0.75
  const SIMILAR_FROM = 0.72;
  const SIMILAR_SURE = 0.9;

  /**
   * Games people often record, so a best guess can name one the library doesn't have yet.
   */
  const POPULAR_GAMES = [
    "Counter-Strike 2", "VALORANT", "League of Legends", "Fortnite", "Minecraft", "Apex Legends", "Overwatch 2",
    "Call of Duty: Warzone", "Call of Duty: Black Ops 6", "Rocket League", "Tom Clancy's Rainbow Six Siege",
    "PUBG: BATTLEGROUNDS", "Dota 2", "Grand Theft Auto V", "Red Dead Redemption 2", "ELDEN RING", "Destiny 2",
    "Rust", "Escape from Tarkov", "Dead by Daylight", "Marvel Rivals", "HELLDIVERS 2", "The Finals", "Deadlock",
    "Team Fortress 2", "World of Warcraft", "Genshin Impact", "Honkai: Star Rail", "Roblox", "Halo Infinite",
    "Sea of Thieves", "Palworld", "Lethal Company", "Phasmophobia", "Among Us", "Fall Guys", "Valheim", "Terraria",
    "Stardew Valley", "Baldur's Gate 3", "Cyberpunk 2077", "The Witcher 3: Wild Hunt", "Hollow Knight", "Hades",
    "Hades II", "Monster Hunter: World", "Monster Hunter Wilds", "Path of Exile 2", "Diablo IV", "Lost Ark",
    "Warframe", "War Thunder", "World of Tanks", "Battlefield 2042", "Battlefield 6", "Hunt: Showdown 1896",
    "Arc Raiders", "Delta Force", "Street Fighter 6", "Tekken 8", "Mortal Kombat 1", "EA SPORTS FC 25", "NBA 2K25",
    "Forza Horizon 5", "Gran Turismo 7", "Mario Kart 8 Deluxe", "Super Smash Bros. Ultimate",
    "The Legend of Zelda: Tears of the Kingdom", "Splatoon 3", "Pokémon Scarlet and Violet", "Brawl Stars",
    "Clash Royale", "Osu!", "Beat Saber", "Geometry Dash", "Black Myth: Wukong", "Dark Souls III", "Sekiro: Shadows Die Twice",
    "Satisfactory", "Factorio", "No Man's Sky", "Subnautica", "The Elder Scrolls V: Skyrim", "Fallout 4",
    "Starfield", "Ghost of Tsushima", "God of War", "Marvel's Spider-Man 2", "Hogwarts Legacy", "It Takes Two",
    "R.E.P.O.", "PEAK", "Schedule I", "Content Warning", "Garry's Mod", "Left 4 Dead 2", "Overcooked! 2",
  ];

  let _download: { received: number; error: string | null } | null = null;
  let _failure: string | null = null;
  const _textVectors = new Map<string, Float32Array>();

  //#region Installing

  async function isReady() {
    return await fsp.stat(Path.join(modelDir, READY_FILE)).then(() => true).catch(() => false);
  }

  /**
   * Whether picture recognition is downloaded, being downloaded, or failed, and how many clips it has yet to see.
   */
  export async function status(): Promise<RecognitionStatus> {
    const ready = await isReady();
    const clips = await MediaItem.count({ where: { type: "video", libraryId: (await Library.findAll({ where: { type: "clips" }, attributes: ["id"] })).map((l) => l.id) } });
    const seen = ready ? await ClipEmbedding.count({ where: { model: MODEL } }) : 0;
    return {
      state: _download ? "downloading" : ready ? "ready" : _failure ? "failed" : "missing",
      progress: _download ? _download.received / DOWNLOAD_SIZE : null,
      downloadSize: DOWNLOAD_SIZE,
      error: _failure,
      pending: Math.max(0, clips - seen),
    };
  }

  async function downloadFile(file: typeof FILES[number], onBytes: (n: number) => void) {
    const target = Path.join(modelDir, file.name);
    const temp = `${target}.part`;
    const res = await fetch(file.url, { headers: { "User-Agent": `${AppSystem.APP_NAME}/${AppSystem.VERSION}` } });
    if (!res.ok || !res.body) throw new Error(`Downloading ${file.name} failed: ${res.status} ${res.statusText}`);
    const out = await Deno.open(temp, { write: true, create: true, truncate: true });
    try {
      for await (const chunk of res.body) {
        await out.write(chunk);
        onBytes(chunk.byteLength);
      }
    } finally {
      out.close();
    }
    const hash = encodeHex(await crypto.subtle.digest("SHA-256", await Deno.readFile(temp)));
    if (hash !== file.sha256) {
      await fsp.rm(temp, { force: true });
      throw new Error(`${file.name} didn't download correctly (its checksum is wrong). Try again.`);
    }
    await fsp.rename(temp, target);
  }

  /**
   * Download the model and its runtime in the background. Status shows the progress.
   */
  export function install() {
    if (_download) return;
    _download = { received: 0, error: null };
    _failure = null;
    (async () => {
      try {
        await fsp.mkdir(modelDir, { recursive: true });
        for (const file of FILES) {
          const done = await fsp.stat(Path.join(modelDir, file.name)).then((s) => s.size === file.size).catch(() => false);
          if (done) _download!.received += file.size;
          else await downloadFile(file, (n) => _download!.received += n);
        }
        // Loading it once proves it runs here
        await withWorker(async (worker) => await worker.text("a video game"));
        await fsp.writeFile(Path.join(modelDir, READY_FILE), JSON.stringify({ model: MODEL, installedAt: new Date().toISOString() }));
        log.info("Picture recognition for clips is installed");
        for (const library of await Library.findAll({ where: { type: "clips" } })) queue(library.id);
      } catch (error) {
        _failure = error instanceof Error ? error.message : String(error);
        log.warn("Could not install picture recognition", { error });
      } finally {
        _download = null;
      }
    })();
  }

  /**
   * Remove the downloaded model. What it saw in clips is kept, for when it comes back.
   */
  export async function uninstall() {
    if (_download) throw new Error("Wait for the download to finish first.");
    await fsp.rm(modelDir, { recursive: true, force: true });
    _failure = null;
  }
  //#endregion

  //#region Running the model

  // A request without its id, for each kind of request
  type Message<R = Request> = R extends unknown ? Omit<R, "id"> : never;

  class ModelWorker {
    private _worker = new Worker(new URL("./RecognitionWorker.ts", import.meta.url).href, { type: "module" });
    private _next = 1;
    private _waiting = new Map<number, { resolve: (v: Float32Array | undefined) => void; reject: (e: Error) => void }>();

    constructor() {
      this._worker.onmessage = (event: MessageEvent<Reply>) => {
        const waiting = this._waiting.get(event.data.id);
        this._waiting.delete(event.data.id);
        if (event.data.error) waiting?.reject(new Error(event.data.error));
        else waiting?.resolve(event.data.vector);
      };
      this._worker.onerror = (event) => {
        event.preventDefault();
        for (const waiting of this._waiting.values()) waiting.reject(new Error(event.message || "The picture recognition stopped."));
        this._waiting.clear();
      };
    }

    private send(request: Message, transfer: Transferable[] = []) {
      const id = this._next++;
      return new Promise<Float32Array | undefined>((resolve, reject) => {
        this._waiting.set(id, { resolve, reject });
        this._worker.postMessage({ ...request, id }, transfer);
      });
    }

    public async init() {
      await this.send({ type: "init", dir: modelDir });
    }

    public async image(pixels: Uint8Array) {
      return (await this.send({ type: "image", pixels }, [pixels.buffer as ArrayBuffer]))!;
    }

    public async text(text: string) {
      return (await this.send({ type: "text", text }))!;
    }

    public stop() {
      this._worker.terminate();
    }
  }

  /**
   * Run `job` with the model loaded, and unload it afterwards: it takes a few hundred MB of memory.
   */
  async function withWorker<T>(job: (worker: ModelWorker) => Promise<T>): Promise<T> {
    const worker = new ModelWorker();
    try {
      await worker.init();
      return await job(worker);
    } finally {
      worker.stop();
    }
  }

  /**
   * A frame of the video at `time`, as the model wants it: 224 × 224, cropped to the middle, as RGB bytes.
   */
  async function frame(file: MediaFile, time: number) {
    const result = await Ffmpeg.run(["-ss", time.toFixed(2), "-i", file.path, "-map", "0:V:0", "-frames:v", "1", "-vf", `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=increase:flags=bicubic,crop=${SIZE}:${SIZE}`, "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]);
    return result.code === 0 && result.stdout.length === SIZE * SIZE * 3 ? result.stdout : null;
  }

  function average(vectors: Float32Array[]) {
    const sum = new Float32Array(vectors[0].length);
    for (const v of vectors) v.forEach((x, i) => sum[i] += x);
    let length = 0;
    for (const x of sum) length += x * x;
    length = Math.sqrt(length) || 1;
    return sum.map((x) => x / length);
  }

  function dot(a: Float32Array, b: Float32Array) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
  }

  /**
   * What the model sees in a clip: the average of a few frames. `null` when no frame could be read.
   */
  async function embedClip(worker: ModelWorker, file: MediaFile) {
    const duration = file.duration ?? 0;
    const vectors: Float32Array[] = [];
    for (const at of FRAME_AT) {
      const pixels = await frame(file, duration ? duration * at : vectors.length);
      if (pixels) vectors.push(await worker.image(pixels));
    }
    return vectors.length ? average(vectors) : null;
  }

  async function textVector(worker: ModelWorker, title: string) {
    const known = _textVectors.get(title);
    if (known) return known;
    const vectors: Float32Array[] = [];
    for (const prompt of PROMPTS) vectors.push(await worker.text(prompt.replace("{}", title)));
    const vector = average(vectors);
    _textVectors.set(title, vector);
    return vector;
  }
  //#endregion

  //#region Suggesting

  /**
   * Look at the clips the model hasn't seen yet and suggest games for clips without one, in the background.
   */
  export function queue(libraryId: number) {
    return Tasks.run(`recognition:${libraryId}`, "Recognising games in clips", { libraryId, queue: "recognition" }, async (task) => {
      if (!await isReady()) return;
      const library = await Library.findByPk(libraryId);
      if (library?.type !== "clips") return;
      await withWorker((worker) => run(library, worker, task));
    });
  }

  /**
   * Whether picture recognition should run after a scan of `library`.
   */
  export async function shouldRunAfterScan(library: Library) {
    return library.type === "clips" && (await ClipSettings.get()).autoSuggest && await isReady();
  }

  async function run(library: Library, worker: ModelWorker, task: Tasks.Handle) {
    const clips = await MediaItem.findAll({ where: { libraryId: library.id, type: "video" }, attributes: ["id", "parentId", "clip", "title"] });
    const files = new Map<number, MediaFile>();
    const stored = new Map<number, ClipEmbedding>();
    // Small batches, since SQLite limits the number of values in one query
    for (let i = 0; i < clips.length; i += 500) {
      const ids = clips.slice(i, i + 500).map((c) => c.id);
      for (const file of await MediaFile.findAll({ where: { itemId: ids }, order: [["path", "ASC"]] })) if (!files.has(file.itemId!)) files.set(file.itemId!, file);
      for (const e of await ClipEmbedding.findAll({ where: { itemId: ids, model: MODEL } })) stored.set(e.itemId, e);
    }

    // Look at new and changed clips
    const unseen = clips.filter((c) => files.has(c.id) && Number(stored.get(c.id)?.mtime) !== Number(files.get(c.id)!.mtime));
    let done = 0;
    for (const clip of unseen) {
      task.update("Looking at clips", done++ / unseen.length);
      const file = files.get(clip.id)!;
      try {
        const vector = await embedClip(worker, file);
        if (!vector) continue;
        const existing = stored.get(clip.id) ?? await ClipEmbedding.findOne({ where: { itemId: clip.id } });
        const values = { itemId: clip.id, model: MODEL, mtime: Number(file.mtime), vector: ClipEmbedding.encode(vector) };
        stored.set(clip.id, existing ? await existing.update(values) : await ClipEmbedding.create(values));
      } catch (error) {
        log.warn(`Picture recognition couldn't look at ${file.path}`, { error });
      }
    }

    task.update("Suggesting games");
    const games = await MediaItem.findAll({ where: { libraryId: library.id, type: "game" } });
    const gameById = new Map(games.map((g) => [g.id, g]));
    // Clips whose game came from their names or someone's pick are what the others are compared with
    const references = clips
      .filter((c) => c.parentId !== null && c.clip?.found && stored.has(c.id))
      .map((c) => ({ gameId: c.parentId!, vector: stored.get(c.id)!.toFloats() }));
    const titles = [...games.map((g) => g.title)];
    const known = new Set(titles.map((t) => ClipNames.key(t)));
    for (const title of POPULAR_GAMES) if (!known.has(ClipNames.key(title))) titles.push(title);
    const textVectors = new Map<string, Float32Array>();
    for (const title of titles) textVectors.set(title, await textVector(worker, title));

    for (const clip of clips.filter((c) => c.parentId === null)) {
      const vector = stored.get(clip.id)?.toFloats();
      if (!vector || !clip.clip || clip.clip.desktop) continue;
      const notGames = new Set((clip.clip.notGames ?? []).map((t) => ClipNames.key(t)));
      const suggestion = suggest(vector, references, textVectors, gameById, notGames);
      if (JSON.stringify(suggestion) === JSON.stringify(clip.clip.suggestion)) continue;
      clip.clip = { ...clip.clip, suggestion };
      await clip.save();
    }
  }

  /**
   * The game a clip most likely shows, from the clips it looks like and from the picture alone, or `null` when
   * neither is sure enough.
   */
  function suggest(
    vector: Float32Array,
    references: { gameId: number; vector: Float32Array }[],
    textVectors: Map<string, Float32Array>,
    games: Map<number, MediaItem>,
    notGames: Set<string>,
  ): GameSuggestion | null {
    const allowed = (title: string) => !notGames.has(ClipNames.key(title));

    // Clips that look alike: the nearest few vote, the closest counting most
    let similar: { title: string; gameId: number; confidence: number } | null = null;
    const nearest = references
      .filter((r) => games.has(r.gameId) && allowed(games.get(r.gameId)!.title))
      .map((r) => ({ gameId: r.gameId, score: dot(vector, r.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, NEIGHBOURS);
    if (nearest.length && nearest[0].score >= SIMILAR_FROM) {
      const votes = new Map<number, number>();
      for (const n of nearest) votes.set(n.gameId, (votes.get(n.gameId) ?? 0) + Math.exp((n.score - nearest[0].score) * 25));
      const total = [...votes.values()].reduce((a, b) => a + b, 0);
      const [gameId, weight] = [...votes].sort((a, b) => b[1] - a[1])[0];
      const closeness = Math.min(1, (nearest[0].score - SIMILAR_FROM) / (SIMILAR_SURE - SIMILAR_FROM));
      similar = { title: games.get(gameId)!.title, gameId, confidence: (weight / total) * closeness };
    }

    // The picture alone, against every game name: CLIP's own way of picking one, with its usual scale of 100
    let picture: { title: string; confidence: number } | null = null;
    const scores = [...textVectors].filter(([title]) => allowed(title)).map(([title, t]) => ({ title, logit: 100 * dot(vector, t) }));
    if (scores.length) {
      const top = Math.max(...scores.map((s) => s.logit));
      const total = scores.reduce((sum, s) => sum + Math.exp(s.logit - top), 0);
      const best = scores.find((s) => s.logit === top)!;
      // Guesses from the picture alone are often confidently wrong, so they count for less
      picture = { title: best.title, confidence: 0.8 / total };
    }

    let result: { title: string; confidence: number; source: "similar" | "picture" } | null = null;
    if (similar && picture && ClipNames.key(similar.title) === ClipNames.key(picture.title)) {
      result = { title: similar.title, confidence: 1 - (1 - similar.confidence) * (1 - picture.confidence), source: "similar" };
    }
    else if (similar && (!picture || similar.confidence >= picture.confidence)) result = { ...similar, source: "similar" };
    else if (picture) result = { ...picture, source: "picture" };
    if (!result || result.confidence < MIN_CONFIDENCE) return null;

    const game = [...games.values()].find((g) => ClipNames.key(g.title) === ClipNames.key(result.title)) ?? null;
    return {
      gameId: game?.id ?? null,
      title: game?.title ?? result.title,
      steamAppId: game?.externalIds.steam ?? null,
      confidence: Math.round(result.confidence * 100) / 100,
      source: result.source,
    };
  }

  /**
   * Remember that a clip isn't the game it was suggested to be, so it isn't suggested again.
   */
  export async function dismiss(clip: MediaItem) {
    if (!clip.clip?.suggestion) return;
    clip.clip = { ...clip.clip, notGames: [...new Set([...(clip.clip.notGames ?? []), clip.clip.suggestion.title])], suggestion: null };
    await clip.save();
  }

  //#endregion
}

export default Recognition;
