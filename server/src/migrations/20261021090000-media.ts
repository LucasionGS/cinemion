import { DataTypes, type QueryInterface } from "sequelize";

const timestamps = {
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false },
};

export async function up({ context: qi }: { context: QueryInterface }) {
  // SQLite has no unsigned integers
  const ID = qi.sequelize.getDialect() === "sqlite" ? DataTypes.INTEGER : DataTypes.INTEGER.UNSIGNED;
  const ref = (model: string, onDelete: "CASCADE" | "SET NULL" = "CASCADE") => ({
    type: ID,
    references: { model, key: "id" },
    onUpdate: "CASCADE",
    onDelete,
  });

  await qi.addColumn("libraries", "lastScannedAt", { type: DataTypes.DATE, allowNull: true });

  // Movies, shows, seasons and episodes in one table, linked by parentId
  await qi.createTable("media_items", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    libraryId: { ...ref("libraries"), allowNull: false },
    parentId: { ...ref("media_items"), allowNull: true },
    type: { type: DataTypes.STRING(16), allowNull: false },
    // Folder a show was found in, so it's recognised again on the next scan
    folderPath: { type: DataTypes.STRING(1024), allowNull: true },
    title: { type: DataTypes.STRING(512), allowNull: false },
    sortTitle: { type: DataTypes.STRING(512), allowNull: false },
    originalTitle: { type: DataTypes.STRING(512), allowNull: true },
    year: { type: DataTypes.INTEGER, allowNull: true },
    seasonNumber: { type: DataTypes.INTEGER, allowNull: true },
    episodeNumber: { type: DataTypes.INTEGER, allowNull: true },
    episodeEnd: { type: DataTypes.INTEGER, allowNull: true },
    overview: { type: DataTypes.TEXT, allowNull: true },
    tagline: { type: DataTypes.STRING(512), allowNull: true },
    runtime: { type: DataTypes.INTEGER, allowNull: true },
    releaseDate: { type: DataTypes.STRING(10), allowNull: true },
    rating: { type: DataTypes.FLOAT, allowNull: true },
    contentRating: { type: DataTypes.STRING(16), allowNull: true },
    genres: { type: DataTypes.TEXT, allowNull: false },
    studios: { type: DataTypes.TEXT, allowNull: false },
    externalIds: { type: DataTypes.TEXT, allowNull: false },
    artwork: { type: DataTypes.TEXT, allowNull: false },
    palette: { type: DataTypes.TEXT, allowNull: true },
    matchStatus: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "unmatched" },
    metadataUpdatedAt: { type: DataTypes.DATE, allowNull: true },
    addedAt: { type: DataTypes.DATE, allowNull: false },
    ...timestamps,
  });
  await qi.addIndex("media_items", ["libraryId", "type"]);
  await qi.addIndex("media_items", ["parentId"]);
  await qi.addIndex("media_items", ["sortTitle"]);

  await qi.createTable("media_files", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    libraryId: { ...ref("libraries"), allowNull: false },
    itemId: { ...ref("media_items"), allowNull: true },
    path: { type: DataTypes.STRING(1024), allowNull: false },
    size: { type: DataTypes.BIGINT, allowNull: false },
    mtime: { type: DataTypes.BIGINT, allowNull: false },
    container: { type: DataTypes.STRING(64), allowNull: true },
    duration: { type: DataTypes.FLOAT, allowNull: true },
    bitrate: { type: DataTypes.INTEGER, allowNull: true },
    videoCodec: { type: DataTypes.STRING(32), allowNull: true },
    width: { type: DataTypes.INTEGER, allowNull: true },
    height: { type: DataTypes.INTEGER, allowNull: true },
    hdr: { type: DataTypes.STRING(16), allowNull: true },
    audio: { type: DataTypes.TEXT, allowNull: false },
    subtitles: { type: DataTypes.TEXT, allowNull: false },
    probedAt: { type: DataTypes.DATE, allowNull: true },
    ...timestamps,
  });
  await qi.addIndex("media_files", ["path"], { unique: true });
  await qi.addIndex("media_files", ["itemId"]);

  await qi.createTable("people", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(256), allowNull: false },
    tmdbId: { type: DataTypes.STRING(32), allowNull: true },
    photo: { type: DataTypes.STRING(64), allowNull: true },
    ...timestamps,
  });
  await qi.addIndex("people", ["tmdbId"]);
  await qi.addIndex("people", ["name"]);

  await qi.createTable("credits", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    itemId: { ...ref("media_items"), allowNull: false },
    personId: { ...ref("people"), allowNull: false },
    kind: { type: DataTypes.STRING(16), allowNull: false },
    character: { type: DataTypes.STRING(256), allowNull: true },
    order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  });
  await qi.addIndex("credits", ["itemId"]);
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.dropTable("credits");
  await qi.dropTable("people");
  await qi.dropTable("media_files");
  await qi.dropTable("media_items");
  await qi.removeColumn("libraries", "lastScannedAt");
}
