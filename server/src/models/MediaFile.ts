import type { CreationOptional, ForeignKey, InferAttributes, InferCreationAttributes } from "sequelize";
import { DataTypes, Model } from "sequelize";
import type { AudioTrack, MediaFileInfo, SubtitleTrack } from "@shared/media.ts";
import sequelize, { ID_TYPE, jsonColumn } from "./sequelize.ts";
import type Library from "./Library.ts";
import type MediaItem from "./MediaItem.ts";

/**
 * A video file on disk and what ffprobe found in it. A movie can have several (versions); an episode usually has one.
 */
export class MediaFile extends Model<InferAttributes<MediaFile>, InferCreationAttributes<MediaFile>> {
  declare id: CreationOptional<number>;
  declare libraryId: ForeignKey<Library["id"]>;
  /**
   * The movie or episode this file plays. `null` while the scan is still sorting it.
   */
  declare itemId: CreationOptional<ForeignKey<MediaItem["id"]> | null>;
  declare path: string;
  /**
   * Unit is in bytes.
   */
  declare size: number;
  /**
   * Modification time, in milliseconds since the epoch. With `size`, tells whether the file changed.
   */
  declare mtime: number;
  declare container: CreationOptional<string | null>;
  /**
   * Unit is in seconds.
   */
  declare duration: CreationOptional<number | null>;
  /**
   * Unit is in bits per second.
   */
  declare bitrate: CreationOptional<number | null>;
  declare videoCodec: CreationOptional<string | null>;
  declare width: CreationOptional<number | null>;
  declare height: CreationOptional<number | null>;
  declare hdr: CreationOptional<string | null>;
  declare audio: CreationOptional<AudioTrack[]>;
  declare subtitles: CreationOptional<SubtitleTrack[]>;
  /**
   * When ffprobe last read the file. `null` = not read yet.
   */
  declare probedAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  public toInfo(): MediaFileInfo {
    return {
      id: this.id,
      path: this.path,
      size: Number(this.size),
      container: this.container,
      duration: this.duration,
      videoCodec: this.videoCodec,
      width: this.width,
      height: this.height,
      hdr: this.hdr,
      bitrate: this.bitrate,
      audio: this.audio,
      subtitles: this.subtitles,
    };
  }

  public override toJSON() {
    return this.toInfo();
  }
}

MediaFile.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  path: { type: DataTypes.STRING(1024), allowNull: false, unique: true },
  size: { type: DataTypes.BIGINT, allowNull: false },
  mtime: { type: DataTypes.BIGINT, allowNull: false },
  container: { type: DataTypes.STRING(64), allowNull: true, defaultValue: null },
  duration: { type: DataTypes.FLOAT, allowNull: true, defaultValue: null },
  bitrate: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  videoCodec: { type: DataTypes.STRING(32), allowNull: true, defaultValue: null },
  width: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  height: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  hdr: { type: DataTypes.STRING(16), allowNull: true, defaultValue: null },
  audio: jsonColumn<AudioTrack[], MediaFile>("audio", []),
  subtitles: jsonColumn<SubtitleTrack[], MediaFile>("subtitles", []),
  probedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "media_files" });

export type MediaFileAttributes = InferAttributes<MediaFile>;

export default MediaFile;
