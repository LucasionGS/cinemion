import type { ScheduledScan } from "@shared/admin.ts";
import { Library, Setting } from "../models/index.ts";
import Scanner from "./Scanner.ts";

/**
 * Rescans libraries every few hours, and right away at startup when one has never been scanned.
 */
export namespace ScanScheduler {
  const CHECK_EVERY_MS = 15 * 60 * 1000;
  export const DEFAULT_INTERVAL_HOURS = 6;

  let _timer: ReturnType<typeof setInterval> | null = null;

  async function check() {
    const hours = await intervalHours();
    const due = Date.now() - hours * 60 * 60 * 1000;
    for (const library of await Library.findAll()) {
      if (!library.lastScannedAt || library.lastScannedAt.getTime() < due) {
        Scanner.queue(library.id).catch(() => { });
      }
    }
  }

  export async function intervalHours() {
    return await Setting.get(Setting.Keys.SCAN_INTERVAL_HOURS, DEFAULT_INTERVAL_HOURS);
  }

  /**
   * When each library is scanned next, soonest first.
   */
  export async function upcoming(): Promise<ScheduledScan[]> {
    const hours = await intervalHours();
    const libraries = await Library.findAll();
    return libraries.map((library) => ({
      libraryId: library.id,
      libraryName: library.name,
      lastScannedAt: library.lastScannedAt?.toISOString() ?? null,
      nextAt: new Date(library.lastScannedAt ? library.lastScannedAt.getTime() + hours * 60 * 60 * 1000 : Date.now()).toISOString(),
    })).sort((a, b) => a.nextAt.localeCompare(b.nextAt));
  }

  export function start() {
    if (_timer !== null) return;
    check();
    _timer = setInterval(check, CHECK_EVERY_MS);
  }

  export function stop() {
    if (_timer !== null) clearInterval(_timer);
    _timer = null;
  }
}

export default ScanScheduler;
