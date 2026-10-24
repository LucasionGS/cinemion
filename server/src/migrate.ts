import { SequelizeStorage, Umzug } from "umzug";
import type { QueryInterface } from "sequelize";
import sequelize from "./models/index.ts";
import { migrations } from "./migrations/index.ts";
import AppSystem from "./AppSystem.ts";
import log from "./lib/Logger.ts";

/**
 * The migration runner, with every migration Cinemion knows.
 */
export function createUmzug() {
  const queryInterface = sequelize.getQueryInterface();
  return new Umzug<QueryInterface>({
    migrations: migrations.map((m) => ({
      name: m.name,
      up: ({ context }) => m.up({ context }),
      down: ({ context }) => m.down({ context }),
    })),
    context: queryInterface,
    storage: new SequelizeStorage({ sequelize, tableName: "migrations" }),
    logger: undefined,
  });
}

/**
 * Apply every migration that hasn't run yet. Returns the names of the ones applied.
 */
export async function runPendingMigrations() {
  const applied = await createUmzug().up();
  return applied.map((m) => m.name);
}

/**
 * Names of the migrations that haven't run yet, oldest first.
 */
export async function pendingMigrations() {
  return (await createUmzug().pending()).map((m) => m.name);
}

/**
 * Names of the migrations that have run, oldest first.
 */
export async function executedMigrations() {
  return (await createUmzug().executed()).map((m) => m.name);
}

// Run directly: `deno task migrate` applies pending migrations, `deno task migrate down` reverts the last one
if (import.meta.main) {
  await AppSystem.init();
  const umzug = createUmzug();
  if (Deno.args[0] === "down") {
    const reverted = await umzug.down();
    log.info(reverted.length ? `Reverted ${reverted.map((m) => m.name).join(", ")}` : "Nothing to revert.");
  }
  else {
    const applied = await umzug.up();
    log.info(applied.length ? `Applied ${applied.map((m) => m.name).join(", ")}` : "The database is up to date.");
  }
  await sequelize.close();
}
