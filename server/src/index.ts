import AppSystem from "./AppSystem.ts";
import sequelize from "./models/index.ts";
import { executedMigrations, pendingMigrations, runPendingMigrations } from "./migrate.ts";
import createApp from "./app.ts";
import Ffmpeg from "./lib/Ffmpeg.ts";
import LibraryWatcher from "./library/LibraryWatcher.ts";
import ScanScheduler from "./library/ScanScheduler.ts";
import TranscodeSession from "./media/TranscodeSession.ts";
import WatchTogether from "./together/WatchTogether.ts";
import ActivePlayback from "./media/ActivePlayback.ts";
import SubtitleAutomation from "./subtitles/SubtitleAutomation.ts";
import OfflineCopies from "./media/OfflineCopies.ts";
import Uploads from "./library/Uploads.ts";
import ClipTools from "./clips/ClipTools.ts";
import UpdateCheck from "./lib/UpdateCheck.ts";
import Backups from "./backups/Backups.ts";
import Watchlist from "./library/Watchlist.ts";
import Https from "./https/Https.ts";
import Notifications from "./notifications/Notifications.ts";
import PlayLog from "./stats/PlayLog.ts";
import { Activity } from "./models/index.ts";
import log from "./lib/Logger.ts";

// The binary is also the maintenance CLI: "cinemion reset-password ion". Without arguments it runs the server.
if (Deno.args.length > 0) await import("./cli.ts");

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
  // An update that changes the database can be undone with the backup made just before
  const pending = await pendingMigrations();
  if (pending.length > 0 && (await executedMigrations()).length > 0) await Backups.beforeUpdate(pending);
  const applied = await runPendingMigrations();
  if (applied.length > 0) log.info("Applied database migrations", { applied });
}

const ffmpegVersion = await Ffmpeg.version();
if (!ffmpegVersion) log.warn(`ffmpeg was not found, so profile pictures and video conversion won't work. ${Ffmpeg.installHint()}`);

await TranscodeSession.init();
await Uploads.init();
await ClipTools.init();

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

await Https.start(app.fetch);
await LibraryWatcher.refresh();
ScanScheduler.start();
UpdateCheck.start();
Backups.start();
Watchlist.start();
Watchlist.onArrived((entry, item) => Notifications.watchlistArrived(entry.userId, item));

// Once a day: the activity feed keeps a couple of months, missing subtitles are looked for again, and offline copies
// nobody fetched lately are deleted
const daily = () => {
  Activity.prune().catch((error) => log.warn("Could not clean up old activity", { error }));
  SubtitleAutomation.queue().catch(() => { });
  OfflineCopies.prune();
  Notifications.prune().catch(() => { });
};
// The first run waits for startup scans to settle
const firstDaily = setTimeout(daily, 10 * 60 * 1000);
const dailyTimer = setInterval(daily, 24 * 60 * 60 * 1000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(signal, async () => {
    log.info("Shutting down");
    ScanScheduler.stop();
    UpdateCheck.stop();
    Backups.stop();
    Watchlist.stop();
    LibraryWatcher.stop();
    ActivePlayback.shutdown();
    Uploads.stop();
    clearTimeout(firstDaily);
    clearInterval(dailyTimer);
    await Https.stop();
    await PlayLog.stop();
    await TranscodeSession.shutdown();
    WatchTogether.shutdown();
    await server.shutdown();
    await sequelize.close();
    Deno.exit(0);
  });
}
