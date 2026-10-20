import NameParser from "./library/NameParser.ts";

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

console.log(failed ? `\n${failed} failed` : "\nAll passed");
Deno.exit(failed ? 1 : 0);
