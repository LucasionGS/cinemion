import { Hono } from "hono";
import type { DashboardInfo, TasksOverview } from "@shared/admin.ts";
import type { TaskInfo } from "@shared/media.ts";
import AppSystem from "../AppSystem.ts";
import { Activity, Library, Setting, User } from "../models/index.ts";
import Scanner from "../library/Scanner.ts";
import ScanScheduler from "../library/ScanScheduler.ts";
import HardwareAcceleration from "../media/HardwareAcceleration.ts";
import TranscodeSession from "../media/TranscodeSession.ts";
import ActivePlayback from "../media/ActivePlayback.ts";
import Trickplay from "../media/Trickplay.ts";
import Markers from "../media/Markers.ts";
import SystemStats from "../lib/SystemStats.ts";
import SubtitleManager from "../subtitles/SubtitleManager.ts";
import SubtitleAutomation from "../subtitles/SubtitleAutomation.ts";
import Tasks from "../lib/Tasks.ts";
import { readJson } from "../lib/http.ts";
import log from "../lib/Logger.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * The server dashboard, tasks and logs in Settings.
 */
export namespace AdminController {
  export const router = new Hono<AppEnv>();

  /**
   * Choices for how often libraries are scanned, in hours.
   */
  export const SCAN_INTERVALS = [1, 3, 6, 12, 24, 48];

  router.use("*", User.$middleware({ permissions: ["SERVER_MANAGE"] }));

  /**
   * Add the library to task labels: "Making seek thumbnails · Shows".
   */
  async function withLibraryNames<T extends TaskInfo>(tasks: T[]): Promise<T[]> {
    const names = new Map((await Library.findAll({ attributes: ["id", "name"] })).map((l) => [l.id, l.name]));
    return tasks.map((t) => t.libraryId && names.has(t.libraryId) ? { ...t, label: `${t.label} · ${names.get(t.libraryId)}` } : t);
  }

  /**
   * @swagger
   * /api/admin/dashboard:
   *   get:
   *     summary: What's playing, resource use, running tasks and recent activity.
   */
  router.get("/dashboard", async (c) => {
    const settings = await HardwareAcceleration.settings();
    const libraries = await Library.findAll();
    const paths = libraries.flatMap((l) => l.paths);
    const [streams, stats, scheduled, activity] = await Promise.all([
      ActivePlayback.nowPlaying(),
      SystemStats.read({
        mediaPaths: paths.length > 0 ? paths : AppSystem.config.MEDIA_ROOTS,
        hardware: settings.hardwareAcceleration,
        device: settings.device,
        conversions: TranscodeSession.list().filter((s) => s.isConverting() && s.hardware !== "none").length,
      }),
      ScanScheduler.upcoming(),
      Activity.recent(12),
    ]);

    const info: DashboardInfo = {
      server: { name: await Setting.get(Setting.Keys.SERVER_NAME, AppSystem.APP_NAME), version: AppSystem.VERSION, startedAt: AppSystem.startedAt.toISOString() },
      streams,
      maxConversions: settings.maxConversions,
      stats,
      tasks: await withLibraryNames(Tasks.list()),
      nextScan: scheduled[0] ?? null,
      activity: activity.map((a) => a.toJSON()),
    };
    return c.json(info);
  });

  /**
   * @swagger
   * /api/admin/activity:
   *   get:
   *     summary: The activity feed, newest first. Query `before` (an id) and `limit` (up to 100).
   */
  router.get("/activity", async (c) => {
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "") || 50));
    const before = parseInt(c.req.query("before") ?? "") || undefined;
    return c.json((await Activity.recent(limit, before)).map((a) => a.toJSON()));
  });

  /**
   * @swagger
   * /api/admin/tasks:
   *   get:
   *     summary: Running and recent tasks, and when libraries are scanned next.
   */
  router.get("/tasks", async (c) => {
    const overview: TasksOverview = {
      running: await withLibraryNames(Tasks.list()),
      history: await withLibraryNames(Tasks.history()),
      scheduled: await ScanScheduler.upcoming(),
      scanIntervalHours: await ScanScheduler.intervalHours(),
    };
    return c.json(overview);
  });

  /**
   * @swagger
   * /api/admin/tasks/schedule:
   *   put:
   *     summary: How often libraries are scanned. Body `{ "scanIntervalHours": 6 }`.
   */
  router.put("/tasks/schedule", async (c) => {
    const body = await readJson<{ scanIntervalHours: number }>(c);
    const hours = Number(body?.scanIntervalHours);
    if (!SCAN_INTERVALS.includes(hours)) return c.json({ message: `Pick one of ${SCAN_INTERVALS.join(", ")} hours.` }, 400);
    await Setting.set(Setting.Keys.SCAN_INTERVAL_HOURS, hours);
    return c.json({ scanIntervalHours: hours, scheduled: await ScanScheduler.upcoming() });
  });

  /**
   * @swagger
   * /api/admin/tasks/scan:
   *   post:
   *     summary: Scan every library. With `{ "refresh": true }`, details are fetched again for everything.
   */
  router.post("/tasks/scan", async (c) => {
    const body = await readJson<{ refresh: boolean }>(c);
    const libraries = await Library.findAll();
    for (const library of libraries) Scanner.queue(library.id, { refreshMetadata: !!body?.refresh }).catch(() => { });
    log.info(body?.refresh ? "Refreshing details of every library" : "Scanning every library", { by: c.get("user")!.name });
    return c.json(Tasks.list());
  });

  /**
   * @swagger
   * /api/admin/tasks/thumbnails:
   *   post:
   *     summary: Make missing seek thumbnails. With `{ "remake": true }`, all of them are deleted and made again.
   */
  router.post("/tasks/thumbnails", async (c) => {
    const body = await readJson<{ remake: boolean }>(c);
    if (!(await HardwareAcceleration.settings()).seekThumbnails) {
      return c.json({ message: "Seek thumbnails are turned off in Settings › Playback." }, 400);
    }
    if (body?.remake) await Trickplay.clear();
    for (const library of await Library.findAll()) Trickplay.queueLibrary(library.id);
    return c.json(Tasks.list());
  });

  /**
   * @swagger
   * /api/admin/tasks/markers:
   *   post:
   *     summary: Find intros and credits in files not looked at yet. With `{ "redo": true }`, in every file again.
   */
  router.post("/tasks/markers", async (c) => {
    const body = await readJson<{ redo: boolean }>(c);
    for (const library of await Library.findAll()) Markers.queueLibrary(library.id, { redo: !!body?.redo });
    return c.json(Tasks.list());
  });

  /**
   * @swagger
   * /api/admin/tasks/subtitles:
   *   post:
   *     summary: Look for missing subtitles now in every movie and episode, even ones searched lately.
   */
  router.post("/tasks/subtitles", async (c) => {
    if (!await SubtitleManager.isAvailable()) return c.json({ message: "No subtitle site is set up. Turn one on in Settings › Subtitles." }, 400);
    SubtitleAutomation.queue({ force: true }).catch(() => { });
    return c.json(Tasks.list());
  });

  /**
   * @swagger
   * /api/admin/logs:
   *   get:
   *     summary: The last 1000 lines of the server log, oldest first. Query `after` (an id) for only newer lines.
   */
  router.get("/logs", (c) => {
    return c.json(log.recent(parseInt(c.req.query("after") ?? "") || 0));
  });
}

export default AdminController;
