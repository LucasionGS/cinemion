import Path from "node:path";
import { type CreationOptional, DataTypes, type InferAttributes, type InferCreationAttributes, Model } from "sequelize";
import type { CreateLibraryRequest, LibraryInfo, LibraryType } from "@shared/api.ts";
import sequelize, { ID_TYPE, jsonColumn } from "./sequelize.ts";
import ContentRatings from "../library/ContentRatings.ts";

export class Library extends Model<InferAttributes<Library>, InferCreationAttributes<Library>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare type: LibraryType;
  /**
   * Absolute folder paths the library scans.
   */
  declare paths: string[];
  /**
   * When the last full scan finished. `null` = never scanned.
   */
  declare lastScannedAt: CreationOptional<Date | null>;
  /**
   * Videos libraries: the rating of videos without one. `null` = unrated videos stay hidden from age-limited profiles.
   */
  declare defaultRating: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  public static validateType(type: unknown): type is LibraryType {
    return type === "movies" || type === "shows" || type === "videos";
  }

  /**
   * Check a rating for unrated videos.
   * @throws When Cinemion can't tell the age of the rating.
   */
  public static verifyDefaultRating(rating: unknown): string | null {
    if (rating === null || rating === undefined || rating === "") return null;
    if (typeof rating !== "string" || ContentRatings.ageFor(rating) === null) throw new Error(`"${rating}" isn't a rating Cinemion knows. Use one like "G", "PG", "12" or "16".`);
    return rating.trim();
  }

  /**
   * The age that unrated items in this library count as. `null` = unrated stays unrated.
   */
  public defaultAge() {
    return this.type === "videos" ? ContentRatings.ageFor(this.defaultRating) : null;
  }

  /**
   * Whether two folders overlap: the same folder, or one inside the other. A file can only be in one library, so
   * libraries must never overlap.
   */
  public static overlaps(a: string, b: string) {
    const x = Path.resolve(a);
    const y = Path.resolve(b);
    return x === y || x.startsWith(y.endsWith(Path.sep) ? y : y + Path.sep) || y.startsWith(x.endsWith(Path.sep) ? x : x + Path.sep);
  }

  /**
   * Explain why `path` can't be used, when it overlaps one of `others`' folders. `null` when it's free.
   */
  public static overlapProblem(path: string, others: { name: string; paths: string[] }[]): string | null {
    for (const other of others) {
      const taken = other.paths.find((p) => Library.overlaps(path, p));
      if (!taken) continue;
      const [mine, theirs] = [Path.resolve(path), Path.resolve(taken)];
      const how = mine === theirs ? "is already" : mine.startsWith(theirs + Path.sep) ? "is inside a folder that's already" : "holds a folder that's already";
      return `The folder "${path}" ${how} in the library "${other.name}". A video can only be in one library, so give each library its own folders.`;
    }
    return null;
  }

  /**
   * Check and normalise library data. Folder access, and overlaps with other libraries, are checked by the caller.
   * @throws With a readable message when a value is invalid.
   */
  public static verifyLibrary(data: CreateLibraryRequest): CreateLibraryRequest {
    const name = data.name?.trim();
    if (!name || name.length > 60) throw new Error("The library name must be between 1 and 60 characters long.");
    if (!Library.validateType(data.type)) throw new Error(`Unknown library type "${data.type}". Use "movies", "shows" or "videos".`);
    const paths = Library.verifyPaths(data.paths, name);
    const defaultRating = data.type === "videos" ? Library.verifyDefaultRating(data.defaultRating) : null;
    return { name, type: data.type, paths, defaultRating };
  }

  /**
   * Check a library's folders: at least one, and none inside another (that would find every file twice).
   * @throws With a readable message when they don't work.
   */
  public static verifyPaths(paths: unknown, name: string): string[] {
    if (!Array.isArray(paths) || paths.length === 0 || paths.some((p) => typeof p !== "string")) throw new Error(`Choose at least one folder for the library "${name}".`);
    const unique = [...new Set(paths.map((p: string) => Path.resolve(p)))];
    for (const [i, path] of unique.entries()) {
      const other = unique.find((p, j) => j !== i && Library.overlaps(path, p));
      if (other) throw new Error(`The folders "${path}" and "${other}" overlap. Pick just one of them for "${name}".`);
    }
    return unique;
  }

  /**
   * Validate and create a library.
   * @throws With a readable message when a value is invalid or a folder is already in another library.
   */
  public static async createLibrary(data: CreateLibraryRequest) {
    const verified = Library.verifyLibrary(data);
    const others = await Library.findAll();
    for (const path of verified.paths) {
      const problem = Library.overlapProblem(path, others);
      if (problem) throw new Error(problem);
    }
    return await Library.create(verified);
  }

  /**
   * @param extra Live details the model doesn't hold: the item count, the running scan and shared folders.
   */
  public toInfo(extra: Pick<LibraryInfo, "itemCount" | "scan" | "conflict">): LibraryInfo {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      paths: this.paths,
      lastScannedAt: this.lastScannedAt?.toISOString() ?? null,
      defaultRating: this.defaultRating,
      ...extra,
    };
  }

  public override toJSON() {
    return this.toInfo({ itemCount: 0, scan: null, conflict: null });
  }
}

Library.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(60), allowNull: false },
  type: { type: DataTypes.STRING(16), allowNull: false },
  paths: jsonColumn<string[], Library>("paths", []),
  lastScannedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  defaultRating: { type: DataTypes.STRING(16), allowNull: true, defaultValue: null },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "libraries" });

export type LibraryAttributes = InferAttributes<Library>;

export default Library;
