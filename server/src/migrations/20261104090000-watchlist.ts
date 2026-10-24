import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // SQLite has no unsigned integers
  const ID = qi.sequelize.getDialect() === "sqlite" ? DataTypes.INTEGER : DataTypes.INTEGER.UNSIGNED;

  // Each profile's "My list". An entry points at a title in a library, or only knows its name and ids (added on Trakt
  // before it was here), so it can be linked once the title arrives
  await qi.createTable("watchlist_items", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    userId: { type: ID, allowNull: false, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
    itemId: { type: ID, allowNull: true, defaultValue: null, references: { model: "media_items", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
    kind: { type: DataTypes.STRING(16), allowNull: false },
    title: { type: DataTypes.STRING(512), allowNull: false },
    year: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
    externalIds: { type: DataTypes.TEXT, allowNull: false, defaultValue: "{}" },
    onTrakt: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    arrivedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex("watchlist_items", ["userId", "itemId"]);
  await qi.addIndex("watchlist_items", ["itemId"]);
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.dropTable("watchlist_items");
}
