import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // SQLite has no unsigned integers
  const ID = qi.sequelize.getDialect() === "sqlite" ? DataTypes.INTEGER : DataTypes.INTEGER.UNSIGNED;

  // The dashboard's activity feed. The message is stored ready to show, so it still reads right after the
  // profile or title is gone.
  await qi.createTable("activities", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    kind: { type: DataTypes.STRING(32), allowNull: false },
    message: { type: DataTypes.STRING(512), allowNull: false },
    userId: { type: ID, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
    itemId: { type: ID, allowNull: true, references: { model: "media_items", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
    createdAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex("activities", ["createdAt"]);

  // Outgoing webhooks
  await qi.createTable("webhooks", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(64), allowNull: false },
    url: { type: DataTypes.STRING(2048), allowNull: false },
    secret: { type: DataTypes.STRING(128), allowNull: false },
    events: { type: DataTypes.TEXT, allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    lastDelivery: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.dropTable("webhooks");
  await qi.dropTable("activities");
}
