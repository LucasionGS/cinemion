import type { CreationOptional, ForeignKey, InferAttributes, InferCreationAttributes } from "sequelize";
import { DataTypes, Model } from "sequelize";
import sequelize, { ID_TYPE } from "./sequelize.ts";
import type MediaItem from "./MediaItem.ts";
import type User from "./User.ts";

/**
 * One profile's progress on a movie, episode or audiobook, where it is in a book, how often it played a track, or
 * whether it starred a clip.
 * Books keep their progress as a fraction: `position` from 0 to 1 with a `duration` of 1.
 */
export class WatchState extends Model<InferAttributes<WatchState>, InferCreationAttributes<WatchState>> {
  declare id: CreationOptional<number>;
  declare userId: ForeignKey<User["id"]>;
  declare itemId: ForeignKey<MediaItem["id"]>;
  /**
   * Where playback stopped. Unit is in seconds. 0 = not started, or finished.
   */
  declare position: CreationOptional<number>;
  /**
   * Length of what was played. Unit is in seconds. `null` = unknown.
   */
  declare duration: CreationOptional<number | null>;
  declare watched: CreationOptional<boolean>;
  declare playCount: CreationOptional<number>;
  declare lastWatchedAt: CreationOptional<Date | null>;
  /**
   * Books: where reading stopped, like "4:0.35". `null` for everything else.
   */
  declare bookmark: CreationOptional<string | null>;
  /**
   * Starred by this profile. Used for clips.
   */
  declare favorite: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  /**
   * Past this share of the length, something counts as watched.
   */
  public static readonly WATCHED_AT = 0.92;
  /**
   * Below this many seconds, playback counts as not started.
   */
  public static readonly MIN_RESUME = 30;

  private static async findOrBuildState(userId: number, itemId: number) {
    return await WatchState.findOne({ where: { userId, itemId } }) ?? WatchState.build({ userId, itemId });
  }

  /**
   * Mark movies or episodes as watched or not, clearing any resume position.
   */
  public static async markWatched(userId: number, itemIds: number[], watched: boolean) {
    for (const itemId of itemIds) {
      const state = await WatchState.findOrBuildState(userId, itemId);
      if (watched && !state.watched) state.playCount = (state.playCount ?? 0) + 1;
      state.watched = watched;
      state.position = 0;
      if (watched) state.lastWatchedAt = new Date();
      await state.save();
    }
  }

  /**
   * Remember where playback is. Near the end, the item becomes watched instead.
   * @param position Unit is in seconds.
   * @param duration Unit is in seconds.
   * @returns The state, and whether this report finished it.
   */
  public static async saveProgress(userId: number, itemId: number, position: number, duration: number | null) {
    const state = await WatchState.findOrBuildState(userId, itemId);
    let finished = false;
    state.duration = duration;
    state.lastWatchedAt = new Date();
    if (duration && position / duration >= WatchState.WATCHED_AT) {
      if (!state.watched) {
        state.playCount = (state.playCount ?? 0) + 1;
        finished = true;
      }
      state.watched = true;
      state.position = 0;
    }
    else {
      state.position = position < WatchState.MIN_RESUME ? 0 : position;
    }
    await state.save();
    return { state, finished };
  }

  /**
   * Save where a profile is in an audiobook or book, or mark it finished (or not).
   * @param position Audiobooks: seconds in. Books: 0 to 1.
   * @param duration Audiobooks: the length in seconds. Books: 1.
   */
  public static async saveBookProgress(userId: number, itemId: number, opts: { position?: number; duration: number; bookmark?: string | null; finished?: boolean }) {
    const state = await WatchState.findOrBuildState(userId, itemId);
    state.duration = opts.duration;
    state.lastWatchedAt = new Date();
    if (opts.bookmark !== undefined) state.bookmark = opts.bookmark;
    if (opts.position !== undefined) state.position = Math.max(0, Math.min(opts.position, opts.duration));
    if (opts.finished !== undefined) {
      if (opts.finished && !state.watched) state.playCount = (state.playCount ?? 0) + 1;
      state.watched = opts.finished;
      // Finishing starts it over next time; unfinishing keeps the place
      if (opts.finished) {
        state.position = 0;
        state.bookmark = null;
      }
    }
    else if (opts.position !== undefined && state.watched && opts.position > 0) {
      // Listening or reading again after finishing
      state.watched = false;
    }
    await state.save();
    return state;
  }

  /**
   * Star an item for a profile, or take the star off.
   */
  public static async setFavorite(userId: number, itemIds: number[], favorite: boolean) {
    for (const itemId of itemIds) {
      const state = await WatchState.findOrBuildState(userId, itemId);
      if (state.isNewRecord ? !favorite : state.favorite === favorite) continue;
      state.favorite = favorite;
      await state.save();
    }
  }

  /**
   * Count a play of a track. Tracks have no resume position; `lastWatchedAt` is when it was last played.
   */
  public static async recordPlay(userId: number, itemId: number) {
    const state = await WatchState.findOrBuildState(userId, itemId);
    state.playCount = (state.playCount ?? 0) + 1;
    state.lastWatchedAt = new Date();
    await state.save();
    return state;
  }
}

WatchState.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  position: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  duration: { type: DataTypes.FLOAT, allowNull: true, defaultValue: null },
  watched: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  playCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  lastWatchedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  bookmark: { type: DataTypes.STRING(512), allowNull: true, defaultValue: null },
  favorite: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "watch_states" });

export default WatchState;
