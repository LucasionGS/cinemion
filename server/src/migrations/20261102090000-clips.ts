import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // SQLite has no unsigned integers
  const ID = qi.sequelize.getDialect() === "sqlite" ? DataTypes.INTEGER : DataTypes.INTEGER.UNSIGNED;

  // Clips in Clips libraries: where their game came from and what picture recognition suggests, as JSON
  await qi.addColumn("media_items", "clip", { type: DataTypes.TEXT, allowNull: true, defaultValue: null });
  // Starred clips, per profile
  await qi.addColumn("watch_states", "favorite", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  // What picture recognition saw in each clip, for finding clips that look alike
  await qi.createTable("clip_embeddings", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    itemId: { type: ID, allowNull: false, references: { model: "media_items", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
    model: { type: DataTypes.STRING(64), allowNull: false },
    mtime: { type: DataTypes.BIGINT, allowNull: false },
    vector: { type: DataTypes.TEXT, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex("clip_embeddings", ["itemId"], { unique: true });
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.dropTable("clip_embeddings");
  await qi.removeColumn("watch_states", "favorite");
  await qi.removeColumn("media_items", "clip");
}
