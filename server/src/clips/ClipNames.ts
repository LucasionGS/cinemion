import Path from "node:path";

/**
 * Reads what game recorders put in their file and folder names: the game, when it was recorded, and anything else
 * someone typed in. Recorders name files differently, so this knows the common patterns:
 *
 * - NVIDIA's overlay: `Counter-strike 2/Counter-strike 2 2024.03.15 - 21.04.33.02.DVR.mp4`
 * - AMD's software: `Radeon ReLive/Counter-strike 2/Counter-strike 2_replay_2024.03.15-21.04.mp4`
 * - Xbox Game Bar: `Captures/Counter-Strike 2 2024-03-15 21-04-33.mp4`
 * - OBS: `2024-03-15 21-04-33.mkv`, or `Replay 2024-03-15 21-04-33.mkv` from the replay buffer
 * - PlayStation: `Counter-Strike 2_20240315210433.mp4`
 * - Steam game recordings: `clip_730_20240315_210433`
 * - Folders per game, made by Medal, Outplayed and other tools, or by hand
 */
export namespace ClipNames {
  export interface Parsed {
    /**
     * The game's name as written, like "Counter-strike 2". `null` = no game in the names.
     */
    hint: string | null;
    /**
     * Where `hint` came from.
     */
    source: "file" | "folder" | "steam" | null;
    /**
     * Steam app id from a Steam game recording's name.
     */
    steamAppId: string | null;
    /**
     * When it was recorded, if the name says: `YYYY-MM-DDTHH:MM:SS`. Names with only a day end in `T00:00:00`, with
     * `dateOnly` set.
     */
    recordedAt: string | null;
    dateOnly: boolean;
    /**
     * The recorder says it's a recording of the desktop, not of a game.
     */
    desktop: boolean;
    /**
     * What's left of the file name besides the game and the date, when someone named the clip themselves.
     */
    title: string | null;
  }

  /**
   * Folder names that hold clips without being a game: recorders' own folders, and ways of sorting by date.
   */
  const GENERIC_FOLDERS = new Set([
    "videos", "video", "captures", "capture", "clips", "clip", "replays", "replay", "recordings", "recording", "highlights",
    "radeon relive", "relive", "amd", "nvidia", "shadowplay", "geforce experience", "nvidia app", "medal", "outplayed",
    "obs", "obs studio", "steam", "gamerecordings", "game recordings", "xbox", "game bar", "xbox game bar", "playstation",
    "ps4", "ps5", "switch", "nintendo switch", "album", "insights capture", "steelseries moments", "moments", "desktop",
    "screen recordings", "screen recording", "my videos", "movies", "gaming", "games", "game clips", "gameclips",
    "trimmed", "exports", "exported", "new folder", "misc", "other", "unsorted", "temp",
  ]);

  // The part before the date that isn't a game: OBS's replay buffer, desktop recordings and the like
  const GENERIC_PREFIXES = new Set(["replay", "desktop", "clip", "recording", "screen recording", "video", "capture", "captured", "obs", "medal", "highlight", "instant replay"]);

  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

  /**
   * Short names and program names people and recorders use, by `key()`, with the game they stand for.
   */
  const ALIASES: Record<string, string> = {
    cs2: "Counter-Strike 2",
    csgo: "Counter-Strike: Global Offensive",
    r6: "Tom Clancy's Rainbow Six Siege",
    r6s: "Tom Clancy's Rainbow Six Siege",
    rainbowsix: "Tom Clancy's Rainbow Six Siege",
    rainbowsixsiege: "Tom Clancy's Rainbow Six Siege",
    pubg: "PUBG: BATTLEGROUNDS",
    tslgame: "PUBG: BATTLEGROUNDS",
    rl: "Rocket League",
    rocketleague: "Rocket League",
    gta5: "Grand Theft Auto V",
    gtav: "Grand Theft Auto V",
    lol: "League of Legends",
    leagueoflegends: "League of Legends",
    wow: "World of Warcraft",
    ow: "Overwatch 2",
    ow2: "Overwatch 2",
    bg3: "Baldur's Gate 3",
    rdr2: "Red Dead Redemption 2",
    tf2: "Team Fortress 2",
    dbd: "Dead by Daylight",
    valo: "VALORANT",
    valorant: "VALORANT",
    r5apex: "Apex Legends",
    apex: "Apex Legends",
    fortniteclient: "Fortnite",
    eft: "Escape from Tarkov",
    tarkov: "Escape from Tarkov",
    poe: "Path of Exile",
    poe2: "Path of Exile 2",
    dota: "Dota 2",
    sot: "Sea of Thieves",
    hd2: "HELLDIVERS 2",
    ffxiv: "FINAL FANTASY XIV Online",
    mc: "Minecraft",
    minecraft: "Minecraft",
  };

  /**
   * How names are compared: lowercase letters and digits only, so "Counter-Strike 2", "counter strike 2" and
   * "CounterStrike2" are the same game.
   */
  export function key(name: string) {
    return name.replace(/[™®©]/g, "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  }

  /**
   * The full name of a short or program name ("CS2", "r5apex"), or `null` when it isn't one.
   */
  export function alias(name: string) {
    return ALIASES[key(name)] ?? null;
  }

  /**
   * A game name as shown: without trademark signs and extra spaces. Names that only use underscores or dots between
   * words get spaces.
   */
  export function cleanGameName(name: string) {
    let clean = name.replace(/[™®©]/g, "");
    if (!/\s/.test(clean)) clean = clean.replace(/[_.]+/g, " ");
    // Program names: "VALORANT-Win64-Shipping", "FortniteClient-Win64-Shipping.exe"
    clean = clean.replace(/\.exe$/i, "").replace(/-Win(?:32|64)-Shipping$/i, "");
    return clean.replace(/\s+/g, " ").trim();
  }

  interface DateMatch {
    index: number;
    length: number;
    recordedAt: string;
    dateOnly: boolean;
    steamAppId?: string;
  }

  function validDate(y: string, mo: string, d: string, h = "00", mi = "00", s = "00") {
    const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number);
    if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  }

  // Each pattern gives year, month, day and optionally hours, minutes and seconds, in that order (US dates are turned
  // around below). Tried in this order; the first that fits wins.
  const PATTERNS: { regex: RegExp; us?: boolean; dateOnly?: boolean }[] = [
    // Example: 2024.03.15 - 21.04.33.02
    { regex: /(?<!\d)(\d{4})\.(\d{2})\.(\d{2}) - (\d{2})\.(\d{2})\.(\d{2})(?:\.\d+)?/ },
    // Example: 2024.03.15-21.04 or 2024.03.15-21.04.33
    { regex: /(?<!\d)(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})(?:\.(\d{2}))?(?!\d)/ },
    // Example: 2024-03-15 21-04-33, 2024-03-15_21-04-33, 2024_03_15_21_04_33, 2024-03-15T21:04:33
    { regex: /(?<!\d)(\d{4})[-_.](\d{2})[-_.](\d{2})[ T_-](\d{2})[-_.:h](\d{2})(?:[-_.:m](\d{2}))?(?!\d)/ },
    // Example: 03-15-2024_21-04-33-123
    { regex: /(?<!\d)(\d{2})-(\d{2})-(\d{4})[ _](\d{2})-(\d{2})-(\d{2})(?:-\d+)?(?!\d)/, us: true },
    // Example: 20240315210433, 20240315_210433, 2024031521043300
    { regex: /(?<!\d)(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})(?:\d{2})?(?!\d)/ },
    // Example: 2024-03-15, 2024_03_15
    { regex: /(?<!\d)(\d{4})[-_.](\d{2})[-_.](\d{2})(?!\d)/, dateOnly: true },
    // Example: 20240315
    { regex: /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/, dateOnly: true },
  ];

  function findDate(name: string): DateMatch | null {
    // Example: clip_730_20240315_210433
    const steam = name.match(/(?:^|[^a-z])(?:clip|bg|fg|timeline)_(\d{1,8})_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i);
    if (steam) {
      const recordedAt = validDate(steam[2], steam[3], steam[4], steam[5], steam[6], steam[7]);
      if (recordedAt) return { index: steam.index!, length: steam[0].length, recordedAt, dateOnly: false, steamAppId: steam[1] };
    }
    for (const pattern of PATTERNS) {
      const match = name.match(pattern.regex);
      if (!match) continue;
      const parts = match.slice(1).map((p) => p ?? "00");
      const recordedAt = pattern.us ? validDate(parts[2], parts[0], parts[1], parts[3], parts[4], parts[5]) : validDate(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
      if (recordedAt) return { index: match.index!, length: match[0].length, recordedAt, dateOnly: !!pattern.dateOnly };
    }
    return null;
  }

  /**
   * Clean what's around the date in a file name: separators, recorder suffixes (".DVR", "_replay") and counters.
   */
  function tidy(text: string) {
    return text
      .replace(/^MedalTV/i, "")
      .replace(/[_ ]replay[_ ]?$/i, "")
      .replace(/^\.?DVR\b/i, "")
      .replace(/^[\s\-_.,]+|[\s\-_.,]+$/g, "")
      // Counters ("(2)", "_01") and the Switch's game ids aren't titles
      .replace(/^\(\d+\)$|^\d{1,3}$|^[0-9A-F]{32}$/, "")
      .trim();
  }

  function isGenericFolder(name: string) {
    const lower = name.toLowerCase().replace(/[_]+/g, " ").trim();
    if (GENERIC_FOLDERS.has(lower)) return true;
    // Folders by year, month or day: 2024, 2024-03, March, 03 March 2024
    if (/^\d{1,4}([-_. ]\d{1,2}){0,2}$/.test(lower)) return true;
    if (MONTHS.some((m) => lower === m || lower.startsWith(`${m} `) || lower.endsWith(` ${m}`))) return true;
    const date = findDate(name);
    return date !== null && tidy(name.slice(0, date.index) + name.slice(date.index + date.length)).length === 0;
  }

  /**
   * Read a clip's path: the game from the file name or the nearest folder that's a game, when it was recorded, and
   * the clip's own title.
   */
  export function parse(path: string, root: string): Parsed {
    const name = Path.parse(path).name;
    const date = findDate(name);
    let fileHint: string | null = null;
    let title: string | null = null;
    let desktop = false;

    if (date) {
      const before = tidy(name.slice(0, date.index));
      const after = tidy(name.slice(date.index + date.length).replace(/^\.?DVR\b/i, ""));
      desktop = key(before) === "desktop";
      if (before && !GENERIC_PREFIXES.has(before.toLowerCase()) && !date.steamAppId) fileHint = cleanGameName(before);
      title = after ? cleanGameName(after) : null;
    }
    else {
      title = cleanGameName(name) || null;
    }

    // The nearest folder that names a game
    let folderHint: string | null = null;
    let dir = Path.dirname(path);
    const top = Path.resolve(root);
    while (Path.resolve(dir).startsWith(top + Path.sep)) {
      const base = Path.basename(dir);
      if (!isGenericFolder(base)) {
        folderHint = cleanGameName(base);
        break;
      }
      dir = Path.dirname(dir);
    }

    // Names glued together ("RocketLeague", from some tools) read worse than the folder's
    if (fileHint && folderHint && !/[\s\-:]/.test(fileHint) && /[a-z][A-Z]|[a-zA-Z]\d/.test(fileHint)) fileHint = null;
    const base = { recordedAt: date?.recordedAt ?? null, dateOnly: date?.dateOnly ?? false, desktop, title };
    if (date?.steamAppId) return { ...base, hint: folderHint, source: "steam", steamAppId: date.steamAppId };
    if (desktop) return { ...base, hint: null, source: null, steamAppId: null };
    if (fileHint) return { ...base, hint: fileHint, source: "file", steamAppId: null };
    if (folderHint) return { ...base, hint: folderHint, source: "folder", steamAppId: null };
    return { ...base, hint: null, source: null, steamAppId: null };
  }

  /**
   * A game named in the tags inside a file (some recorders and editors write one), or `null`.
   */
  export function fromTags(tags: Record<string, string> | null) {
    if (!tags) return null;
    const lower = Object.fromEntries(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]));
    const value = lower["game"] ?? lower["com.apple.quicktime.game"] ?? null;
    return value?.trim() ? cleanGameName(value) : null;
  }

  /**
   * "15 March 2024, 21:04", for clips without a title of their own.
   */
  export function formatRecorded(recordedAt: string) {
    const [date, time] = recordedAt.split("T");
    const [y, m, d] = date.split("-").map(Number);
    const month = MONTHS[m - 1];
    const day = `${d} ${month[0].toUpperCase()}${month.slice(1)} ${y}`;
    return time && time !== "00:00:00" ? `${day}, ${time.slice(0, 5)}` : day;
  }
}

export default ClipNames;
