import Path from "node:path";
import { Library } from "../models/index.ts";
import NameParser from "./NameParser.ts";
import Scanner from "./Scanner.ts";
import Sidecars from "./Sidecars.ts";
import log from "../lib/Logger.ts";

/**
 * Notices new, changed and removed files in library folders and scans the library shortly after.
 * Network shares often don't report changes, so the scheduled scans in `ScanScheduler` back this up.
 */
export namespace LibraryWatcher {
  // Wait for copies to settle before scanning; a large file arrives in many write events
  const DEBOUNCE_MS = 15_000;

  const _watchers = new Map<number, Deno.FsWatcher[]>();
  const _timers = new Map<number, ReturnType<typeof setTimeout>>();

  function relevant(event: Deno.FsEvent) {
    // Folder changes have no extension; anything else must be a video or subtitle file to matter
    return event.paths.some((p) => NameParser.isVideo(p) || Sidecars.isSubtitle(p) || Path.extname(p) === "");
  }

  function schedule(libraryId: number) {
    clearTimeout(_timers.get(libraryId));
    _timers.set(libraryId, setTimeout(() => {
      _timers.delete(libraryId);
      Scanner.queue(libraryId).catch(() => { });
    }, DEBOUNCE_MS));
  }

  function watch(library: Library) {
    const watchers: Deno.FsWatcher[] = [];
    for (const path of library.paths) {
      try {
        const watcher = Deno.watchFs(path, { recursive: true });
        watchers.push(watcher);
        (async () => {
          try {
            for await (const event of watcher) {
              if (event.kind !== "access" && relevant(event)) schedule(library.id);
            }
          } catch {
            // Closed, or the folder went away
          }
        })();
      } catch (error) {
        // Usually the inotify watch limit on very large libraries
        log.warn(`Can't watch ${path} for changes, so new files show up at the next scheduled scan.`, { error });
      }
    }
    _watchers.set(library.id, watchers);
  }

  function unwatch(libraryId: number) {
    for (const watcher of _watchers.get(libraryId) ?? []) {
      try {
        watcher.close();
      } catch {
        // Already closed
      }
    }
    _watchers.delete(libraryId);
    clearTimeout(_timers.get(libraryId));
    _timers.delete(libraryId);
  }

  /**
   * Watch every library. Call again after libraries are added or removed.
   */
  export async function refresh() {
    for (const id of [..._watchers.keys()]) unwatch(id);
    for (const library of await Library.findAll()) watch(library);
  }

  export function stop() {
    for (const id of [..._watchers.keys()]) unwatch(id);
  }
}

export default LibraryWatcher;
