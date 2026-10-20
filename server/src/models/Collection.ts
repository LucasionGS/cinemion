import type { CreationOptional, ForeignKey, InferAttributes, InferCreationAttributes } from "sequelize";
import { DataTypes, Model } from "sequelize";
import type { Artwork, CollectionSummary, Palette } from "@shared/media.ts";
import sequelize, { ID_TYPE, jsonColumn } from "./sequelize.ts";
import { EMPTY_ARTWORK, MediaItem } from "./MediaItem.ts";
import type Library from "./Library.ts";

/**
 * Movies that belong together, like a trilogy. Comes from TMDB or from `<set>` in NFO files.
 */
export class Collection extends Model<InferAttributes<Collection>, InferCreationAttributes<Collection>> {
  declare id: CreationOptional<number>;
  declare libraryId: ForeignKey<Library["id"]>;
  declare name: string;
  declare sortName: string;
  declare tmdbId: CreationOptional<string | null>;
  declare overview: CreationOptional<string | null>;
  declare artwork: CreationOptional<Artwork>;
  declare palette: CreationOptional<Palette | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  /**
   * The library's collection with this TMDB id (or name, without one), creating it when new.
   */
  public static async findOrCreateCollection(libraryId: number, data: { name: string; tmdbId?: string | null }) {
    const where = data.tmdbId ? { libraryId, tmdbId: data.tmdbId } : { libraryId, name: data.name, tmdbId: null };
    let collection = await Collection.findOne({ where });
    if (!collection) {
      collection = await Collection.create({ libraryId, name: data.name, sortName: MediaItem.sortTitleFor(data.name), tmdbId: data.tmdbId ?? null });
    }
    return collection;
  }

  public toSummary(itemCount: number): CollectionSummary {
    return {
      id: this.id,
      libraryId: this.libraryId,
      name: this.name,
      overview: this.overview,
      artwork: this.artwork,
      palette: this.palette,
      itemCount,
    };
  }
}

Collection.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(256), allowNull: false },
  sortName: { type: DataTypes.STRING(256), allowNull: false },
  tmdbId: { type: DataTypes.STRING(32), allowNull: true, defaultValue: null },
  overview: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
  artwork: jsonColumn<Artwork, Collection>("artwork", EMPTY_ARTWORK),
  palette: jsonColumn<Palette | null, Collection>("palette", null, true),
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "collections" });

export default Collection;
