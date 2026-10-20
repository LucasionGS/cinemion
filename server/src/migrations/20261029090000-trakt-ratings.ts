import { DataTypes, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // Ratings from IMDb, Rotten Tomatoes and Metacritic (through OMDb), as JSON
  await qi.addColumn("media_items", "ratings", { type: DataTypes.TEXT, allowNull: true, defaultValue: null });
  // A profile's Trakt account: tokens and username, as JSON. Never sent to the client.
  await qi.addColumn("users", "trakt", { type: DataTypes.TEXT, allowNull: true, defaultValue: null });
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.removeColumn("users", "trakt");
  await qi.removeColumn("media_items", "ratings");
}
