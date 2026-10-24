import { t, type TranslationKey } from "../i18n/I18n.ts";

export interface Rating {
  /**
   * What's stored on profiles and videos, like `PG-13`.
   */
  value: string;
  /**
   * The line shown for it in pickers.
   */
  key: TranslationKey;
}

/**
 * Age ratings to pick from: profile limits and the rating of videos. The server turns each into an age.
 */
export const RATINGS: Rating[] = [
  { value: "G", key: "ratings.g" },
  { value: "PG", key: "ratings.pg" },
  { value: "12", key: "ratings.age12" },
  { value: "PG-13", key: "ratings.pg13" },
  { value: "16", key: "ratings.age16" },
  { value: "R", key: "ratings.r" },
  { value: "18", key: "ratings.age18" },
];

/**
 * `RATINGS` as `Select` options, labelled in the current language. Call it while rendering.
 */
export function ratingOptions() {
  return RATINGS.map((rating) => ({ value: rating.value, label: t(rating.key) }));
}

export default RATINGS;
