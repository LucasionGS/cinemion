/// <reference types="npm:@types/node@^24" />
import { DatabaseSync } from "node:sqlite";

/**
 * A stand-in for the `sqlite3` npm package, built on the SQLite that ships with Deno (`node:sqlite`).
 * Sequelize loads it through `dialectModule`, so no native addon is needed and `deno compile` works.
 * It only implements the part of the `sqlite3` API that Sequelize uses.
 */

type Callback = (this: Statement, err: Error | null, rows?: unknown[]) => void;

// Extended result codes, mapped to the names Sequelize checks for
const ERROR_CODES: Record<number, string> = {
  19: "SQLITE_CONSTRAINT",
  275: "SQLITE_CONSTRAINT_CHECK",
  787: "SQLITE_CONSTRAINT_FOREIGNKEY",
  1555: "SQLITE_CONSTRAINT_PRIMARYKEY",
  1811: "SQLITE_CONSTRAINT_TRIGGER",
  2067: "SQLITE_CONSTRAINT_UNIQUE",
};

/**
 * Result metadata of a query. Sequelize reads it from the callback's `this`, and checks the class name for bulk inserts.
 */
class Statement {
  public lastID = 0;
  public changes = 0;
}

function toError(error: unknown): Error {
  const err = error as Error & { errcode?: number; code?: string };
  if (typeof err.errcode === "number") {
    err.code = ERROR_CODES[err.errcode] ?? ERROR_CODES[err.errcode & 0xff] ?? "SQLITE_ERROR";
  }
  return err;
}

type BindValue = null | number | bigint | string | Uint8Array;

function toBindValue(value: unknown): BindValue {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value as BindValue;
}

function bindParameters(params: unknown): BindValue[] | [Record<string, BindValue>] {
  if (Array.isArray(params)) return params.map(toBindValue);
  if (params && typeof params === "object") {
    return [Object.fromEntries(Object.entries(params).map(([key, value]) => [key, toBindValue(value)]))];
  }
  return [];
}

export class Database {
  private _db: DatabaseSync | null = null;
  public filename: string;

  constructor(filename: string, _mode: number, callback?: (err: Error | null) => void) {
    this.filename = filename;
    try {
      this._db = new DatabaseSync(filename);
      if (filename !== ":memory:") this._db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
      queueMicrotask(() => callback?.(null));
    } catch (error) {
      queueMicrotask(() => callback?.(toError(error)));
    }
  }

  private get db() {
    if (!this._db) throw new Error("The SQLite database is not open.");
    return this._db;
  }

  /**
   * Queries already run one at a time, so this just runs `fn`.
   */
  public serialize(fn: () => void) {
    fn();
  }

  public run(sql: string, params?: unknown, callback?: Callback) {
    if (typeof params === "function") [callback, params] = [params as Callback, []];
    const meta = new Statement();
    try {
      const result = this.db.prepare(sql).run(...bindParameters(params) as BindValue[]);
      meta.lastID = Number(result.lastInsertRowid);
      meta.changes = Number(result.changes);
      callback?.call(meta, null);
    } catch (error) {
      callback?.call(meta, toError(error));
    }
    return this;
  }

  public all(sql: string, params?: unknown, callback?: Callback) {
    if (typeof params === "function") [callback, params] = [params as Callback, []];
    const meta = new Statement();
    try {
      const statement = this.db.prepare(sql);
      const bound = bindParameters(params) as BindValue[];
      // Statements without result columns (CREATE, DROP, BEGIN...) only need to run
      const rows = statement.columns().length > 0 ? statement.all(...bound) : (statement.run(...bound), []);
      callback?.call(meta, null, rows);
    } catch (error) {
      callback?.call(meta, toError(error));
    }
    return this;
  }

  public exec(sql: string, callback?: (err: Error | null) => void) {
    try {
      this.db.exec(sql);
      callback?.(null);
    } catch (error) {
      callback?.(toError(error));
    }
    return this;
  }

  public close(callback?: (err: Error | null) => void) {
    try {
      this._db?.close();
      this._db = null;
      callback?.(null);
    } catch (error) {
      callback?.(toError(error));
    }
  }
}

export const OPEN_READONLY = 1;
export const OPEN_READWRITE = 2;
export const OPEN_CREATE = 4;

export default { Database, OPEN_READONLY, OPEN_READWRITE, OPEN_CREATE };
