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
    const hours = await Setting.get(Setting.Keys.SCAN_INTERVAL_HOURS, DEFAULT_INTERVAL_HOURS);
    const due = Date.now() - hours * 60 * 60 * 1000;
    for (const library of await Library.findAll()) {
      if (!library.lastScannedAt || library.lastScannedAt.getTime() < due) {
        Scanner.queue(library.id).catch(() => { });
      }
    }
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
