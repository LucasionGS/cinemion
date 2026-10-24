import type { CreationOptional, ForeignKey, InferAttributes, InferCreationAttributes, NonAttribute } from "sequelize";
import { DataTypes, Model } from "sequelize";
import type { ExternalIds } from "@shared/media.ts";
import type { WatchlistKind } from "@shared/watchlist.ts";
import sequelize, { ID_TYPE, jsonColumn } from "./sequelize.ts";
import type MediaItem from "./MediaItem.ts";
import type User from "./User.ts";

/**
 * A title on a profile's "My list". It points at an item in a library, or (for titles added on Trakt that aren't
 * here yet) only knows the title and its ids, until a scan brings it in.
 */
export class WatchlistItem extends Model<InferAttributes<WatchlistItem>, InferCreationAttributes<WatchlistItem>> {
  declare id: CreationOptional<number>;
  declare userId: ForeignKey<User["id"]>;
  /**
   * `null` = not in any library (yet).
   */
  declare itemId: ForeignKey<MediaItem["id"]> | null;
  declare kind: WatchlistKind;
  /**
   * Kept for entries without an item, and for when the item goes away.
   */
  declare title: string;
  declare year: number | null;
  declare externalIds: CreationOptional<ExternalIds>;
  /**
   * Whether it's on the profile's Trakt watchlist too, as far as the last sync knows. An entry that was there and
   * isn't any more was taken off on Trakt.
   */
  declare onTrakt: CreationOptional<boolean>;
  /**
   * When a title that wasn't here arrived in a library.
   */
  declare arrivedAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare item?: NonAttribute<MediaItem | null>;

  /**
   * Item types that can go on the list.
   */
  public static readonly KINDS: readonly WatchlistKind[] = ["movie", "show", "video"];

  public static isKind(type: string): type is WatchlistKind {
    return (WatchlistItem.KINDS as readonly string[]).includes(type);
  }
}

WatchlistItem.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  userId: { type: ID_TYPE, allowNull: false },
  itemId: { type: ID_TYPE, allowNull: true, defaultValue: null },
  kind: { type: DataTypes.STRING(16), allowNull: false },
  title: { type: DataTypes.STRING(512), allowNull: false },
  year: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  externalIds: jsonColumn<ExternalIds, WatchlistItem>("externalIds", {}),
  onTrakt: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  arrivedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "watchlist_items" });

export default WatchlistItem;
