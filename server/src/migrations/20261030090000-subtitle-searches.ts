import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // Automatic subtitle searches per language for a file, as JSON, so missing ones are retried now and then, not always
  await qi.addColumn("media_files", "subtitleSearches", { type: DataTypes.TEXT, allowNull: true, defaultValue: null });
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.removeColumn("media_files", "subtitleSearches");
}
