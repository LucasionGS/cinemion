import { DataTypes, type InferAttributes, type InferCreationAttributes, Model } from "sequelize";
import sequelize from "./sequelize.ts";

/**
 * Server-wide settings that can be changed at runtime, stored as JSON per key.
 */
export class Setting extends Model<InferAttributes<Setting>, InferCreationAttributes<Setting>> {
  declare key: string;
  declare value: string;

  private static _cache = new Map<string, unknown>();

  /**
   * Read a setting, or `fallback` when it has never been set.
   */
  public static async get<T>(key: string, fallback: T): Promise<T> {
    if (Setting._cache.has(key)) return Setting._cache.get(key) as T;
    const row = await Setting.findByPk(key);
    const value = row ? JSON.parse(row.value) as T : fallback;
    if (row) Setting._cache.set(key, value);
    return value;
  }

  public static async set<T>(key: string, value: T) {
    await Setting.upsert({ key, value: JSON.stringify(value) });
    Setting._cache.set(key, value);
  }
}

export namespace Setting {
  /**
   * Keys of the settings Cinemion uses, so they're not typed out by hand.
   */
  export const Keys = {
    SETUP_COMPLETE: "setupComplete",
    SERVER_NAME: "serverName",
    METADATA: "metadata",
  } as const;
}

Setting.init({
  key: { type: DataTypes.STRING(64), primaryKey: true },
  value: { type: DataTypes.TEXT, allowNull: false },
}, { sequelize, tableName: "settings", timestamps: false });

export default Setting;
