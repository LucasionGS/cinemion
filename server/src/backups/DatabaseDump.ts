import fsp from "node:fs/promises";
import Path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { QueryTypes, Transaction } from "sequelize";
import sequelize from "../models/sequelize.ts";
import { createUmzug } from "../migrate.ts";
import { migrations } from "../migrations/index.ts";
import log from "../lib/Logger.ts";

type Row = Record<string, unknown>;

/**
 * The database as plain JSON lines, one file per table, so a backup made on SQLite can be restored on MariaDB and the
 * other way around. Dates are written as ISO strings; everything else as it's stored.
 */
export namespace DatabaseDump {
  export interface TableInfo {
    name: string;
    rows: number;
  }

  export interface Result {
    tables: TableInfo[];
    /**
     * The migrations the database had, oldest first. A restore builds the same tables before filling them.
     */
    migrations: string[];
  }

  /**
   * Umzug's own bookkeeping; the list goes in the backup's manifest instead.
   */
  const MIGRATIONS_TABLE = "migrations";
  const BATCH = 200;

  function isDateType(type: string) {
    return /^(DATETIME|TIMESTAMP|DATE)\b/i.test(type);
  }

  function toPortable(row: Row, dateColumns: Set<string>): Row {
    for (const [key, value] of Object.entries(row)) {
      if (value instanceof Date) row[key] = value.toISOString();
      else if (typeof value === "bigint") row[key] = Number(value);
      else if (typeof value === "string" && dateColumns.has(key)) {
        // SQLite keeps dates as text: 2026-10-25 10:22:33.123 +00:00
        const date = new Date(value);
        if (!isNaN(date.getTime())) row[key] = date.toISOString();
      }
    }
    return row;
  }

  /**
   * Lines are written in batches; one write per row would make large tables slow.
   */
  class LineWriter {
    private _lines: string[] = [];
    private _size = 0;
    constructor(private _file: Deno.FsFile) { }

    public async add(line: string) {
      this._lines.push(line);
      this._size += line.length;
      if (this._size > 1024 * 1024) await this.flush();
    }

    public async flush() {
      if (this._lines.length === 0) return;
      const bytes = new TextEncoder().encode(this._lines.join("\n") + "\n");
      this._lines = [];
      this._size = 0;
      let at = 0;
      while (at < bytes.length) at += await this._file.write(bytes.subarray(at));
    }
  }

  /**
   * Write every table into `dir` as `<table>.jsonl`, from one consistent moment: a copy of the SQLite file, or a
   * snapshot transaction on MariaDB.
   */
  export async function exportTo(dir: string): Promise<Result> {
    await fsp.mkdir(dir, { recursive: true });
    return sequelize.getDialect() === "sqlite" ? await exportSqlite(dir) : await exportMariadb(dir);
  }

  async function writeTable(dir: string, name: string, rows: () => AsyncGenerator<Row[]> | Generator<Row[]>, dateColumns: Set<string>) {
    const file = await Deno.open(Path.join(dir, `${name}.jsonl`), { write: true, create: true, truncate: true });
    const writer = new LineWriter(file);
    let count = 0;
    try {
      for await (const batch of rows()) {
        for (const row of batch) {
          await writer.add(JSON.stringify(toPortable(row, dateColumns)));
          count++;
        }
      }
      await writer.flush();
    } finally {
      file.close();
    }
    return count;
  }

  async function exportSqlite(dir: string): Promise<Result> {
    const copy = Path.join(dir, "snapshot.db");
    await fsp.rm(copy, { force: true });
    // A copy taken in one go, so the tables match each other even while the server keeps writing
    await sequelize.query(`VACUUM INTO ${sequelize.escape(copy)}`);
    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
      const applied = names.includes(MIGRATIONS_TABLE)
        ? (db.prepare(`SELECT name FROM "${MIGRATIONS_TABLE}"`).all() as { name: string }[]).map((r) => r.name)
        : [];
      const tables: TableInfo[] = [];
      for (const name of names.filter((n) => n !== MIGRATIONS_TABLE)) {
        const columns = db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string; type: string }[];
        const dates = new Set(columns.filter((c) => isDateType(c.type)).map((c) => c.name));
        const rows = function* () {
          let batch: Row[] = [];
          for (const row of db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).iterate()) {
            batch.push({ ...(row as Row) });
            if (batch.length === 1000) {
              yield batch;
              batch = [];
            }
          }
          if (batch.length) yield batch;
        };
        tables.push({ name, rows: await writeTable(dir, name, rows, dates) });
      }
      return { tables, migrations: sortMigrations(applied) };
    } finally {
      db.close();
      await fsp.rm(copy, { force: true });
    }
  }

  async function exportMariadb(dir: string): Promise<Result> {
    const qi = sequelize.getQueryInterface();
    // Every read in this transaction sees the database as it was at its first read
    return await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async (transaction) => {
      const names = (await qi.showAllTables({ transaction }) as (string | { tableName: string })[]).map((t) => typeof t === "string" ? t : t.tableName).sort();
      const applied = names.includes(MIGRATIONS_TABLE)
        ? (await sequelize.query<{ name: string }>(`SELECT name FROM ${qi.quoteIdentifier(MIGRATIONS_TABLE)}`, { type: QueryTypes.SELECT, transaction })).map((r) => r.name)
        : [];
      const tables: TableInfo[] = [];
      for (const name of names.filter((n) => n !== MIGRATIONS_TABLE)) {
        const columns = await qi.describeTable(name);
        const dates = new Set(Object.entries(columns).filter(([, c]) => isDateType(c.type)).map(([key]) => key));
        const keys = Object.entries(columns).filter(([, c]) => c.primaryKey).map(([key]) => key);
        const order = (keys.length ? keys : Object.keys(columns)).map((k) => qi.quoteIdentifier(k)).join(", ");
        const rows = async function* () {
          for (let offset = 0; ; offset += 1000) {
            const batch = await sequelize.query<Row>(`SELECT * FROM ${qi.quoteIdentifier(name)} ORDER BY ${order} LIMIT 1000 OFFSET ${offset}`, { type: QueryTypes.SELECT, transaction });
            if (batch.length) yield batch;
            if (batch.length < 1000) return;
          }
        };
        tables.push({ name, rows: await writeTable(dir, name, rows, dates) });
      }
      return { tables, migrations: sortMigrations(applied) };
    });
  }

  function sortMigrations(names: string[]) {
    return [...names].sort();
  }

  /**
   * Migrations in a backup that this Cinemion doesn't have, which means the backup is from a newer version.
   */
  export function unknownMigrations(names: string[]) {
    const known = new Set(migrations.map((m) => m.name));
    return names.filter((name) => !known.has(name));
  }

  async function* readLines(path: string): AsyncGenerator<string> {
    const file = await Deno.open(path, { read: true });
    let rest = "";
    for await (const text of file.readable.pipeThrough(new TextDecoderStream())) {
      const parts = (rest + text).split("\n");
      rest = parts.pop()!;
      for (const line of parts) if (line) yield line;
    }
    if (rest) yield rest;
  }

  /**
   * Run `job` in one transaction with foreign keys unchecked, so rows can go in table by table even when a row points
   * at one that isn't in yet.
   */
  async function withoutForeignKeys(job: (transaction?: Transaction) => Promise<void>) {
    if (sequelize.getDialect() !== "sqlite") {
      await sequelize.transaction(async (transaction) => {
        await sequelize.query("SET FOREIGN_KEY_CHECKS = 0", { transaction });
        await job(transaction);
        await sequelize.query("SET FOREIGN_KEY_CHECKS = 1", { transaction });
      });
      return;
    }
    // Sequelize gives SQLite transactions a connection of their own, where foreign keys can't be turned off any more
    // (SQLite ignores the pragma inside a transaction), so this one runs on the main connection by hand
    await sequelize.query("PRAGMA foreign_keys = OFF");
    try {
      await sequelize.query("BEGIN");
      try {
        await job();
        await sequelize.query("COMMIT");
      } catch (error) {
        await sequelize.query("ROLLBACK").catch(() => { });
        throw error;
      }
    } finally {
      await sequelize.query("PRAGMA foreign_keys = ON");
    }
  }

  /**
   * Replace the whole database with the tables in `dir`: every table is dropped, the backup's migrations build the
   * tables it was made with, its rows go in, and then the migrations newer than the backup run as on any update.
   */
  export async function importFrom(dir: string, backupMigrations: string[], tables: TableInfo[], onProgress?: (done: number, total: number) => void) {
    const unknown = unknownMigrations(backupMigrations);
    if (unknown.length > 0) throw new Error("This backup was made by a newer Cinemion. Update Cinemion first, then restore it.");

    const qi = sequelize.getQueryInterface();
    await qi.dropAllTables();
    const umzug = createUmzug();
    const known = migrations.map((m) => m.name);
    const last = [...backupMigrations].sort((a, b) => known.indexOf(a) - known.indexOf(b)).at(-1);
    if (last) await umzug.up({ to: last });

    const total = tables.reduce((sum, t) => sum + t.rows, 0);
    let done = 0;
    await withoutForeignKeys(async (transaction) => {
      const existing = new Set((await qi.showAllTables({ transaction }) as (string | { tableName: string })[]).map((t) => typeof t === "string" ? t : t.tableName));
      for (const table of tables) {
        if (!existing.has(table.name)) {
          log.warn(`The backup has a table "${table.name}" this database doesn't; it was left out.`);
          continue;
        }
        const columns = await qi.describeTable(table.name);
        const dates = new Set(Object.entries(columns).filter(([, c]) => isDateType(c.type)).map(([key]) => key));
        // Migrations can add rows of their own, like the default roles
        await sequelize.query(`DELETE FROM ${qi.quoteIdentifier(table.name)}`, { transaction });

        let batch: Row[] = [];
        const flush = async () => {
          if (batch.length === 0) return;
          await qi.bulkInsert(table.name, batch, { transaction });
          done += batch.length;
          onProgress?.(done, total);
          batch = [];
        };
        for await (const line of readLines(Path.join(dir, `${table.name}.jsonl`))) {
          const source = JSON.parse(line) as Row;
          const row: Row = {};
          for (const [key, value] of Object.entries(source)) {
            if (!(key in columns)) continue;
            row[key] = dates.has(key) && typeof value === "string" ? new Date(value) : value;
          }
          batch.push(row);
          if (batch.length >= BATCH) await flush();
        }
        await flush();
      }
    });
    await umzug.up();
  }
}

export default DatabaseDump;
