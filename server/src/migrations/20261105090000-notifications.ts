import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // SQLite has no unsigned integers
  const ID = qi.sequelize.getDialect() === "sqlite" ? DataTypes.INTEGER : DataTypes.INTEGER.UNSIGNED;

  // What the bell in the top bar lists. `data` holds the facts the text is made from, so it can be shown in any
  // language; `groupKey` lets new episodes of a show join one notification instead of making many
  await qi.createTable("notifications", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    userId: { type: ID, allowNull: false, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
    itemId: { type: ID, allowNull: true, defaultValue: null, references: { model: "media_items", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
    data: { type: DataTypes.TEXT, allowNull: false },
    groupKey: { type: DataTypes.STRING(128), allowNull: true, defaultValue: null },
    image: { type: DataTypes.STRING(64), allowNull: true, defaultValue: null },
    readAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex("notifications", ["userId", "updatedAt"]);
  await qi.addIndex("notifications", ["userId", "groupKey"]);

  // Browsers that get push notifications for a profile
  await qi.createTable("push_subscriptions", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    userId: { type: ID, allowNull: false, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
    endpoint: { type: DataTypes.TEXT, allowNull: false },
    // The endpoint is too long for a unique index on MariaDB, so its hash is the unique one
    endpointHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    p256dh: { type: DataTypes.STRING(128), allowNull: false },
    auth: { type: DataTypes.STRING(64), allowNull: false },
    device: { type: DataTypes.STRING(128), allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex("push_subscriptions", ["userId"]);
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.dropTable("push_subscriptions");
  await qi.dropTable("notifications");
}
