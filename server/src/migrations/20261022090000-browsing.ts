import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // SQLite has no unsigned integers
  const ID = qi.sequelize.getDialect() === "sqlite" ? DataTypes.INTEGER : DataTypes.INTEGER.UNSIGNED;

  await qi.createTable("collections", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    libraryId: { type: ID, allowNull: false, references: { model: "libraries", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
    name: { type: DataTypes.STRING(256), allowNull: false },
    sortName: { type: DataTypes.STRING(256), allowNull: false },
    tmdbId: { type: DataTypes.STRING(32), allowNull: true },
    overview: { type: DataTypes.TEXT, allowNull: true },
    artwork: { type: DataTypes.TEXT, allowNull: false },
    palette: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex("collections", ["libraryId", "tmdbId"]);

  await qi.addColumn("media_items", "collectionId", {
    type: ID,
    allowNull: true,
    references: { model: "collections", key: "id" },
    onUpdate: "CASCADE",
    onDelete: "SET NULL",
  });
  // Minimum age from the content rating, so profile limits can filter in SQL. NULL = unrated.
  await qi.addColumn("media_items", "ageRating", { type: DataTypes.INTEGER, allowNull: true });

  // Per-profile progress on movies and episodes
  await qi.createTable("watch_states", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    userId: { type: ID, allowNull: false, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
    itemId: { type: ID, allowNull: false, references: { model: "media_items", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
    position: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    duration: { type: DataTypes.FLOAT, allowNull: true },
    watched: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    playCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastWatchedAt: { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex("watch_states", ["userId", "itemId"], { unique: true });
  await qi.addIndex("watch_states", ["userId", "lastWatchedAt"]);
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.dropTable("watch_states");
  await qi.removeColumn("media_items", "ageRating");
  await qi.removeColumn("media_items", "collectionId");
  await qi.dropTable("collections");
}
