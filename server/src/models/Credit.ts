import type { CreationOptional, ForeignKey, InferAttributes, InferCreationAttributes, NonAttribute } from "sequelize";
import { DataTypes, Model } from "sequelize";
import type { CreditInfo } from "@shared/media.ts";
import sequelize, { ID_TYPE } from "./sequelize.ts";
import type MediaItem from "./MediaItem.ts";
import type Person from "./Person.ts";

/**
 * Someone's part in a title: an actor's role, or a crew job.
 */
export class Credit extends Model<InferAttributes<Credit>, InferCreationAttributes<Credit>> {
  declare id: CreationOptional<number>;
  declare itemId: ForeignKey<MediaItem["id"]>;
  declare personId: ForeignKey<Person["id"]>;
  /**
   * `cast`, `director`, `writer`, `producer` or `composer`.
   */
  declare kind: string;
  declare character: CreationOptional<string | null>;
  /**
   * Billing order, lowest first.
   */
  declare order: CreationOptional<number>;

  declare person?: NonAttribute<Person>;

  public toInfo(): CreditInfo {
    return {
      personId: this.personId,
      name: this.person?.name ?? "",
      kind: this.kind,
      character: this.character,
      photo: this.person?.photo ?? null,
    };
  }
}

Credit.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  kind: { type: DataTypes.STRING(16), allowNull: false },
  character: { type: DataTypes.STRING(256), allowNull: true, defaultValue: null },
  order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, { sequelize, tableName: "credits", timestamps: false });

export default Credit;
