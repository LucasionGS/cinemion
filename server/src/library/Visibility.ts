import { Op, type WhereOptions } from "sequelize";
import type { MediaItem, User } from "../models/index.ts";
import ContentRatings from "./ContentRatings.ts";

/**
 * What a profile may see: only libraries it has access to, and only titles within its age limit.
 * Titles without a rating are hidden from profiles with a limit, to be on the safe side.
 */
export namespace Visibility {
  /**
   * The profile's age limit, or `null` when there's none.
   */
  export function ageLimit(user: User) {
    return user.maxRating ? ContentRatings.ageFor(user.maxRating) ?? 0 : null;
  }

  /**
   * Conditions for a `MediaItem` query that leave out what `user` may not see.
   */
  export function where(user: User): WhereOptions<MediaItem> {
    const conditions: WhereOptions<MediaItem>[] = [];
    if (user.libraryAccess !== null) conditions.push({ libraryId: { [Op.in]: user.libraryAccess } });
    const limit = ageLimit(user);
    if (limit !== null) conditions.push({ ageRating: { [Op.ne]: null, [Op.lte]: limit } });
    return conditions.length ? { [Op.and]: conditions } : {};
  }

  /**
   * Whether `user` may see `item`. Seasons and episodes carry their show's rating, so they're checked the same way.
   */
  export function canSee(user: User, item: MediaItem) {
    if (user.libraryAccess !== null && !user.libraryAccess.includes(item.libraryId)) return false;
    const limit = ageLimit(user);
    return limit === null || (item.ageRating !== null && item.ageRating <= limit);
  }

  export function canSeeLibrary(user: User, libraryId: number) {
    return user.libraryAccess === null || user.libraryAccess.includes(libraryId);
  }
}

export default Visibility;
