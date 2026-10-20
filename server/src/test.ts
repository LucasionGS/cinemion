import type { MediaFileInfo } from "@shared/media.ts";
import type { DeviceCapabilities, PlaybackSettings } from "@shared/playback.ts";
import NameParser from "./library/NameParser.ts";
import PlaybackDecider from "./media/PlaybackDecider.ts";
import Network from "./lib/Network.ts";
import UserAgent from "./lib/UserAgent.ts";
import SystemStats from "./lib/SystemStats.ts";
import ArrWebhook from "./integrations/ArrWebhook.ts";
import Webhooks from "./integrations/Webhooks.ts";
import VideoDetails from "./library/VideoDetails.ts";
import Library from "./models/Library.ts";
import Fingerprint from "./media/Fingerprint.ts";

/**
 * Scratch runner for the parts that are easy to get subtly wrong. Run with `deno run -A server/src/test.ts`.
 */

let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "\x1b[32m  ok\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${ok ? "" : `\n       got      ${JSON.stringify(actual)}\n       expected ${JSON.stringify(expected)}`}`);
}

//#region Movies
const movies = "/media/movies";
const movie = (path: string) => {
  const m = NameParser.parseMovie(`${movies}/${path}`, movies);
  return [m.title, m.year];
};
console.log("Movies");
check("folder with year", movie("The Matrix (1999)/The Matrix (1999).mkv"), ["The Matrix", 1999]);
check("release name in root", movie("Blade.Runner.2049.2017.1080p.BluRay.x264-GROUP.mkv"), ["Blade Runner 2049", 2017]);
check("year-like title", movie("2001 A Space Odyssey (1968)/movie.mkv"), ["2001 A Space Odyssey", 1968]);
check("release name, plain folder", movie("Downloads/Arrival.2016.2160p.UHD.BluRay.REMUX.HDR.HEVC.mkv"), ["Arrival", 2016]);
check("version suffix", movie("Northbound (2024)/Northbound (2024) - 1080p.mkv"), ["Northbound", 2024]);
check("no year", movie("Some Home Movie.mp4"), ["Some Home Movie", null]);
check("group tag first", movie("[YTS] Paper Moons (2024) [1080p].mp4"), ["Paper Moons", 2024]);
check("underscores", movie("the_long_meridian_2023_720p.mkv"), ["the long meridian", 2023]);
check("ids from folder", NameParser.parseMovie(`${movies}/Glass Harbor (2025) {tmdb-1234}/glass.harbor.mkv`, movies).ids, { tmdb: "1234" });
check("imdb id", NameParser.extractIds("Movie [imdbid-tt0133093]").ids, { imdb: "tt0133093" });
check("edition", NameParser.parseMovie(`${movies}/Alien (1979) {edition-Director's Cut}/Alien.mkv`, movies).edition, "Director's Cut");
//#endregion

//#region Shows
const shows = "/media/shows";
const ep = (path: string) => {
  const e = NameParser.parseEpisode(`${shows}/${path}`, shows);
  return e && [e.show.title, e.show.year, e.season, e.episode, e.episodeEnd];
};
console.log("Shows");
check("standard", ep("Saltwater Kings (2023)/Season 01/Saltwater Kings - S01E03 - Low Water.mkv"), ["Saltwater Kings", 2023, 1, 3, null]);
check("release name", ep("Ironwood/Season 2/Ironwood.S02E05.1080p.WEB-DL.mkv"), ["Ironwood", null, 2, 5, null]);
check("multi-episode dash", ep("Low Tide/Season 01/Low Tide S01E01-E02.mkv"), ["Low Tide", null, 1, 1, 2]);
check("multi-episode joined", ep("Low Tide/Season 01/Low.Tide.S01E03E04.mkv"), ["Low Tide", null, 1, 3, 4]);
check("1x02", ep("Quarry/Quarry 1x02 The Pit.avi"), ["Quarry", null, 1, 2, null]);
check("specials", ep("Ironwood/Specials/Ironwood S00E01 Making Of.mkv"), ["Ironwood", null, 0, 1, null]);
check("leading number in season folder", ep("Halcyon/Season 03/07 - The Last Summer.mkv"), ["Halcyon", null, 3, 7, null]);
check("Episode word", ep("Halcyon/Season 1/Episode 4.mkv"), ["Halcyon", null, 1, 4, null]);
check("file in root", ep("The.Office.US.S05E10.720p.mkv"), ["The Office US", null, 5, 10, null]);
check("no episode number", ep("Ironwood/Season 01/Ironwood.mkv"), null);
check("episode title", NameParser.parseEpisode(`${shows}/Saltwater Kings/Season 01/Saltwater Kings - S01E02 - Brackish.mkv`, shows)?.title, "Brackish");
check("no episode title from tags", NameParser.parseEpisode(`${shows}/Ironwood/Season 2/Ironwood.S02E05.1080p.WEB-DL.mkv`, shows)?.title, null);
check("episode title with dots", NameParser.parseEpisode(`${shows}/Show/Show.S01E02.The.Long.Night.720p.mkv`, shows)?.title, "The Long Night");
check("show folder", NameParser.parseEpisode(`${shows}/Low Tide/Season 01/x.S01E01.mkv`, shows)?.showFolder, `${shows}/Low Tide`);
//#endregion

//#region Skipping
console.log("Skipping");
check("extras folder", NameParser.shouldSkip("The Matrix (1999)/Extras/Making of.mkv"), true);
check("trailer suffix", NameParser.shouldSkip("The Matrix (1999)/The Matrix-trailer.mkv"), true);
check("sample", NameParser.shouldSkip("Arrival/sample.mkv"), true);
check("hidden", NameParser.shouldSkip(".stfolder/x.mkv"), true);
check("normal", NameParser.shouldSkip("The Matrix (1999)/The Matrix (1999).mkv"), false);
check("movie named Other", NameParser.shouldSkip("Other People (2016)/Other People.mkv"), false);
//#endregion

//#region Playback decisions
console.log("Playback");
const chrome: DeviceCapabilities = { videoCodecs: ["h264", "vp9", "av1"], audioCodecs: ["aac", "mp3", "opus", "flac"], containers: ["mp4", "webm"], hdr: false, maxAudioChannels: 2 };
const settings: PlaybackSettings = { hardwareAcceleration: "none", device: "/dev/dri/renderD128", hardwareDecodeCodecs: [], maxConversions: 4, preset: "balanced", toneMapping: true, remoteMaxBitrate: 8_000_000, allowRemoteConversion: true };
const file = (patch: Partial<MediaFileInfo>): MediaFileInfo => ({
  id: 1, path: "/x", size: 1, container: "mp4", duration: 600, videoCodec: "h264", width: 1920, height: 1080, hdr: null, bitrate: 6_000_000,
  audio: [{ index: 1, codec: "aac", channels: 2, language: "eng", title: null, isDefault: true }],
  subtitles: [],
  ...patch,
});
const decide = (f: MediaFileInfo, patch?: Partial<PlaybackDecider.Request>) => {
  const d = PlaybackDecider.decide(f, { capabilities: chrome, quality: "original", audioIndex: null, subtitleIndex: null, isRemote: false, ...patch }, settings);
  return [d.mode, d.video.action, d.audio?.action ?? null];
};
check("mp4 h264 aac plays directly", decide(file({})), ["direct", "copy", "copy"]);
check("mkv is repackaged", decide(file({ container: "mkv" })), ["remux", "copy", "copy"]);
check("second audio track needs repackaging", decide(file({ audio: [...file({}).audio, { index: 2, codec: "aac", channels: 2, language: "eng", title: "Commentary", isDefault: false }] }), { audioIndex: 2 }), ["remux", "copy", "copy"]);
check("hevc is converted", decide(file({ container: "mkv", videoCodec: "hevc" })), ["transcode", "convert", "copy"]);
check("ac3 audio is converted alone", decide(file({ container: "mkv", audio: [{ index: 1, codec: "ac3", channels: 6, language: null, title: null, isDefault: true }] })), ["transcode", "copy", "convert"]);
check("dts is converted even if listed", decide(file({ audio: [{ index: 1, codec: "dts", channels: 6, language: null, title: null, isDefault: true }] }), { capabilities: { ...chrome, audioCodecs: [...chrome.audioCodecs, "dts"] } }), ["transcode", "copy", "convert"]);
check("hdr on an sdr screen is tone-mapped", PlaybackDecider.decide(file({ hdr: "hdr10" }), { capabilities: chrome, quality: "original", audioIndex: null, subtitleIndex: null, isRemote: false }, settings).video.toneMap, true);
check("hdr on an hdr screen plays", decide(file({ hdr: "hdr10" }), { capabilities: { ...chrome, hdr: true } }), ["direct", "copy", "copy"]);
check("picture subtitles are burned in", decide(file({ subtitles: [{ index: 3, codec: "hdmv_pgs_subtitle", language: null, title: null, isDefault: false, isForced: false, isImage: true, external: false, isHearingImpaired: false }] }), { subtitleIndex: 3 }), ["transcode", "convert", "copy"]);
check("text subtitles don't change the stream", decide(file({ subtitles: [{ index: 3, codec: "subrip", language: null, title: null, isDefault: false, isForced: false, isImage: false, external: false, isHearingImpaired: false }] }), { subtitleIndex: 3 }), ["direct", "copy", "copy"]);
check("720p preset scales down", PlaybackDecider.decide(file({}), { capabilities: chrome, quality: "720p", audioIndex: null, subtitleIndex: null, isRemote: false }, settings).video.height, 720);
check("remote under the limit plays", decide(file({}), { isRemote: true }), ["direct", "copy", "copy"]);
check("remote over the limit is converted", decide(file({ bitrate: 30_000_000 }), { isRemote: true }), ["transcode", "convert", "copy"]);
check("remote bitrate is capped", PlaybackDecider.decide(file({ bitrate: 30_000_000 }), { capabilities: chrome, quality: "original", audioIndex: null, subtitleIndex: null, isRemote: true }, settings).video.bitrate, 8_000_000);
//#endregion

//#region Network
console.log("Network");
check("lan", ["192.168.1.20", "10.0.0.5", "172.20.1.1", "127.0.0.1", "::1", "::ffff:192.168.0.2", "fd12::1"].every(Network.isPrivate), true);
check("internet", ["8.8.8.8", "172.32.0.1", "2a02:1810::1", "100.64.0.1"].some(Network.isPrivate), false);
//#endregion

//#region Sonarr and Radarr
console.log("Sonarr and Radarr");
const mappings = [{ from: "/tv", to: "/media/shows" }, { from: "/tv/kids", to: "/media/kids" }, { from: "D:\\Media\\Movies", to: "/media/movies" }];
check("mapped prefix", ArrWebhook.mapPath("/tv/Low Tide/Season 02/x.mkv", mappings), "/media/shows/Low Tide/Season 02/x.mkv");
check("longest mapping wins", ArrWebhook.mapPath("/tv/kids/Bluey", mappings), "/media/kids/Bluey");
check("prefix must be a whole folder", ArrWebhook.mapPath("/tvshows/x.mkv", mappings), "/tvshows/x.mkv");
check("windows path, any case", ArrWebhook.mapPath("d:\\media\\movies\\Nowhere (2020)\\Nowhere.mkv", mappings), "/media/movies/Nowhere (2020)/Nowhere.mkv");
check("unmapped stays", ArrWebhook.mapPath("/media/shows/x.mkv", mappings), "/media/shows/x.mkv");
const sonarr = ArrWebhook.parse({ eventType: "Download", instanceName: "Sonarr 4K", series: { title: "Low Tide", path: "/tv/Low Tide" }, episodes: [{ seasonNumber: 2, episodeNumber: 4 }], episodeFile: { path: "/tv/Low Tide/Season 02/e4.mkv" } });
check("sonarr import", [sonarr?.app, sonarr?.targets, sonarr?.activity?.message], ["Sonarr 4K", [{ path: "/tv/Low Tide/Season 02/e4.mkv", isFile: true }], "Sonarr 4K imported Low Tide S2 E4"]);
const pack = ArrWebhook.parse({ eventType: "Download", series: { title: "Low Tide", path: "/tv/Low Tide" }, episodes: [{ seasonNumber: 2, episodeNumber: 1 }, { seasonNumber: 2, episodeNumber: 2 }], episodeFile: { relativePath: "Season 02/e1-e2.mkv" } });
check("season pack, relative path", [pack?.targets[0].path, pack?.activity?.message], ["/tv/Low Tide/Season 02/e1-e2.mkv", "Sonarr imported Low Tide season 2 (2 episodes)"]);
check("upgrade delete is quiet", ArrWebhook.parse({ eventType: "EpisodeFileDelete", series: { title: "x", path: "/tv/x" }, episodeFile: { path: "/tv/x/a.mkv" }, deleteReason: "upgrade" })?.activity, null);
check("show removed without files does nothing", ArrWebhook.parse({ eventType: "SeriesDelete", series: { title: "x", path: "/tv/x" }, deletedFiles: false })?.targets, []);
const radarr = ArrWebhook.parse({ eventType: "Download", isUpgrade: true, movie: { title: "Nowhere", year: 2020, folderPath: "/movies/Nowhere (2020)" }, movieFile: { relativePath: "Nowhere.mkv" } });
check("radarr upgrade", [radarr?.app, radarr?.targets[0].path, radarr?.activity?.message], ["Radarr", "/movies/Nowhere (2020)/Nowhere.mkv", "Radarr upgraded Nowhere (2020)"]);
check("rename scans the folder", ArrWebhook.parse({ eventType: "Rename", movie: { title: "x", folderPath: "/movies/x" } })?.targets, [{ path: "/movies/x", isFile: false }]);
check("grab is ignored", ArrWebhook.parse({ eventType: "Grab", series: { title: "x", path: "/tv/x" } })?.targets, []);
check("not a webhook", ArrWebhook.parse({ hello: "world" }), null);
//#endregion

//#region Videos
console.log("Videos");
check("underscores", VideoDetails.titleFromFile("/v/Beach_day.mp4"), "Beach day");
check("camera name", VideoDetails.titleFromFile("/v/DJI_0042.MP4"), "DJI 0042");
check("dots", VideoDetails.titleFromFile("/v/My.Holiday.2024.mov"), "My Holiday 2024");
check("spaces kept as they are", VideoDetails.titleFromFile("/v/Our short film-trailer.mkv"), "Our short film-trailer");
check("mixed keeps underscores", VideoDetails.titleFromFile("/v/Mira at 8_final cut.mp4"), "Mira at 8_final cut");
check("thumbnail a tenth in", VideoDetails.automaticTime(90), 9);
check("thumbnail at most a minute in", VideoDetails.automaticTime(7200), 60);
check("thumbnail without length", VideoDetails.automaticTime(null), 0);
//#endregion

//#region Library folders
console.log("Library folders");
check("same folder overlaps", Library.overlaps("/m/movies", "/m/movies/"), true);
check("folder inside overlaps", Library.overlaps("/m/movies/kids", "/m/movies"), true);
check("folder around overlaps", Library.overlaps("/m", "/m/shows"), true);
check("similar names don't overlap", Library.overlaps("/m/movies", "/m/movies2"), false);
check("siblings don't overlap", Library.overlaps("/m/movies", "/m/shows"), false);
const libs = [{ name: "Videos", paths: ["/m/movies", "/m/shows"] }];
check("taken folder is explained", Library.overlapProblem("/m/movies", libs)?.includes(`"Videos"`), true);
check("inside a taken folder", Library.overlapProblem("/m/movies/kids", libs)?.includes("is inside a folder"), true);
check("free folder", Library.overlapProblem("/m/videos", libs), null);
let nested = "";
try {
  Library.verifyPaths(["/m/movies", "/m/movies/kids"], "Movies");
} catch (error) {
  nested = (error as Error).message;
}
check("nested folders in one library are refused", nested.startsWith("The folders"), true);
check("duplicate folders are merged", Library.verifyPaths(["/m/movies", "/m/movies/"], "Movies"), ["/m/movies"]);
//#endregion

//#region Intro detection
console.log("Intro detection");
{
  const rate = Fingerprint.SAMPLE_RATE;
  // Repeatable noise, standing in for the dialogue that differs between episodes
  const noise = (seconds: number, seed: number) => {
    const out = new Float64Array(Math.round(seconds * rate));
    // xorshift32 keeps to 32-bit integers, so the numbers stay exact
    let x = seed * 2654435761 >>> 0 || 1;
    for (let i = 0; i < out.length; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      out[i] = (x / 4294967296 - 0.5) * 0.5;
    }
    return out;
  };
  // A tune of stepping notes, standing in for the opening theme every episode shares
  const tune = (seconds: number) => {
    const out = new Float64Array(Math.round(seconds * rate));
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      out[i] = 0.4 * Math.sin(2 * Math.PI * (330 + 110 * Math.floor((t * 3) % 6)) * t) + 0.2 * Math.sin(2 * Math.PI * (660 + 55 * Math.floor((t * 1.5) % 4)) * t);
    }
    return out;
  };
  const join = (...parts: Float64Array[]) => {
    const pcm = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) for (const v of part) pcm[at++] = Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
    return pcm;
  };
  const a = Fingerprint.compute(join(noise(8, 1), tune(20), noise(30, 2)), 0);
  const b = Fingerprint.compute(join(noise(12, 3), tune(20), noise(30, 4)), 0);
  const c = Fingerprint.compute(join(noise(58, 5)), 0);
  const match = Fingerprint.longestMatch(a, b, 10);
  const near = (x: number | undefined, y: number) => x !== undefined && Math.abs(x - y) <= 1;
  check("shared tune is found in both", [near(match?.aStart, 8), near(match?.aEnd, 28), near(match?.bStart, 12), near(match?.bEnd, 32)], [true, true, true, true]);
  check("different sound doesn't match", Fingerprint.longestMatch(a, c, 10), null);
}
//#endregion

//#region Webhooks
console.log("Webhooks");
// Known HMAC-SHA256 test vector
check("signature", await Webhooks.sign("key", "The quick brown fox jumps over the lazy dog"), "sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
//#endregion

//#region Dashboard
console.log("Dashboard");
check("proc stat", SystemStats.parseProcStat("cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3 4"), { busy: 150, total: 1000 });
const df = "Filesystem     1024-blocks       Used Available Capacity Mounted on\n/dev/sda1 1000 600 300 67% /media\n/dev/sdb1 2000 500 1500 25% /mnt/big disk\n/dev/sda1 1000 600 300 67% /media\n";
check("df, one entry per drive", SystemStats.parseDf(df), { used: 1100 * 1024, total: 2900 * 1024, mounts: ["/media", "/mnt/big disk"] });
const ua = {
  chrome: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0",
  tizen: "Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/5.0 Chrome/94.0 TV Safari/537.36",
};
check("desktop chrome", UserAgent.describe(ua.chrome), "Desktop · Chrome");
check("iphone safari", UserAgent.describe(ua.iphone), "Phone · Safari");
check("edge isn't chrome", UserAgent.describe(ua.edge), "Desktop · Edge");
check("smart tv", UserAgent.describe(ua.tizen), "TV · Samsung Internet");
check("tv layout on a pc", UserAgent.describe(ua.chrome, "tv"), "TV · Chrome");
check("phrase", UserAgent.phrase("Phone · Safari"), "a phone with Safari");
//#endregion

console.log(failed ? `\n${failed} failed` : "\nAll passed");
Deno.exit(failed ? 1 : 0);
