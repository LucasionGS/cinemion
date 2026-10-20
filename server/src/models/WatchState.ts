import type { CreationOptional, ForeignKey, InferAttributes, InferCreationAttributes } from "sequelize";
import { DataTypes, Model } from "sequelize";
import sequelize, { ID_TYPE } from "./sequelize.ts";
import type MediaItem from "./MediaItem.ts";
import type User from "./User.ts";

/**
 * One profile's progress on a movie or episode.
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
   */
  public static async saveProgress(userId: number, itemId: number, position: number, duration: number | null) {
    const state = await WatchState.findOrBuildState(userId, itemId);
    state.duration = duration;
    state.lastWatchedAt = new Date();
    if (duration && position / duration >= WatchState.WATCHED_AT) {
      if (!state.watched) state.playCount = (state.playCount ?? 0) + 1;
      state.watched = true;
      state.position = 0;
    }
    else {
      state.position = position < WatchState.MIN_RESUME ? 0 : position;
    }
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
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "watch_states" });

export default WatchState;
