import type { CreationOptional, ForeignKey, InferAttributes, InferCreationAttributes } from "sequelize";
import { DataTypes, Model } from "sequelize";
import { decodeBase64, encodeBase64 } from "@std/encoding/base64";
import sequelize, { ID_TYPE } from "./sequelize.ts";
import type MediaItem from "./MediaItem.ts";

/**
 * What picture recognition saw in a clip: the average of a few of its frames, as a vector of numbers. Clips whose
 * vectors point the same way look alike, which is how clips without a game get matched to tagged ones.
 */
export class ClipEmbedding extends Model<InferAttributes<ClipEmbedding>, InferCreationAttributes<ClipEmbedding>> {
  declare id: CreationOptional<number>;
  declare itemId: ForeignKey<MediaItem["id"]>;
  /**
   * The model that made it. Vectors from different models can't be compared.
   */
  declare model: string;
  /**
   * Modification time of the file it was made from, so a changed file is looked at again. Unit is in milliseconds.
   */
  declare mtime: number;
  /**
   * Float32 values, base64 encoded.
   */
  declare vector: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  public static encode(values: Float32Array) {
    return encodeBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
  }

  public toFloats(): Float32Array {
    const bytes = decodeBase64(this.vector);
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  }
}

ClipEmbedding.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  model: { type: DataTypes.STRING(64), allowNull: false },
  mtime: { type: DataTypes.BIGINT, allowNull: false },
  vector: { type: DataTypes.TEXT, allowNull: false },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "clip_embeddings" });

export default ClipEmbedding;
