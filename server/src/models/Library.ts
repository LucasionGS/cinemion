import { type CreationOptional, DataTypes, type InferAttributes, type InferCreationAttributes, Model } from "sequelize";
import type { CreateLibraryRequest, LibraryInfo, LibraryType } from "@shared/api.ts";
import sequelize, { ID_TYPE, jsonColumn } from "./sequelize.ts";

export class Library extends Model<InferAttributes<Library>, InferCreationAttributes<Library>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare type: LibraryType;
  /**
   * Absolute folder paths the library scans.
   */
  declare paths: string[];
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  public static validateType(type: unknown): type is LibraryType {
    return type === "movies" || type === "shows";
  }

  /**
   * Check and normalise library data. Folder access is checked by the caller.
   * @throws With a readable message when a value is invalid.
   */
  public static verifyLibrary(data: CreateLibraryRequest): CreateLibraryRequest {
    const name = data.name?.trim();
    if (!name || name.length > 60) throw new Error("The library name must be between 1 and 60 characters long.");
    if (!Library.validateType(data.type)) throw new Error(`Unknown library type "${data.type}". Use "movies" or "shows".`);
    if (!Array.isArray(data.paths) || data.paths.length === 0) throw new Error(`Choose at least one folder for the library "${name}".`);
    return { name, type: data.type, paths: [...new Set(data.paths)] };
  }

  /**
   * Validate and create a library.
   * @throws With a readable message when a value is invalid.
   */
  public static async createLibrary(data: CreateLibraryRequest) {
    return await Library.create(Library.verifyLibrary(data));
  }

  public override toJSON(): LibraryInfo {
    return { id: this.id, name: this.name, type: this.type, paths: this.paths };
  }
}

Library.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(60), allowNull: false },
  type: { type: DataTypes.STRING(16), allowNull: false },
  paths: jsonColumn<string[], Library>("paths", []),
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "libraries" });

export type LibraryAttributes = InferAttributes<Library>;

export default Library;
