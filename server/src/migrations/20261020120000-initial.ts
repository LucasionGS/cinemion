import { DataTypes, type QueryInterface } from "sequelize";

const timestamps = {
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false },
};

export async function up({ context: qi }: { context: QueryInterface }) {
  // SQLite has no unsigned integers
  const ID = qi.sequelize.getDialect() === "sqlite" ? DataTypes.INTEGER : DataTypes.INTEGER.UNSIGNED;

  await qi.createTable("roles", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    permissions: { type: DataTypes.TEXT, allowNull: false },
    inheritsId: { type: ID, allowNull: true },
    ...timestamps,
  });

  await qi.createTable("users", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    username: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(40), allowNull: false },
    password: { type: DataTypes.STRING, allowNull: true },
    pin: { type: DataTypes.STRING, allowNull: true },
    color: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "sky" },
    avatar: { type: DataTypes.STRING(32), allowNull: true },
    showOnPicker: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    maxRating: { type: DataTypes.STRING(16), allowNull: true },
    libraryAccess: { type: DataTypes.TEXT, allowNull: true },
    roleId: {
      type: ID,
      allowNull: false,
      references: { model: "roles", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    ...timestamps,
  });

  await qi.createTable("settings", {
    key: { type: DataTypes.STRING(64), primaryKey: true },
    value: { type: DataTypes.TEXT, allowNull: false },
  });

  await qi.createTable("libraries", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(60), allowNull: false },
    type: { type: DataTypes.STRING(16), allowNull: false },
    paths: { type: DataTypes.TEXT, allowNull: false },
    ...timestamps,
  });

  // Default roles. Admins pass every permission check by name, so they need no list.
  const now = new Date();
  await qi.bulkInsert("roles", [
    { name: "admin", permissions: "[]", inheritsId: null, createdAt: now, updatedAt: now },
    { name: "user", permissions: JSON.stringify(["TRANSCODE_ALLOW", "SUBTITLES_DOWNLOAD"]), inheritsId: null, createdAt: now, updatedAt: now },
  ]);
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.dropTable("libraries");
  await qi.dropTable("settings");
  await qi.dropTable("users");
  await qi.dropTable("roles");
}
