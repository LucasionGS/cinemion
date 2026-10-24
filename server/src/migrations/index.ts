import * as initial from "./20261020120000-initial.ts";
import * as media from "./20261021090000-media.ts";
import * as browsing from "./20261022090000-browsing.ts";
import * as extras from "./20261023090000-extras.ts";
import * as admin from "./20261024090000-admin.ts";
import * as videos from "./20261025090000-videos.ts";
import * as playbackExtras from "./20261026090000-playback-extras.ts";
import * as music from "./20261027090000-music.ts";
import * as books from "./20261028090000-books.ts";
import * as traktRatings from "./20261029090000-trakt-ratings.ts";
import * as subtitleSearches from "./20261030090000-subtitle-searches.ts";
import * as downloads from "./20261031090000-downloads.ts";
import * as photos from "./20261101090000-photos.ts";
import * as clips from "./20261102090000-clips.ts";
import * as uploadHashes from "./20261103090000-upload-hashes.ts";
import * as watchlist from "./20261104090000-watchlist.ts";
import * as notifications from "./20261105090000-notifications.ts";

/**
 * Every migration, oldest first. Listed by hand (not globbed) so they're included in compiled binaries.
 * Add new migrations at the end with a timestamp-prefixed name.
 */
export const migrations = [
  { name: "20261020120000-initial", ...initial },
  { name: "20261021090000-media", ...media },
  { name: "20261022090000-browsing", ...browsing },
  { name: "20261023090000-extras", ...extras },
  { name: "20261024090000-admin", ...admin },
  { name: "20261025090000-videos", ...videos },
  { name: "20261026090000-playback-extras", ...playbackExtras },
  { name: "20261027090000-music", ...music },
  { name: "20261028090000-books", ...books },
  { name: "20261029090000-trakt-ratings", ...traktRatings },
  { name: "20261030090000-subtitle-searches", ...subtitleSearches },
  { name: "20261031090000-downloads", ...downloads },
  { name: "20261101090000-photos", ...photos },
  { name: "20261102090000-clips", ...clips },
  { name: "20261103090000-upload-hashes", ...uploadHashes },
  { name: "20261104090000-watchlist", ...watchlist },
  { name: "20261105090000-notifications", ...notifications },
];
