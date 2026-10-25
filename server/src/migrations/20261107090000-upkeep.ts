import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // Why a file is broken (can't be read, cut short, failed to convert), for the upkeep page. `null` = fine
  await qi.addColumn("media_files", "problem", { type: DataTypes.STRING(512), allowNull: true, defaultValue: null });
  await qi.addColumn("media_files", "checkedAt", { type: DataTypes.DATE, allowNull: true, defaultValue: null });
  // The episodes a show has according to TMDB or TheTVDB, to show the ones missing here
  await qi.addColumn("media_items", "episodeGuide", { type: DataTypes.TEXT, allowNull: true, defaultValue: null });
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.removeColumn("media_items", "episodeGuide");
  await qi.removeColumn("media_files", "checkedAt");
  await qi.removeColumn("media_files", "problem");
}
