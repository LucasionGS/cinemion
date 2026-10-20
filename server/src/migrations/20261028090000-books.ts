import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // Chapters inside an audiobook file, as JSON
  await qi.addColumn("media_files", "chapters", { type: DataTypes.TEXT, allowNull: true, defaultValue: null });
  // Where reading stopped in a book, like "4:0.35" (chapter and how far into it)
  await qi.addColumn("watch_states", "bookmark", { type: DataTypes.STRING(512), allowNull: true, defaultValue: null });
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.removeColumn("watch_states", "bookmark");
  await qi.removeColumn("media_files", "chapters");
}
