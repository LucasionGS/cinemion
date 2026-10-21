import type { CreationOptional, ForeignKey, InferAttributes, InferCreationAttributes, NonAttribute } from "sequelize";
import { DataTypes, Model } from "sequelize";
import sequelize, { ID_TYPE } from "./sequelize.ts";
import type Library from "./Library.ts";
import type MediaItem from "./MediaItem.ts";
import type User from "./User.ts";

/**
 * An album someone made from photos and videos anywhere in a Photos library. The files stay where they are.
 * Everyone who can see the library sees its albums (with only the photos they may see); the one who made it and
 * library managers can change it.
 */
export class PhotoAlbum extends Model<InferAttributes<PhotoAlbum>, InferCreationAttributes<PhotoAlbum>> {
  declare id: CreationOptional<number>;
  declare libraryId: ForeignKey<Library["id"]>;
  /**
   * Who made it. `null` when that profile was removed.
   */
  declare userId: CreationOptional<ForeignKey<User["id"]> | null>;
  declare title: string;
  declare description: CreationOptional<string | null>;
  /**
   * The photo shown as the cover. `null` = the newest one inside.
   */
  declare coverItemId: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare owner?: NonAttribute<User | null>;

  public static readonly TITLE_LIMIT = 128;

  /**
   * An album title as it's stored.
   * @throws When the title is empty.
   */
  public static cleanTitle(title: unknown) {
    const clean = String(title ?? "").replace(/\s+/g, " ").trim().slice(0, PhotoAlbum.TITLE_LIMIT);
    if (!clean) throw new Error("Give the album a name.");
    return clean;
  }

  /**
   * Whether `user` may rename this album, change its cover, and add or remove photos.
   */
  public async canEdit(user: User) {
    return this.userId === user.id || await user.hasPermission("LIBRARY_MANAGE");
  }
}

/**
 * One photo or video in a hand-made album. Albums are shown by date, so there's no order to keep.
 */
export class PhotoAlbumItem extends Model<InferAttributes<PhotoAlbumItem>, InferCreationAttributes<PhotoAlbumItem>> {
  declare id: CreationOptional<number>;
  declare albumId: ForeignKey<PhotoAlbum["id"]>;
  declare itemId: ForeignKey<MediaItem["id"]>;
  declare createdAt: CreationOptional<Date>;
}

PhotoAlbum.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  userId: { type: ID_TYPE, allowNull: true, defaultValue: null },
  title: { type: DataTypes.STRING(128), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
  coverItemId: { type: ID_TYPE, allowNull: true, defaultValue: null },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "photo_albums" });

PhotoAlbumItem.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  createdAt: DataTypes.DATE,
}, { sequelize, tableName: "photo_album_items", updatedAt: false });

export type PhotoAlbumAttributes = InferAttributes<PhotoAlbum>;

export default PhotoAlbum;
