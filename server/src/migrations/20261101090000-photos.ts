import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // SQLite has no unsigned integers
  const ID = qi.sequelize.getDialect() === "sqlite" ? DataTypes.INTEGER : DataTypes.INTEGER.UNSIGNED;

  // When a photo was taken (or a video in a Photos library recorded), on the camera's clock, so photos sort by the
  // minute and not just the day
  await qi.addColumn("media_items", "takenAt", { type: DataTypes.STRING(19), allowNull: true, defaultValue: null });
  await qi.addIndex("media_items", ["libraryId", "takenAt"]);
  // What a photo's EXIF says (camera, exposure, place), as JSON
  await qi.addColumn("media_files", "photo", { type: DataTypes.TEXT, allowNull: true, defaultValue: null });

  // Albums people make from photos anywhere in a library
  await qi.createTable("photo_albums", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    libraryId: { type: ID, allowNull: false, references: { model: "libraries", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
    userId: { type: ID, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
    title: { type: DataTypes.STRING(128), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    coverItemId: { type: ID, allowNull: true, defaultValue: null },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.createTable("photo_album_items", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    albumId: { type: ID, allowNull: false, references: { model: "photo_albums", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
    itemId: { type: ID, allowNull: false, references: { model: "media_items", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
    createdAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex("photo_album_items", ["albumId", "itemId"], { unique: true });
  await qi.addIndex("photo_album_items", ["itemId"]);
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.dropTable("photo_album_items");
  await qi.dropTable("photo_albums");
  await qi.removeColumn("media_files", "photo");
  await qi.removeIndex("media_items", ["libraryId", "takenAt"]);
  await qi.removeColumn("media_items", "takenAt");
}
