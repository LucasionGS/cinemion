import fsp from "node:fs/promises";
import Path from "node:path";
import { encodeHex } from "@std/encoding/hex";
import AppSystem from "../AppSystem.ts";
import Ffmpeg from "../lib/Ffmpeg.ts";
import log from "../lib/Logger.ts";

/**
 * Keeps artwork on disk. Each image is stored once under a key, and resized WebP copies are made on first request.
 */
export namespace ImageCache {
  /**
   * Where an image comes from: a URL to download, or a file next to the media.
   */
  export type Source = { url: string } | { file: string };

  /**
   * Widths that can be requested. Asking for another width gets the next larger one.
   */
  export const WIDTHS = [160, 342, 500, 780, 1280, 1920] as const;
  const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
  const KEY_PATTERN = /^[0-9a-f]{32}$/;

  const _pending = new Map<string, Promise<string | null>>();

  export function isKey(value: string) {
    return KEY_PATTERN.test(value);
  }

  function originalPath(key: string) {
    return Path.join(AppSystem.imagesDir, key.slice(0, 2), `${key}.img`);
  }

  function variantPath(key: string, width: number) {
    return Path.join(AppSystem.imagesDir, key.slice(0, 2), `${key}-w${width}.webp`);
  }

  async function exists(path: string) {
    return await fsp.stat(path).then(() => true).catch(() => false);
  }

  async function hash(text: string) {
    return encodeHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).slice(0, 32);
  }

  /**
   * The key an image stored with `identity` gets (see `store()`).
   */
  export async function keyFor(identity: string) {
    return await hash(identity);
  }

  /**
   * Whether an image with `key` is stored.
   */
  export async function has(key: string) {
    return isKey(key) && await exists(originalPath(key));
  }

  /**
   * Make sure the image is in the cache and return its key. `null` when it can't be fetched.
   * @param identity What the image stands for, when that isn't the source itself, like a thumbnail made in a temp
   *   file from a photo. The same identity always gives the same key.
   */
  export async function store(source: Source, identity?: string): Promise<string | null> {
    if (identity === undefined) {
      if ("url" in source) identity = source.url;
      else {
        // A changed local file gets a new key, so stale artwork is never served
        const stat = await fsp.stat(source.file).catch(() => null);
        if (!stat) return null;
        identity = `${source.file}:${stat.size}:${stat.mtime?.getTime()}`;
      }
    }
    const key = await hash(identity);
    if (await exists(originalPath(key))) return key;

    // Two scans asking for the same image wait for the same download
    const pending = _pending.get(key);
    if (pending) return pending;
    const job = fetchOriginal(source, key).finally(() => _pending.delete(key));
    _pending.set(key, job);
    return job;
  }

  async function fetchOriginal(source: Source, key: string): Promise<string | null> {
    const target = originalPath(key);
    await fsp.mkdir(Path.dirname(target), { recursive: true });
    const temp = `${target}.${crypto.randomUUID()}.part`;
    try {
      if ("url" in source) {
        const res = await fetch(source.url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const length = Number(res.headers.get("Content-Length") ?? 0);
        if (length > MAX_DOWNLOAD_BYTES) throw new Error("the image is too large");
        await fsp.writeFile(temp, new Uint8Array(await res.arrayBuffer()));
      }
      else {
        await fsp.copyFile(source.file, temp);
      }
      await fsp.rename(temp, target);
      return key;
    } catch (error) {
      await fsp.rm(temp, { force: true });
      log.warn("Could not cache an image", { source: "url" in source ? source.url : source.file, error });
      return null;
    }
  }

  /**
   * Path of the image resized to (at most) `width`, creating it when needed. `null` when the key is unknown.
   */
  export async function variant(key: string, width: number): Promise<string | null> {
    if (!isKey(key)) return null;
    const original = originalPath(key);
    if (!(await exists(original))) return null;

    const size = WIDTHS.find((w) => w >= width) ?? WIDTHS[WIDTHS.length - 1];
    const target = variantPath(key, size);
    if (await exists(target)) return target;

    const pendingKey = `${key}-${size}`;
    const pending = _pending.get(pendingKey);
    if (pending) return pending;
    const job = (async () => {
      const temp = `${target}.${crypto.randomUUID()}.webp`;
      // Never upscale; -2 keeps the height even, which some encoders need
      const result = await Ffmpeg.run(["-y", "-i", original, "-vf", `scale='min(iw,${size})':-2:flags=lanczos`, "-frames:v", "1", "-c:v", "libwebp", "-quality", "82", temp]);
      if (result.code !== 0) {
        await fsp.rm(temp, { force: true });
        log.warn("Could not resize an image", { key, error: result.stderr.trim() });
        return null;
      }
      await fsp.rename(temp, target);
      return target;
    })().finally(() => _pending.delete(pendingKey));
    _pending.set(pendingKey, job);
    return job;
  }

  /**
   * Path of the stored original, for reading colours from it.
   */
  export function original(key: string) {
    return isKey(key) ? originalPath(key) : null;
  }
}

export default ImageCache;
