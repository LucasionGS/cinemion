import type { CreationOptional, ForeignKey, InferAttributes, InferCreationAttributes, NonAttribute } from "sequelize";
import { DataTypes, Model } from "sequelize";
import sequelize, { ID_TYPE } from "./sequelize.ts";
import type MediaItem from "./MediaItem.ts";
import type User from "./User.ts";

/**
 * A profile's list of tracks, in its own order.
 */
export class Playlist extends Model<InferAttributes<Playlist>, InferCreationAttributes<Playlist>> {
  declare id: CreationOptional<number>;
  declare userId: ForeignKey<User["id"]>;
  declare name: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare entries?: NonAttribute<PlaylistItem[]>;

  public static readonly NAME_LIMIT = 128;

  /**
   * A playlist name as it's stored.
   * @throws When the name is empty.
   */
  public static cleanName(name: unknown) {
    const clean = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, Playlist.NAME_LIMIT);
    if (!clean) throw new Error("Give the playlist a name.");
    return clean;
  }
}

/**
 * One track in a playlist. A track can be in a playlist more than once.
 */
export class PlaylistItem extends Model<InferAttributes<PlaylistItem>, InferCreationAttributes<PlaylistItem>> {
  declare id: CreationOptional<number>;
  declare playlistId: ForeignKey<Playlist["id"]>;
  declare itemId: ForeignKey<MediaItem["id"]>;
  /**
   * Order in the playlist, from 0.
   */
  declare position: number;
  declare createdAt: CreationOptional<Date>;
}

Playlist.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(128), allowNull: false },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "playlists" });

PlaylistItem.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  position: { type: DataTypes.INTEGER, allowNull: false },
  createdAt: DataTypes.DATE,
}, { sequelize, tableName: "playlist_items", updatedAt: false });

export type PlaylistAttributes = InferAttributes<Playlist>;

export default Playlist;
