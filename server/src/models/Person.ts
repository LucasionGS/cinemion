import type { CreationOptional, InferAttributes, InferCreationAttributes } from "sequelize";
import { DataTypes, Model } from "sequelize";
import sequelize, { ID_TYPE } from "./sequelize.ts";

/**
 * Someone in the cast or crew of one or more titles.
 */
export class Person extends Model<InferAttributes<Person>, InferCreationAttributes<Person>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare tmdbId: CreationOptional<string | null>;
  /**
   * Image key of their photo. `null` = none.
   */
  declare photo: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  /**
   * Find a person by TMDB id, or by name when there's no id, creating them when new.
   */
  public static async findOrCreatePerson(data: { name: string; tmdbId?: string | null; photo?: string | null }) {
    let person = data.tmdbId
      ? await Person.findOne({ where: { tmdbId: data.tmdbId } })
      : await Person.findOne({ where: { name: data.name, tmdbId: null } });
    if (!person) {
      person = await Person.create({ name: data.name, tmdbId: data.tmdbId ?? null, photo: data.photo ?? null });
    }
    else if (data.photo && person.photo !== data.photo) {
      person.photo = data.photo;
      await person.save();
    }
    return person;
  }
}

Person.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(256), allowNull: false },
  tmdbId: { type: DataTypes.STRING(32), allowNull: true, defaultValue: null },
  photo: { type: DataTypes.STRING(64), allowNull: true, defaultValue: null },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "people" });

export default Person;
