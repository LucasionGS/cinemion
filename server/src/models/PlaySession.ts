import type { CreationOptional, ForeignKey, InferAttributes, InferCreationAttributes } from "sequelize";
import { DataTypes, Model } from "sequelize";
import sequelize, { ID_TYPE } from "./sequelize.ts";
import type MediaItem from "./MediaItem.ts";
import type User from "./User.ts";

/**
 * One sitting with one title: how long a profile watched, listened or read, for statistics.
 */
export class PlaySession extends Model<InferAttributes<PlaySession>, InferCreationAttributes<PlaySession>> {
  declare id: CreationOptional<number>;
  declare userId: ForeignKey<User["id"]>;
  declare itemId: ForeignKey<MediaItem["id"]> | null;
  /**
   * The item's type when it was played: movie, episode, video, track, audiobook or book.
   */
  declare kind: string;
  declare startedAt: Date;
  /**
   * Time actually spent, pauses left out. Unit is in seconds.
   */
  declare seconds: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PlaySession.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  userId: { type: ID_TYPE, allowNull: false },
  itemId: { type: ID_TYPE, allowNull: true, defaultValue: null },
  kind: { type: DataTypes.STRING(16), allowNull: false },
  startedAt: { type: DataTypes.DATE, allowNull: false },
  seconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "play_sessions" });

export default PlaySession;
