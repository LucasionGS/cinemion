import { DataTypes, type Model, type ModelAttributeColumnOptions, Sequelize } from "sequelize";
import AppSystem from "../AppSystem.ts";
import sqlite from "../lib/sqlite.ts";
import log from "../lib/Logger.ts";

function createSequelize() {
  const { config } = AppSystem;
  const logging = Deno.env.get("DEBUG_SQL") ? (sql: string) => log.debug(sql) : false;

  if (config.DB_DIALECT === "mariadb") {
    return new Sequelize(config.DB_NAME, config.DB_USER, config.DB_PASSWORD, {
      dialect: "mariadb",
      host: config.DB_HOST,
      port: config.DB_PORT,
      logging,
    });
  }

  return new Sequelize({
    dialect: "sqlite",
    storage: AppSystem.databaseFile,
    dialectModule: sqlite,
    logging,
  });
}

/**
 * The database connection. Models are initialised against it in their own files.
 */
export const sequelize = createSequelize();

/**
 * Integer type for ids and foreign keys. SQLite has no unsigned integers, so it gets a plain one.
 */
export const ID_TYPE = sequelize.getDialect() === "sqlite" ? DataTypes.INTEGER : DataTypes.INTEGER.UNSIGNED;

/**
 * A TEXT column holding JSON, so it behaves the same on SQLite and MariaDB.
 */
export function jsonColumn<T, M extends Model>(field: string, defaultValue: T, allowNull = false): ModelAttributeColumnOptions<M> {
  // The stored value is a string, but the model attribute is typed as the parsed value
  type Raw = { getDataValue(key: string): string | null; setDataValue(key: string, value: string | null): void };
  return {
    type: DataTypes.TEXT,
    allowNull,
    defaultValue: defaultValue === null ? null : JSON.stringify(defaultValue),
    get(this: M) {
      const raw = (this as unknown as Raw).getDataValue(field);
      return raw === null || raw === undefined ? defaultValue : JSON.parse(raw) as T;
    },
    set(this: M, value: unknown) {
      (this as unknown as Raw).setDataValue(field, value === null ? null : JSON.stringify(value));
    },
  };
}

export default sequelize;
