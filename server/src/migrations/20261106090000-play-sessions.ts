import { DataTypes, type QueryInterface, QueryTypes } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  // SQLite has no unsigned integers
  const ID = qi.sequelize.getDialect() === "sqlite" ? DataTypes.INTEGER : DataTypes.INTEGER.UNSIGNED;

  // Time spent watching, listening and reading, for statistics: one row per sitting
  await qi.createTable("play_sessions", {
    id: { type: ID, autoIncrement: true, primaryKey: true },
    userId: { type: ID, allowNull: false, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
    itemId: { type: ID, allowNull: true, defaultValue: null, references: { model: "media_items", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
    kind: { type: DataTypes.STRING(16), allowNull: false },
    startedAt: { type: DataTypes.DATE, allowNull: false },
    seconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex("play_sessions", ["userId", "startedAt"]);
  await qi.addIndex("play_sessions", ["itemId"]);

  // What was watched before there was a log: one sitting per finished title, at the time it was last watched
  const states = await qi.sequelize.query<{ userId: number; itemId: number; duration: number | null; playCount: number; lastWatchedAt: string | Date; watched: number | boolean; type: string; runtime: number | null }>(
    "SELECT ws.userId, ws.itemId, ws.duration, ws.playCount, ws.lastWatchedAt, ws.watched, mi.type, mi.runtime FROM watch_states ws JOIN media_items mi ON mi.id = ws.itemId WHERE ws.lastWatchedAt IS NOT NULL",
    { type: QueryTypes.SELECT },
  );
  const tracks = states.filter((s) => s.type === "track").map((s) => s.itemId);
  const trackSeconds = new Map<number, number>();
  for (let i = 0; i < tracks.length; i += 500) {
    const rows = await qi.sequelize.query<{ itemId: number; duration: number | null }>(
      `SELECT itemId, duration FROM media_files WHERE itemId IN (${tracks.slice(i, i + 500).map(Number).join(",")})`,
      { type: QueryTypes.SELECT },
    );
    for (const row of rows) trackSeconds.set(row.itemId, row.duration ?? 0);
  }
  const now = new Date();
  const rows = [];
  for (const state of states) {
    const at = new Date(state.lastWatchedAt);
    if (isNaN(at.getTime())) continue;
    let seconds = 0;
    if (["movie", "episode", "video"].includes(state.type) && state.watched) seconds = Math.round(state.duration ?? (state.runtime ?? 0) * 60);
    else if (state.type === "track" && state.playCount > 0) seconds = Math.round((trackSeconds.get(state.itemId) ?? 0) * state.playCount);
    else if (state.type === "audiobook" && state.watched) seconds = Math.round(state.duration ?? 0);
    if (seconds <= 0) continue;
    rows.push({ userId: state.userId, itemId: state.itemId, kind: state.type, startedAt: at, seconds, createdAt: now, updatedAt: now });
  }
  for (let i = 0; i < rows.length; i += 200) await qi.bulkInsert("play_sessions", rows.slice(i, i + 200));
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.dropTable("play_sessions");
}
