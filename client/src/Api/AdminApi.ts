import type { ActivityInfo, DashboardInfo, LogEntry, ScheduledScan, TasksOverview } from "@shared/admin.ts";
import type { TaskInfo } from "@shared/media.ts";
import BaseApi from "./BaseApi.ts";

/**
 * The server dashboard, tasks and logs.
 */
export namespace AdminApi {
  export function dashboard() {
    return BaseApi.GET<DashboardInfo>("/admin/dashboard");
  }

  /**
   * The activity feed, newest first. With `before`, only lines older than that id.
   */
  export function activity(before?: number) {
    return BaseApi.GET<ActivityInfo[]>(`/admin/activity${before ? `?before=${before}` : ""}`);
  }

  export function tasks() {
    return BaseApi.GET<TasksOverview>("/admin/tasks");
  }

  export function setScanInterval(scanIntervalHours: number) {
    return BaseApi.PUT<{ scanIntervalHours: number; scheduled: ScheduledScan[] }>("/admin/tasks/schedule", { scanIntervalHours });
  }

  /**
   * Scan every library. With `refresh`, details are fetched again for everything.
   */
  export function scanAll(refresh = false) {
    return BaseApi.POST<TaskInfo[]>("/admin/tasks/scan", { refresh });
  }

  /**
   * Make missing seek thumbnails, or all of them again with `remake`.
   */
  export function thumbnails(remake = false) {
    return BaseApi.POST<TaskInfo[]>("/admin/tasks/thumbnails", { remake });
  }

  /**
   * Server log lines, oldest first. With `after`, only lines newer than that id.
   */
  export function logs(after = 0) {
    return BaseApi.GET<LogEntry[]>(`/admin/logs?after=${after}`);
  }
}

export default AdminApi;
