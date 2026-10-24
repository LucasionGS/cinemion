import type { ProfileColor } from "./profiles.ts";

/**
 * Types for statistics: time spent watching, listening and reading, the titles it went to, and a year in review.
 */

export type StatsPeriod = "week" | "month" | "year" | "all";

/**
 * Seconds of each.
 */
export interface TimeSplit {
  watching: number;
  listening: number;
  reading: number;
}

export interface StatsBucket extends TimeSplit {
  /**
   * The day (`2026-10-25`) or month (`2026-10`) it covers.
   */
  key: string;
}

export interface StatsTitle {
  id: number | null;
  title: string;
  /**
   * Artwork key.
   */
  image: string | null;
  seconds: number;
  /**
   * Episodes watched for shows, plays for movies and tracks, sittings for books.
   */
  count: number;
}

export interface StatsCounts {
  movies: number;
  episodes: number;
  tracks: number;
  books: number;
  /**
   * Days with anything watched, heard or read.
   */
  days: number;
}

export interface ProfileStats {
  period: StatsPeriod;
  /**
   * The first day counted, `null` for all time.
   */
  from: string | null;
  to: string;
  totals: TimeSplit;
  counts: StatsCounts;
  /**
   * Days for a week or month, months for a year or all time.
   */
  bucket: "day" | "month";
  buckets: StatsBucket[];
  topShows: StatsTitle[];
  topMovies: StatsTitle[];
  topArtists: StatsTitle[];
  topBooks: StatsTitle[];
  topGenres: { name: string; seconds: number }[];
  /**
   * The most episodes of one show on one day.
   */
  binge: { title: string; showId: number | null; episodes: number; day: string } | null;
  /**
   * Days in a row with something watched, heard or read: up to today, and the longest ever.
   */
  streak: { current: number; longest: number };
  /**
   * Whether this profile keeps its statistics to itself.
   */
  private: boolean;
}

export interface ServerStats {
  period: StatsPeriod;
  from: string | null;
  to: string;
  totals: TimeSplit;
  counts: StatsCounts;
  bucket: "day" | "month";
  buckets: StatsBucket[];
  profiles: { id: number; name: string; color: ProfileColor; avatar: string | null; totals: TimeSplit }[];
  /**
   * Profiles that keep their statistics private. Their time is in the totals, not in the list.
   */
  privateProfiles: number;
  topShows: StatsTitle[];
  topMovies: StatsTitle[];
  /**
   * Libraries with how many of their movies and shows nobody ever played.
   */
  untouched: { id: number; name: string; type: string; titles: number; untouched: number }[];
  /**
   * The oldest movies and shows nobody played, added more than a month ago.
   */
  neverPlayed: { id: number; title: string; image: string | null; addedAt: string; libraryName: string }[];
}

export interface YearInReview {
  year: number;
  /**
   * One profile's year, or the whole household's.
   */
  scope: "me" | "household";
  name: string;
  totals: TimeSplit;
  counts: StatsCounts;
  months: StatsBucket[];
  topShow: StatsTitle | null;
  topMovie: StatsTitle | null;
  topArtist: StatsTitle | null;
  topBook: StatsTitle | null;
  topGenres: { name: string; seconds: number }[];
  busiestMonth: string | null;
  binge: ProfileStats["binge"];
  longestStreak: number;
  /**
   * The first title of the year.
   */
  first: { title: string; day: string } | null;
  /**
   * For the household: everyone's hours, most first. Private profiles are left out.
   */
  people: { id: number; name: string; color: ProfileColor; avatar: string | null; seconds: number }[];
}
