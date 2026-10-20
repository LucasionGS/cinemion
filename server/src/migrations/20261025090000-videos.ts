import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // Videos libraries: the rating unrated videos get, so age-limited profiles can see family videos
  await qi.addColumn("libraries", "defaultRating", { type: DataTypes.STRING(16), allowNull: true });
  // Hand-made details and thumbnails of videos and folders, which refreshes must keep
  await qi.addColumn("media_items", "editedAt", { type: DataTypes.DATE, allowNull: true });
  await qi.addColumn("media_items", "customArtwork", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.removeColumn("media_items", "customArtwork");
  await qi.removeColumn("media_items", "editedAt");
  await qi.removeColumn("libraries", "defaultRating");
}
