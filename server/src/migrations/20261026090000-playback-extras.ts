import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // Intros and credits of a file, as JSON, and which version of the detection last looked at it (0 = never)
  await qi.addColumn("media_files", "markers", { type: DataTypes.TEXT, allowNull: false, defaultValue: "[]" });
  await qi.addColumn("media_files", "markersVersion", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  // Per-profile preferences, like how subtitles look, as JSON
  await qi.addColumn("users", "preferences", { type: DataTypes.TEXT, allowNull: false, defaultValue: "{}" });
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.removeColumn("users", "preferences");
  await qi.removeColumn("media_files", "markersVersion");
  await qi.removeColumn("media_files", "markers");
}
