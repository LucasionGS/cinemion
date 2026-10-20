import fsp from "node:fs/promises";
import Path from "node:path";
import type { FsListing } from "@shared/api.ts";
import AppSystem from "../AppSystem.ts";

/**
 * Folder browsing limited to `MEDIA_ROOTS`, so the web UI can't look around the rest of the filesystem.
 */
export namespace MediaRoots {
  export function roots() {
    return AppSystem.config.MEDIA_ROOTS;
  }

  function isInside(path: string, root: string) {
    return path === root || path.startsWith(root.endsWith(Path.sep) ? root : root + Path.sep);
  }

  /**
   * Resolve `path` (following symlinks) and find the allowed root it's in. `null` when it's outside every root.
   */
  async function locate(path: string): Promise<{ real: string; root: string } | null> {
    if (!Path.isAbsolute(path)) return null;
    const real = await fsp.realpath(path).catch(() => null);
    if (!real) return null;
    const allowed = await Promise.all(roots().map((root) => fsp.realpath(root).catch(() => root)));
    const root = allowed.find((r) => isInside(real, r));
    return root ? { real, root } : null;
  }

  /**
   * Resolve `path` (following symlinks) and return it when it's inside an allowed root, or `null` otherwise.
   */
  export async function resolveAllowed(path: string): Promise<string | null> {
    return (await locate(path))?.real ?? null;
  }

  /**
   * List the sub-folders of `path`, or the allowed roots when `path` is `null`.
   * @throws When the folder is outside the allowed roots or can't be read.
   */
  export async function list(path: string | null): Promise<FsListing> {
    if (path === null) {
      return { path: null, root: null, parent: null, entries: roots().map((root) => ({ name: root, path: root })) };
    }

    const located = await locate(path);
    if (!located) throw new Error(`The folder "${path}" isn't available. Only folders inside ${roots().join(", ")} can be used.`);
    const { real, root } = located;

    const entries = [];
    for (const entry of await fsp.readdir(real, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = Path.join(real, entry.name);
      // Symlinked folders count as folders too
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && (await fsp.stat(full).catch(() => null))?.isDirectory());
      if (isDir) entries.push({ name: entry.name, path: full });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    return { path: real, root, parent: real === root ? null : Path.dirname(real), entries };
  }
}

export default MediaRoots;
