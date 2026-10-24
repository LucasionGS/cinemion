import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // SHA-256 of files that came in through Podium uploads, so the same file sent again is recognised
  await qi.addColumn("media_files", "sha256", { type: DataTypes.STRING(64), allowNull: true, defaultValue: null });
  await qi.addIndex("media_files", ["sha256"]);
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.removeIndex("media_files", ["sha256"]);
  await qi.removeColumn("media_files", "sha256");
}
