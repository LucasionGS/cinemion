import AppSystem from "./AppSystem.ts";
import sequelize from "./models/index.ts";
import { runPendingMigrations } from "./migrate.ts";
import createApp from "./app.ts";
import Ffmpeg from "./lib/Ffmpeg.ts";
import LibraryWatcher from "./library/LibraryWatcher.ts";
import ScanScheduler from "./library/ScanScheduler.ts";
import TranscodeSession from "./media/TranscodeSession.ts";
import WatchTogether from "./together/WatchTogether.ts";
import log from "./lib/Logger.ts";

addEventListener("unhandledrejection", (event) => {
  // One failed background task must not take the whole server down
  log.error("Unhandled promise rejection", { error: event.reason });
  event.preventDefault();
});

await AppSystem.init();

await sequelize.authenticate().catch((error) => {
  const { config } = AppSystem;
  const where = config.DB_DIALECT === "mariadb" ? `MariaDB at ${config.DB_HOST}:${config.DB_PORT}` : `the SQLite database at ${AppSystem.databaseFile}`;
  log.error(`Could not open ${where}.`, { error: error.message });
  Deno.exit(1);
});

if (AppSystem.config.AUTO_MIGRATE) {
  const applied = await runPendingMigrations();
  if (applied.length > 0) log.info("Applied database migrations", { applied });
}

const ffmpegVersion = await Ffmpeg.version();
if (!ffmpegVersion) log.warn(`ffmpeg was not found, so profile pictures and video conversion won't work. ${Ffmpeg.installHint()}`);

await TranscodeSession.init();

const app = createApp();
const server = Deno.serve({
  port: AppSystem.config.PORT,
  hostname: "0.0.0.0",
  onListen: ({ port }) => {
    log.info(`${AppSystem.APP_NAME} ${AppSystem.VERSION} is running on http://localhost:${port}`, {
      config: AppSystem.config.CONFIG_DIR,
      mediaRoots: AppSystem.config.MEDIA_ROOTS,
      ffmpeg: ffmpegVersion,
      mode: AppSystem.config.APP_ENV,
    });
  },
}, app.fetch);

await LibraryWatcher.refresh();
ScanScheduler.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(signal, async () => {
    log.info("Shutting down");
    ScanScheduler.stop();
    LibraryWatcher.stop();
    await TranscodeSession.shutdown();
    WatchTogether.shutdown();
    await server.shutdown();
    await sequelize.close();
    Deno.exit(0);
  });
}
