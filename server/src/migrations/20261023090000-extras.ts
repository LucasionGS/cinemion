import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // Subtitle files next to a video (or downloaded for it), as JSON
  await qi.addColumn("media_files", "sidecars", { type: DataTypes.TEXT, allowNull: false, defaultValue: "[]" });
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.removeColumn("media_files", "sidecars");
}
