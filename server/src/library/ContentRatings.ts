/**
 * Turns content ratings from different countries into a minimum age, so profile limits can compare them.
 */
export namespace ContentRatings {
  // Ratings that don't carry their age in the name. Everything else falls back to its leading number ("12A", "FSK 16").
  const AGES: Record<string, number> = {
    "G": 0,
    "U": 0,
    "AL": 0,
    "ALL": 0,
    "TV-Y": 0,
    "TV-G": 0,
    "E": 0,
    "TV-Y7": 7,
    "PG": 8,
    "TV-PG": 8,
    "PG-13": 13,
    "TV-14": 14,
    "M": 15,
    "MA15+": 15,
    "R": 17,
    "TV-MA": 17,
    "NC-17": 18,
    "R18+": 18,
    "R18": 18,
    "X": 18,
    "X18+": 18,
  };
  const UNRATED = new Set(["NR", "UR", "NOT RATED", "UNRATED", "N/A", ""]);

  /**
   * Minimum age for a rating like "PG-13", "12", "FSK 16" or "US:R". `null` when unrated or unknown.
   */
  export function ageFor(rating: string | null | undefined): number | null {
    if (!rating) return null;
    const normalised = rating.trim().toUpperCase().replace(/^[A-Z]{2}[:-]\s*/, "").replace(/^RATED\s+/, "");
    if (UNRATED.has(normalised)) return null;
    if (normalised in AGES) return AGES[normalised];
    const number = /(\d{1,2})/.exec(normalised);
    return number ? parseInt(number[1]) : null;
  }
}

export default ContentRatings;
