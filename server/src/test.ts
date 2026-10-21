import type { MediaFileInfo } from "@shared/media.ts";
import type { DeviceCapabilities, PlaybackSettings } from "@shared/playback.ts";
import NameParser from "./library/NameParser.ts";
import PlaybackDecider from "./media/PlaybackDecider.ts";
import Network from "./lib/Network.ts";
import UserAgent from "./lib/UserAgent.ts";
import SystemStats from "./lib/SystemStats.ts";
import ArrWebhook from "./integrations/ArrWebhook.ts";
import CompatApi from "./integrations/CompatApi.ts";
import Webhooks from "./integrations/Webhooks.ts";
import VideoDetails from "./library/VideoDetails.ts";
import Library from "./models/Library.ts";
import Fingerprint from "./media/Fingerprint.ts";
import MusicTags from "./music/MusicTags.ts";
import BookLibrary from "./books/BookLibrary.ts";
import Epub from "./books/Epub.ts";
import Omdb from "./metadata/Omdb.ts";
import TvdbProvider from "./metadata/providers/TvdbProvider.ts";
import MetadataManager from "./metadata/MetadataManager.ts";
import SubtitleProvider from "./subtitles/SubtitleProvider.ts";
import SubtitleAutomation from "./subtitles/SubtitleAutomation.ts";
import { zipSync } from "fflate";
import ZipReader from "./lib/ZipReader.ts";
import Uploads from "./library/Uploads.ts";
import type { SubtitleSearchResult } from "@shared/playback.ts";
import type MediaFile from "./models/MediaFile.ts";
import { parseLrc } from "@shared/music.ts";

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

// Automatic quality
const ladder = (height: number, cap: number | null) => PlaybackDecider.ladderFor(height, cap).map((r) => r.height);
check("4k source gets the top three rungs", ladder(2160, null), [1080, 720, 480]);
check("720p source never scales up", ladder(720, null), [720, 480, 360]);
check("tiny source keeps the smallest rung", ladder(240, null), [360]);
check("remote cap drops big rungs", ladder(1080, 2_000_000), [480]);
check("cap below every rung keeps the smallest", ladder(1080, 100_000), [480]);
const auto = PlaybackDecider.decide(file({}), { capabilities: chrome, quality: "auto", audioIndex: null, subtitleIndex: null, isRemote: false }, settings);
check("auto converts with a ladder", [auto.mode, auto.video.action, auto.video.ladder?.length], ["transcode", "convert", 3]);
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

//#region Music
console.log("Music");
const music = (path: string, tags: Record<string, string> = {}) => {
  const d = MusicTags.details(`/music/${path}`, tags, "/music");
  return [d.albumArtist, d.album, d.disc, d.number, d.title, d.artist];
};
check("tagged track", music("x.mp3", { title: "Departure", artist: "Harbour Lights", album: "Night Ferry", track: "1/4", disc: "1/1" }), ["Harbour Lights", "Night Ferry", 1, 1, "Departure", "Harbour Lights"]);
check("album artist wins", music("x.m4a", { title: "Route 1", artist: "June Okafor", album_artist: "Various Artists", album: "Coastal Roads", track: "2" })[0], "Various Artists");
check("compilation flag", music("x.m4a", { title: "Song", artist: "Someone", album: "Hits", compilation: "1" })[0], "Various Artists");
check("folders without tags", music("Saltmarsh/Low Tide (2019)/03 - Shallows.flac"), ["Saltmarsh", "Low Tide", null, 3, "Shallows", "Saltmarsh"]);
check("disc in the file name", music("Band/Album/2-05 Song.mp3").slice(2, 5), [2, 5, "Song"]);
check("loose file", music("Morning birds.ogg").slice(0, 2), [MusicTags.UNKNOWN_ARTIST, MusicTags.UNKNOWN_ALBUM]);
check("same artist, other spelling", MusicTags.key("Beyoncé  Knowles") === MusicTags.key("beyonce knowles"), true);
check("lyric tags aren't kept", Object.keys(MusicTags.clean({ TITLE: "A", "lyrics-eng": "la la", ENCODER: "x" })), ["title"]);
check("lrc lines", parseLrc("[ar:Someone]\n[00:05.00]Two\n[00:01.50][00:10.00]One"), [{ time: 1.5, text: "One" }, { time: 5, text: "Two" }, { time: 10, text: "One" }]);
check("no stamps is plain", parseLrc("Just words\nmore words"), null);
//#endregion

//#region Books
console.log("Books");
const part = (id: number, path: string, duration: number, tags: Record<string, string> = {}, chapters: { title: string | null; start: number; end: number }[] | null = null) =>
  ({ id, path, duration, tags, chapters }) as unknown as MediaFile;
const book = BookLibrary.layout([
  part(2, "/b/Book/CD2/01 Part.mp3", 100, { disc: "2", track: "1", title: "Part Three" }),
  part(1, "/b/Book/CD1/02 Part.mp3", 50, { disc: "1", track: "2" }),
  part(3, "/b/Book/CD1/01 Part.mp3", 60, { disc: "1", track: "1", title: "Opening" }),
]);
check("parts in disc and track order", book.parts.map((p) => [p.fileId, p.offset]), [[3, 0], [1, 60], [2, 110]]);
check("one chapter per file without marks", book.chapters.map((c) => [c.title, c.start]), [["Opening", 0], ["Part", 60], ["Part Three", 110]]);
const marked = BookLibrary.layout([part(9, "/b/Book.m4b", 90, {}, [{ title: "One", start: 0, end: 45 }, { title: null, start: 45, end: 90 }])]);
check("chapter marks inside a file", marked.chapters.map((c) => [c.title, c.start, c.end]), [["One", 0, 45], ["Chapter 2", 45, 90]]);
check("natural file order", BookLibrary.orderFiles([part(1, "/b/Part 10.mp3", 1), part(2, "/b/Part 9.mp3", 1)]).map((f) => f.id), [2, 1]);
check("escaped html description", Epub.plain("&lt;p&gt;Tides &amp;amp; ferries&lt;/p&gt;&lt;p&gt;More&lt;/p&gt;"), "Tides & ferries\nMore");
//#endregion

//#region Metadata sources
console.log("Metadata sources");
check("omdb ratings", Omdb.parse({ imdbRating: "7.1", imdbVotes: "2,001", Metascore: "N/A", Ratings: [{ Source: "Rotten Tomatoes", Value: "91%" }, { Source: "Metacritic", Value: "68/100" }] }), { imdb: 7.1, imdbVotes: 2001, rottenTomatoes: 91, metacritic: 68 });
check("omdb without ratings", Omdb.parse({ imdbRating: "N/A", imdbVotes: "N/A", Metascore: "N/A" }), { imdb: null, imdbVotes: null, rottenTomatoes: null, metacritic: null });
check("tvdb language codes", ["en", "nl", "de", "fr", "ja"].map(TvdbProvider.languageCode), ["eng", "nld", "deu", "fra", "jpn"]);
check("older settings get new sources", MetadataManager.normalizeSettings({ tmdbApiKey: "k", providers: ["tmdb", "local"] }).providers, ["tmdb", "local", "tvdb"]);
check("unknown sources are dropped", MetadataManager.normalizeSettings({ providers: ["gone", "local"] }).providers, ["local", "tmdb", "tvdb"]);
//#endregion

//#region Subtitle sources
console.log("Subtitle sources");
const encoded = (t: string) => new TextEncoder().encode(t);
const seasonPack = zipSync({ "Show.S01E01.srt": encoded("one"), "Show.S01E02.srt": encoded("two"), "Show.S01E10.srt": encoded("ten"), "info.nfo": encoded("x") });
const unzipText = (episode?: { season: number | null; number: number | null }) => new TextDecoder().decode(SubtitleProvider.fromZip(seasonPack, episode).content);
check("season pack picks the episode", [unzipText({ season: 1, number: 2 }), unzipText({ season: 1, number: 10 })], ["two", "ten"]);
let missingEpisode = "";
try {
  unzipText({ season: 1, number: 3 });
} catch (error) {
  missingEpisode = (error as Error).message;
}
check("season pack without the episode", missingEpisode, "The season pack has no subtitle file for this episode.");
check("single file zip", new TextDecoder().decode(SubtitleProvider.fromZip(zipSync({ "Movie.en.srt": encoded("movie") }), { season: 1, number: 3 }).content), "movie");
const searched = (attempts: number, daysAgo: number, found = false) => ({ subtitleSearches: { en: { at: Date.now() - daysAgo * 86_400_000, attempts, found } } }) as unknown as MediaFile;
check("retry waits longer each time", [SubtitleAutomation.isDue(searched(1, 0.5), "en"), SubtitleAutomation.isDue(searched(1, 1.5), "en"), SubtitleAutomation.isDue(searched(3, 5), "en"), SubtitleAutomation.isDue(searched(3, 8), "en")], [false, true, false, true]);
check("found or given up isn't searched", [SubtitleAutomation.isDue(searched(1, 99, true), "en"), SubtitleAutomation.isDue(searched(7, 999), "en"), SubtitleAutomation.isDue({ subtitleSearches: null } as unknown as MediaFile, "en")], [false, false, true]);
const result = (provider: string, extra: Partial<SubtitleSearchResult>): SubtitleSearchResult => ({ provider, id: provider + JSON.stringify(extra), name: "", language: "en", isHearingImpaired: false, matchesFile: false, downloads: 0, rating: null, uploadedAt: null, notes: [], ...extra });
const ranked = SubtitleAutomation.rank([
  result("podnapisi", { downloads: 900 }),
  result("subdl", { isHearingImpaired: true }),
  result("opensubtitles", { notes: ["Translated by AI"], matchesFile: true }),
  result("subdl", { language: "nl" }),
  result("opensubtitles", { matchesFile: true }),
  result("subdl", {}),
], "en", ["opensubtitles", "subdl", "podnapisi"]);
check("automatic pick order", ranked.map((r) => [r.provider, r.matchesFile, r.isHearingImpaired]), [["opensubtitles", true, false], ["subdl", false, false], ["podnapisi", false, false], ["subdl", false, true]]);
//#endregion

//#region Apps that speak another media server's API
console.log("App API");
check("item id", CompatApi.encodeId("item", 18), "c0000000000000000000000000000012");
check("ids round trip", [CompatApi.decodeId("user", CompatApi.encodeId("user", 7)), CompatApi.decodeId("library", CompatApi.encodeId("library", 123456))], [7, 123456]);
check("id of another kind", CompatApi.decodeId("library", CompatApi.encodeId("item", 3)), null);
check("id with dashes and capitals", CompatApi.decodeId("item", "C0000000-0000-0000-0000-000000000012"), 18);
check("not an id", [CompatApi.decodeId("item", "Me"), CompatApi.decodeId("item", "c0"), CompatApi.decodeId("item", null)], [null, null, null]);
check("app item types", CompatApi.itemTypesFor(["Series", "Movie", "Others", "episode"]), ["show", "movie", "episode"]);
//#endregion

//#region Uploads
console.log("Uploads");
check("clean path", Uploads.cleanPath("Season 1\\Episode 1.mkv"), "Season 1/Episode 1.mkv");
check("leading slash and dots", Uploads.cleanPath("/./Show/./S01/x.mkv"), "Show/S01/x.mkv");
const refused = (path: string) => {
  try {
    Uploads.cleanPath(path);
    return false;
  } catch {
    return true;
  }
};
check("unsafe paths", ["../x.mkv", "a/../../x.mkv", ".hidden/x.mkv", "C:/x.mkv", "", "a/\u0000b.mkv"].map(refused), [true, true, true, true, true, true]);
check("library takes", [Uploads.accepts("movies", "a/Movie.MKV"), Uploads.accepts("movies", "Movie.en.srt"), Uploads.accepts("movies", "setup.exe"), Uploads.accepts("music", "01.flac"), Uploads.accepts("books", "x.mkv")], [true, true, false, true, false]);
const zipDir = await Deno.makeTempDir();
const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 7) % 251);
const zipPath = `${zipDir}/test.zip`;
await Deno.writeFile(zipPath, zipSync({ "Show/Season 1/E01.mkv": [big, { level: 0 }], "Show/Season 1/E01.en.srt": [encoded("hello"), { level: 9 }], "Show/": new Uint8Array(0) }));
const unzipped = async (path: string) => {
  const reader = await ZipReader.open(path);
  const out: Record<string, number> = {};
  for (const entry of reader.entries.filter((e) => !e.isDirectory)) {
    let length = 0;
    for await (const chunk of await reader.stream(entry)) length += chunk.length;
    out[entry.name] = length;
  }
  reader.close();
  return out;
};
check("zip stored and deflated", await unzipped(zipPath), { "Show/Season 1/E01.mkv": big.length, "Show/Season 1/E01.en.srt": 5 });
// Info-ZIP's -fz writes zip64 records even for small files
const zip64 = await new Deno.Command("zip", { args: ["-q", "-fz", "-j", `${zipDir}/z64.zip`, zipPath], stderr: "null" }).output().catch(() => null);
if (zip64?.success) check("zip64", Object.values(await unzipped(`${zipDir}/z64.zip`)), [(await Deno.stat(zipPath)).size]);
const damaged = await Deno.readFile(zipPath);
damaged[200] ^= 0xff;
await Deno.writeFile(`${zipDir}/damaged.zip`, damaged);
check("damaged entry fails its checksum", await unzipped(`${zipDir}/damaged.zip`).then(() => "read").catch((e: Error) => e.message), "\"Show/Season 1/E01.mkv\" in the zip file is damaged: its checksum doesn't match.");
check("not a zip", await ZipReader.open(`${zipDir}/../`).then(() => "opened").catch(() => "refused"), "refused");
await Deno.remove(zipDir, { recursive: true });
//#endregion

console.log(failed ? `\n${failed} failed` : "\nAll passed");
Deno.exit(failed ? 1 : 0);
