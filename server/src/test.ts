import type { MediaFileInfo } from "@shared/media.ts";
import type { DeviceCapabilities, PlaybackSettings } from "@shared/playback.ts";
import NameParser from "./library/NameParser.ts";
import PlaybackDecider from "./media/PlaybackDecider.ts";
import Network from "./lib/Network.ts";

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
check("picture subtitles are burned in", decide(file({ subtitles: [{ index: 3, codec: "hdmv_pgs_subtitle", language: null, title: null, isDefault: false, isForced: false, isImage: true }] }), { subtitleIndex: 3 }), ["transcode", "convert", "copy"]);
check("text subtitles don't change the stream", decide(file({ subtitles: [{ index: 3, codec: "subrip", language: null, title: null, isDefault: false, isForced: false, isImage: false }] }), { subtitleIndex: 3 }), ["direct", "copy", "copy"]);
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

console.log(failed ? `\n${failed} failed` : "\nAll passed");
Deno.exit(failed ? 1 : 0);
