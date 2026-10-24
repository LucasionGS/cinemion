import type { CreationOptional, ForeignKey, InferAttributes, InferCreationAttributes, NonAttribute } from "sequelize";
import { col, DataTypes, Model, Op, where } from "sequelize";
import type { Artwork, ExternalIds, ExternalRatings, ItemSummary, ItemType, MatchStatus, Palette } from "@shared/media.ts";
import type { ClipGameSource, GameSuggestion } from "@shared/clips.ts";
import sequelize, { ID_TYPE, jsonColumn } from "./sequelize.ts";
import type Library from "./Library.ts";

export const EMPTY_ARTWORK: Artwork = { poster: null, backdrop: null, logo: null, thumb: null };

/**
 * A movie, show, season or episode, a video, photo or folder, an artist, album or track, or a game. Seasons belong to
 * a show and episodes to a season through `parentId`; albums to their artist, tracks to their album and clips to their
 * game the same way.
 */
export class MediaItem extends Model<InferAttributes<MediaItem>, InferCreationAttributes<MediaItem>> {
  declare id: CreationOptional<number>;
  declare libraryId: ForeignKey<Library["id"]>;
  /**
   * The show of a season, the season of an episode, the folder of a video or photo, the artist of an album, the
   * album of a track or the game of a clip. `null` for movies, shows, artists, games, things in a library folder
   * itself and clips without a game.
   */
  declare parentId: CreationOptional<number | null>;
  declare type: ItemType;
  /**
   * Folder a show was found in, so it's recognised on the next scan. `null` for other types.
   */
  declare folderPath: CreationOptional<string | null>;
  declare title: string;
  declare sortTitle: string;
  declare originalTitle: CreationOptional<string | null>;
  declare year: CreationOptional<number | null>;
  /**
   * For tracks: the disc number.
   */
  declare seasonNumber: CreationOptional<number | null>;
  /**
   * For tracks: the track number.
   */
  declare episodeNumber: CreationOptional<number | null>;
  /**
   * For tracks: who performs it, when it isn't the album's artist (compilations, guests). `null` otherwise.
   */
  declare artist: CreationOptional<string | null>;
  /**
   * Last episode in a multi-episode file (S01E01-E02). `null` for single episodes.
   */
  declare episodeEnd: CreationOptional<number | null>;
  declare overview: CreationOptional<string | null>;
  declare tagline: CreationOptional<string | null>;
  /**
   * Unit is in minutes.
   */
  declare runtime: CreationOptional<number | null>;
  /**
   * `YYYY-MM-DD`.
   */
  declare releaseDate: CreationOptional<string | null>;
  /**
   * Photos, and videos in Photos libraries: when it was taken, on the camera's clock (`YYYY-MM-DDTHH:MM:SS`), so
   * they sort by the minute. `null` for everything else.
   */
  declare takenAt: CreationOptional<string | null>;
  declare rating: CreationOptional<number | null>;
  /**
   * IMDb, Rotten Tomatoes and Metacritic ratings from OMDb. `null` = not looked up.
   */
  declare ratings: CreationOptional<ExternalRatings | null>;
  declare contentRating: CreationOptional<string | null>;
  declare genres: CreationOptional<string[]>;
  declare studios: CreationOptional<string[]>;
  declare externalIds: CreationOptional<ExternalIds>;
  declare artwork: CreationOptional<Artwork>;
  declare palette: CreationOptional<Palette | null>;
  declare matchStatus: CreationOptional<MatchStatus>;
  /**
   * Collection a movie belongs to. `null` = none.
   */
  declare collectionId: CreationOptional<number | null>;
  /**
   * Minimum age from `contentRating`. Seasons and episodes copy their show's. `null` = unrated.
   */
  declare ageRating: CreationOptional<number | null>;
  /**
   * When metadata was last fetched. `null` = never, so the next scan fetches it.
   */
  declare metadataUpdatedAt: CreationOptional<Date | null>;
  /**
   * When a video's or folder's details were last edited by hand. `null` = never, so refreshing may set them.
   */
  declare editedAt: CreationOptional<Date | null>;
  /**
   * The thumbnail was uploaded or picked by hand, so refreshing keeps it.
   */
  declare customArtwork: CreationOptional<boolean>;
  /**
   * Clips in Clips libraries: where their game came from. `null` for everything else.
   */
  declare clip: CreationOptional<MediaItem.ClipInfo | null>;
  declare addedAt: CreationOptional<Date>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare children?: NonAttribute<MediaItem[]>;

  /**
   * Title used for sorting: lowercase, without leading articles, so "The Matrix" sorts under M.
   */
  public static sortTitleFor(title: string) {
    return title.trim().toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/^(the|a|an|de|het|een|der|die|das|le|la|les|el|los)\s+/i, "").replace(/[^\p{L}\p{N} ]+/gu, "").trim();
  }

  /**
   * Condition for items with `genre`. Genres are stored as JSON text, so this matches the quoted name.
   */
  public static genreCondition(genre: string) {
    return where(col("genres"), { [Op.like]: `%${JSON.stringify(genre)}%` });
  }

  public setTitle(title: string) {
    this.title = title;
    this.sortTitle = MediaItem.sortTitleFor(title);
  }

  /**
   * @param extra What the item doesn't know by itself: child count, the profile's progress, the show it's in.
   *   `Summaries.build()` fills these in for lists.
   */
  public toSummary(extra?: Partial<Pick<ItemSummary, "childCount" | "userData" | "showId" | "showTitle" | "clip">>): ItemSummary {
    return {
      id: this.id,
      libraryId: this.libraryId,
      type: this.type,
      title: this.title,
      year: this.year,
      overview: this.overview,
      runtime: this.runtime,
      genres: this.genres,
      rating: this.rating,
      artwork: this.artwork,
      palette: this.palette,
      matchStatus: this.matchStatus,
      contentRating: this.contentRating,
      releaseDate: this.releaseDate,
      childCount: extra?.childCount ?? 0,
      seasonNumber: this.seasonNumber,
      episodeNumber: this.episodeNumber,
      showId: extra?.showId ?? null,
      showTitle: extra?.showTitle ?? null,
      collectionId: this.collectionId,
      addedAt: this.addedAt.toISOString(),
      userData: extra?.userData ?? null,
      clip: extra?.clip ?? null,
    };
  }

  public override toJSON() {
    return this.toSummary();
  }
}

MediaItem.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  parentId: { type: ID_TYPE, allowNull: true, defaultValue: null },
  type: { type: DataTypes.STRING(16), allowNull: false },
  folderPath: { type: DataTypes.STRING(1024), allowNull: true, defaultValue: null },
  title: { type: DataTypes.STRING(512), allowNull: false },
  sortTitle: { type: DataTypes.STRING(512), allowNull: false },
  originalTitle: { type: DataTypes.STRING(512), allowNull: true, defaultValue: null },
  year: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  seasonNumber: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  episodeNumber: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  artist: { type: DataTypes.STRING(512), allowNull: true, defaultValue: null },
  episodeEnd: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  overview: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
  tagline: { type: DataTypes.STRING(512), allowNull: true, defaultValue: null },
  runtime: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  releaseDate: { type: DataTypes.STRING(10), allowNull: true, defaultValue: null },
  takenAt: { type: DataTypes.STRING(19), allowNull: true, defaultValue: null },
  rating: { type: DataTypes.FLOAT, allowNull: true, defaultValue: null },
  ratings: jsonColumn<ExternalRatings | null, MediaItem>("ratings", null, true),
  contentRating: { type: DataTypes.STRING(16), allowNull: true, defaultValue: null },
  genres: jsonColumn<string[], MediaItem>("genres", []),
  studios: jsonColumn<string[], MediaItem>("studios", []),
  externalIds: jsonColumn<ExternalIds, MediaItem>("externalIds", {}),
  artwork: jsonColumn<Artwork, MediaItem>("artwork", EMPTY_ARTWORK),
  palette: jsonColumn<Palette | null, MediaItem>("palette", null, true),
  matchStatus: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "unmatched" },
  collectionId: { type: ID_TYPE, allowNull: true, defaultValue: null },
  ageRating: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  metadataUpdatedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  editedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  customArtwork: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  clip: jsonColumn<MediaItem.ClipInfo | null, MediaItem>("clip", null, true),
  addedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "media_items" });

export namespace MediaItem {
  /**
   * What a clip's names say about its game, and what picture recognition thinks it is.
   */
  export interface ClipInfo {
    /**
     * The game's name as the folder, file name or tags gave it, like "Counter-strike 2". `null` = none found.
     */
    hint: string | null;
    /**
     * Steam app id from the name of a Steam game recording.
     */
    steamAppId: string | null;
    /**
     * Where the clip's game came from. `null` = it has none.
     */
    found: ClipGameSource | null;
    /**
     * The title came from the file name (or was typed in), rather than being when it was recorded.
     */
    titled: boolean;
    /**
     * A recording of the desktop rather than a game, so no game is suggested.
     */
    desktop?: boolean;
    suggestion: GameSuggestion | null;
    /**
     * Games someone said a clip isn't, by title, so they aren't suggested again.
     */
    notGames?: string[];
  }
}

export type MediaItemAttributes = InferAttributes<MediaItem>;

export default MediaItem;
