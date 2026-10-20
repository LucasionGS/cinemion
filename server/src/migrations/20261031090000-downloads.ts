import type { QueryInterface } from "sequelize";

// Profiles may save videos for offline viewing, like they may convert and download subtitles
export async function up({ context: qi }: { context: QueryInterface }) {
  const [rows] = await qi.sequelize.query("SELECT id, permissions FROM roles WHERE name = 'user'") as [{ id: number; permissions: string }[], unknown];
  for (const row of rows) {
    const permissions: string[] = JSON.parse(row.permissions || "[]");
    if (permissions.includes("MEDIA_DOWNLOAD")) continue;
    permissions.push("MEDIA_DOWNLOAD");
    await qi.bulkUpdate("roles", { permissions: JSON.stringify(permissions) }, { id: row.id });
  }
}

export async function down({ context: qi }: { context: QueryInterface }) {
  const [rows] = await qi.sequelize.query("SELECT id, permissions FROM roles WHERE name = 'user'") as [{ id: number; permissions: string }[], unknown];
  for (const row of rows) {
    const permissions = (JSON.parse(row.permissions || "[]") as string[]).filter((p) => p !== "MEDIA_DOWNLOAD");
    await qi.bulkUpdate("roles", { permissions: JSON.stringify(permissions) }, { id: row.id });
  }
}
