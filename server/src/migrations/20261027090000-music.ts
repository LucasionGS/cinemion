import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // SQLite has no unsigned integers
  const ID = qi.sequelize.getDialect() === "sqlite" ? DataTypes.INTEGER : DataTypes.INTEGER.UNSIGNED;

  // Who performs a track when it isn't the album's artist (compilations, guests)
  await qi.addColumn("media_items", "artist", { type: DataTypes.STRING(512), allowNull: true, defaultValue: null });
  // A music file's tags (title, artist, album, track number…) as JSON, so tracks can be sorted again without reading
  // every file
  await qi.addColumn("media_files", "tags", { type: DataTypes.TEXT, allowNull: true, defaultValue: null });

  // Each profile's playlists
  await qi.createTable("playlists", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    userId: { type: ID, allowNull: false, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
    name: { type: DataTypes.STRING(128), allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.createTable("playlist_items", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    playlistId: { type: ID, allowNull: false, references: { model: "playlists", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
    itemId: { type: ID, allowNull: false, references: { model: "media_items", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
    position: { type: DataTypes.INTEGER, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex("playlist_items", ["playlistId", "position"]);
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.dropTable("playlist_items");
  await qi.dropTable("playlists");
  await qi.removeColumn("media_files", "tags");
  await qi.removeColumn("media_items", "artist");
}
